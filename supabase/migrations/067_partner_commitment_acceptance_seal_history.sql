-- Partner Commitment Ledger acceptance-seal historical correctness
--
-- Migration 066 introduced tamper-evident accepted-contract seals. A deeper
-- state-machine review exposed an important temporal edge case: acceptance is a
-- historical event, while `partner_commitment_acceptance_state()` describes the
-- latest decision state. A later withdrawal must not retroactively invalidate the
-- exact terms and decision set that were accepted earlier.
--
-- This migration upgrades the seal to v2. The seal stores the exact accepted
-- decision fingerprint captured when acceptance completed, and scope-integrity
-- verification counts every revision that ever entered the accepted lifecycle --
-- including one that was later withdrawn/cancelled. Future decisions therefore
-- cannot change the canonical payload of an already sealed historical contract.

alter table public.partner_commitment_acceptance_seals
  add column if not exists integrity_version smallint,
  add column if not exists acceptance_decision_fingerprint text;

create or replace function public.partner_commitment_acceptance_fingerprint(
  p_revision_id uuid,
  p_cutoff timestamptz default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_required text[];
  v_role text;
  v_id uuid;
  v_actor uuid;
  v_decision text;
  v_parts text[] := '{}';
begin
  v_required := public.partner_commitment_required_roles(p_revision_id);
  if cardinality(coalesce(v_required, '{}'::text[])) = 0 then return null; end if;

  foreach v_role in array v_required loop
    select d.id, d.actor_user_id, d.decision
      into v_id, v_actor, v_decision
    from public.partner_commitment_decisions d
    where d.revision_id = p_revision_id
      and d.actor_role = v_role
      and (p_cutoff is null or d.created_at <= p_cutoff)
    order by d.created_at desc, d.id desc
    limit 1;

    if v_id is null or v_actor is null or v_decision <> 'accepted' then
      return null;
    end if;

    v_parts := array_append(
      v_parts,
      concat_ws(':', v_role, v_actor::text, v_id::text)
    );
  end loop;

  return array_to_string(v_parts, ',');
end;
$$;

create or replace function public.compute_partner_commitment_acceptance_seal_v2(
  p_revision_id uuid,
  p_previous_seal_hash text,
  p_acceptance_decision_fingerprint text
)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  with contract as (
    select
      s.id as scope_id,
      s.scope_kind,
      s.program_id,
      s.event_id,
      s.exchange_id,
      s.community_a_id,
      s.community_b_id,
      s.host_id,
      c.id as commitment_id,
      c.committed_party_kind,
      c.committed_community_id,
      r.id as revision_id,
      r.revision_no,
      r.commitment_type,
      r.domain,
      r.committed_quantity,
      r.window_start,
      r.window_end,
      public.partner_commitment_required_roles(r.id) as required_roles
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    join public.partner_commitment_scopes s on s.id = c.scope_id
    where r.id = p_revision_id
  )
  select encode(
    digest(
      convert_to(
        concat_ws('|',
          'partner-commitment-contract-v2',
          coalesce(c.scope_id::text, ''),
          coalesce(c.scope_kind, ''),
          coalesce(c.program_id::text, ''),
          coalesce(c.event_id::text, ''),
          coalesce(c.exchange_id::text, ''),
          coalesce(c.community_a_id::text, ''),
          coalesce(c.community_b_id::text, ''),
          coalesce(c.host_id::text, ''),
          coalesce(c.commitment_id::text, ''),
          coalesce(c.committed_party_kind, ''),
          coalesce(c.committed_community_id::text, ''),
          coalesce(c.revision_id::text, ''),
          coalesce(c.revision_no::text, ''),
          coalesce(c.commitment_type, ''),
          coalesce(c.domain, ''),
          coalesce(c.committed_quantity::text, ''),
          coalesce(extract(epoch from c.window_start)::bigint::text, ''),
          coalesce(extract(epoch from c.window_end)::bigint::text, ''),
          coalesce(array_to_string(c.required_roles, ','), ''),
          coalesce(p_acceptance_decision_fingerprint, ''),
          coalesce(p_previous_seal_hash, 'GENESIS')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from contract c;
$$;

-- Replace the acceptance hook so future seals freeze the exact decision IDs and
-- principals that completed acceptance. Recomputing later never consults newer
-- withdrawn/rejected decisions.
create or replace function public.seal_partner_commitment_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_commitment_id uuid;
  v_scope_id uuid;
  v_previous_hash text;
  v_fingerprint text;
  v_hash text;
begin
  if public.partner_commitment_acceptance_state(new.revision_id) <> 'accepted' then
    return new;
  end if;

  select r.commitment_id, c.scope_id
    into v_commitment_id, v_scope_id
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  where r.id = new.revision_id;

  if v_commitment_id is null then return new; end if;

  perform pg_advisory_xact_lock(hashtext('partner-contract-seal:' || v_commitment_id::text));

  if exists (
    select 1 from public.partner_commitment_acceptance_seals s
    where s.revision_id = new.revision_id
  ) then return new; end if;

  v_fingerprint := public.partner_commitment_acceptance_fingerprint(new.revision_id, null);
  if v_fingerprint is null then
    raise exception 'accepted revision is missing the complete accepted decision set';
  end if;

  select s.seal_hash into v_previous_hash
  from public.partner_commitment_acceptance_seals s
  join public.partner_commitment_revisions r on r.id = s.revision_id
  where s.commitment_id = v_commitment_id
    and r.revision_no < (
      select current_revision.revision_no
      from public.partner_commitment_revisions current_revision
      where current_revision.id = new.revision_id
    )
  order by r.revision_no desc, s.sealed_at desc, s.id desc
  limit 1;

  v_hash := public.compute_partner_commitment_acceptance_seal_v2(
    new.revision_id,
    v_previous_hash,
    v_fingerprint
  );
  if v_hash is null then raise exception 'could not compute partner commitment v2 contract seal'; end if;

  insert into public.partner_commitment_acceptance_seals (
    scope_id,
    commitment_id,
    revision_id,
    previous_seal_hash,
    seal_hash,
    integrity_version,
    acceptance_decision_fingerprint
  ) values (
    v_scope_id,
    v_commitment_id,
    new.revision_id,
    v_previous_hash,
    v_hash,
    2,
    v_fingerprint
  );

  return new;
end;
$$;

-- Upgrade any v1/backfilled rows produced by 066. This migration is the one
-- controlled rewrite of those internal fingerprints; after it completes the
-- immutable trigger is restored. Historical acceptance is derived from the
-- append-only lifecycle event, not the current decision state.
drop trigger if exists partner_commitment_acceptance_seal_immutable
  on public.partner_commitment_acceptance_seals;

truncate table public.partner_commitment_acceptance_seals;

do $$
declare
  v_row record;
  v_last_commitment uuid;
  v_previous_hash text;
  v_fingerprint text;
  v_hash text;
begin
  for v_row in
    select
      r.id as revision_id,
      r.commitment_id,
      c.scope_id,
      r.revision_no,
      (
        select min(e.created_at)
        from public.partner_commitment_lifecycle_events e
        where e.revision_id = r.id and e.status = 'accepted'
      ) as accepted_at
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    where exists (
      select 1
      from public.partner_commitment_lifecycle_events e
      where e.revision_id = r.id and e.status = 'accepted'
    )
    order by r.commitment_id, r.revision_no, r.id
  loop
    if v_last_commitment is distinct from v_row.commitment_id then
      v_previous_hash := null;
      v_last_commitment := v_row.commitment_id;
    end if;

    v_fingerprint := public.partner_commitment_acceptance_fingerprint(
      v_row.revision_id,
      v_row.accepted_at
    );
    if v_fingerprint is null then
      raise exception 'historically accepted revision % has no complete accepted decision set', v_row.revision_id;
    end if;

    v_hash := public.compute_partner_commitment_acceptance_seal_v2(
      v_row.revision_id,
      v_previous_hash,
      v_fingerprint
    );

    insert into public.partner_commitment_acceptance_seals (
      scope_id,
      commitment_id,
      revision_id,
      previous_seal_hash,
      seal_hash,
      integrity_version,
      acceptance_decision_fingerprint
    ) values (
      v_row.scope_id,
      v_row.commitment_id,
      v_row.revision_id,
      v_previous_hash,
      v_hash,
      2,
      v_fingerprint
    );

    v_previous_hash := v_hash;
  end loop;
end;
$$;

alter table public.partner_commitment_acceptance_seals
  alter column integrity_version set not null,
  alter column integrity_version set default 2,
  alter column acceptance_decision_fingerprint set not null,
  add constraint partner_commitment_acceptance_seal_version_check
    check (integrity_version = 2),
  add constraint partner_commitment_acceptance_fingerprint_length_check
    check (char_length(acceptance_decision_fingerprint) between 40 and 1200);

create trigger partner_commitment_acceptance_seal_immutable
before update or delete on public.partner_commitment_acceptance_seals
for each row execute function public.reject_partner_commitment_governance_mutation();

create or replace function public.verify_partner_commitment_scope_integrity(p_scope_id uuid)
returns table (
  valid boolean,
  sealed_revision_count integer,
  accepted_revision_count integer,
  first_invalid_revision_id uuid,
  scope_fingerprint text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_previous_hash text;
  v_expected_hash text;
  v_invalid uuid;
  v_sealed integer := 0;
  v_historically_accepted integer := 0;
  v_fingerprint text;
  v_last_commitment uuid;
begin
  if auth.uid() is null or not public.partner_commitment_scope_access(p_scope_id, auth.uid()) then
    return;
  end if;

  select count(*)::integer into v_historically_accepted
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  where c.scope_id = p_scope_id
    and exists (
      select 1
      from public.partner_commitment_lifecycle_events e
      where e.revision_id = r.id and e.status = 'accepted'
    );

  for v_row in
    select s.*, r.revision_no
    from public.partner_commitment_acceptance_seals s
    join public.partner_commitment_revisions r on r.id = s.revision_id
    where s.scope_id = p_scope_id
    order by s.commitment_id, r.revision_no, s.id
  loop
    if v_last_commitment is distinct from v_row.commitment_id then
      v_previous_hash := null;
      v_last_commitment := v_row.commitment_id;
    end if;

    if v_row.integrity_version <> 2 then
      v_invalid := v_row.revision_id;
      exit;
    end if;

    v_expected_hash := public.compute_partner_commitment_acceptance_seal_v2(
      v_row.revision_id,
      v_previous_hash,
      v_row.acceptance_decision_fingerprint
    );

    if v_row.previous_seal_hash is distinct from v_previous_hash
       or v_row.seal_hash is distinct from v_expected_hash then
      v_invalid := v_row.revision_id;
      exit;
    end if;

    v_previous_hash := v_row.seal_hash;
    v_sealed := v_sealed + 1;
  end loop;

  select case when count(*) = 0 then null else encode(
    digest(
      convert_to(
        string_agg(
          s.integrity_version::text || ':' || s.seal_hash,
          '|' order by s.commitment_id, r.revision_no, s.id
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) end
  into v_fingerprint
  from public.partner_commitment_acceptance_seals s
  join public.partner_commitment_revisions r on r.id = s.revision_id
  where s.scope_id = p_scope_id;

  return query select
    v_invalid is null and v_sealed = v_historically_accepted,
    v_sealed,
    v_historically_accepted,
    v_invalid,
    v_fingerprint;
end;
$$;

revoke all on function public.partner_commitment_acceptance_fingerprint(uuid,timestamptz) from public;
revoke all on function public.compute_partner_commitment_acceptance_seal_v2(uuid,text,text) from public;
revoke all on function public.seal_partner_commitment_acceptance() from public;
revoke all on function public.verify_partner_commitment_scope_integrity(uuid) from public;
grant execute on function public.verify_partner_commitment_scope_integrity(uuid) to authenticated;

comment on column public.partner_commitment_acceptance_seals.acceptance_decision_fingerprint is
  'Immutable identities of the exact accepted decision rows/principals that completed acceptance. Later withdrawal/rejection decisions do not alter the historical contract seal.';
comment on function public.verify_partner_commitment_scope_integrity(uuid) is
  'Verifies v2 accepted-contract seal chains against every revision that historically entered accepted lifecycle, including revisions later withdrawn or cancelled.';
