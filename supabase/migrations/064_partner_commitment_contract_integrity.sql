-- Partner Commitment Ledger contract-integrity hardening
--
-- This layer closes the gaps that appear only after the first bilateral ledger is
-- actually usable: a proposed amendment must not silently replace an already
-- accepted contract, manual delivery claims need bilateral review, semantically
-- duplicate commitments must not be able to double-claim the same operating
-- obligation, missing measurements must not be treated as zero utilization, and
-- append-only evidence must resist both UPDATE and DELETE mutation paths.
--
-- The system still does not score partner quality, convert unlike resources into
-- money, or claim that supported outcomes were caused by a commitment.

create table if not exists public.partner_commitment_manual_measurement_reviews (
  id uuid primary key default gen_random_uuid(),
  manual_measurement_id uuid not null references public.partner_commitment_measurements(id) on delete restrict,
  actor_role text not null check (actor_role in ('community-a','community-b','event-host')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('acknowledged','disputed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, actor_role, idempotency_key),
  check (char_length(idempotency_key) between 20 and 180)
);

create index if not exists partner_commitment_manual_review_latest_idx
  on public.partner_commitment_manual_measurement_reviews (
    manual_measurement_id, actor_role, created_at desc, id desc
  );

alter table public.partner_commitment_manual_measurement_reviews enable row level security;
revoke all on public.partner_commitment_manual_measurement_reviews from authenticated, anon;

-- Existing ledger rows were protected against UPDATE, but an append-only audit
-- contract should not be erasable by an accidental DELETE path either. Direct
-- clients already have no table access; this is a database-boundary invariant.
create or replace function public.reject_partner_commitment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'partner commitment evidence is append-only; create a new revision, decision, lifecycle event, or measurement instead';
end;
$$;

do $$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'partner_commitment_revisions',
    'partner_commitment_decisions',
    'partner_commitment_lifecycle_events',
    'partner_commitment_measurements',
    'partner_commitment_evidence_links',
    'partner_commitment_event_closeouts',
    'partner_commitment_manual_measurement_reviews'
  ] loop
    v_trigger := v_table || '_immutable_guard';
    execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.reject_partner_commitment_mutation()',
      v_trigger,
      v_table
    );
  end loop;
end;
$$;

-- A proposed amendment is not the operating contract until the amendment has
-- earned every required acceptance. The previously accepted revision remains
-- effective while a replacement is awaiting decision, rejected, or withdrawn.
create or replace function public.partner_commitment_effective_revision(p_commitment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.partner_commitment_revisions r
  where r.commitment_id = p_commitment_id
    and public.partner_commitment_acceptance_state(r.id) = 'accepted'
    and public.partner_commitment_latest_status(r.id) not in ('rejected','cancelled')
  order by r.revision_no desc, r.created_at desc, r.id desc
  limit 1;
$$;

create or replace function public.partner_commitment_pending_revision(p_commitment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select r.id
    from public.partner_commitment_revisions r
    where r.commitment_id = p_commitment_id
    order by r.revision_no desc, r.created_at desc, r.id desc
    limit 1
  )
  select l.id
  from latest l
  where public.partner_commitment_acceptance_state(l.id) = 'awaiting-acceptance'
    and public.partner_commitment_latest_status(l.id) = 'proposed';
$$;

-- Revisions with the same party/resource/domain and overlapping delivery window
-- are operationally ambiguous: the same session could satisfy both promises.
-- Beacon requires a revision of the existing obligation instead of two parallel
-- claims with indistinguishable measurement semantics.
create or replace function public.partner_commitment_has_semantic_overlap(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      r.id as revision_id,
      r.commitment_id,
      r.commitment_type,
      r.domain,
      r.window_start,
      r.window_end,
      c.scope_id,
      c.committed_party_kind,
      c.committed_community_id,
      s.scope_kind
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    join public.partner_commitment_scopes s on s.id = c.scope_id
    where r.id = p_revision_id
  ), peers as (
    select
      pc.id as commitment_id,
      public.partner_commitment_effective_revision(pc.id) as effective_revision_id
    from candidate x
    join public.partner_commitments pc
      on pc.scope_id = x.scope_id
     and pc.id <> x.commitment_id
     and pc.committed_party_kind = x.committed_party_kind
     and pc.committed_community_id is not distinct from x.committed_community_id
  )
  select exists (
    select 1
    from candidate x
    join peers p on p.effective_revision_id is not null
    join public.partner_commitment_revisions er on er.id = p.effective_revision_id
    where er.commitment_type = x.commitment_type
      and er.domain is not distinct from x.domain
      and public.partner_commitment_latest_status(er.id) in ('accepted','scheduled','delivering')
      and (
        x.scope_kind = 'program-template'
        or (
          x.window_start is not null
          and x.window_end is not null
          and er.window_start is not null
          and er.window_end is not null
          and x.window_start < er.window_end
          and er.window_start < x.window_end
        )
      )
  );
$$;

-- Resolve the underlying participant/operator-entered manual assertion through a
-- chain of later mixed/server refresh snapshots. Reviewing a refreshed snapshot
-- therefore does not reset or duplicate review of the same manual claim.
create or replace function public.partner_commitment_manual_measurement_source(p_measurement_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select m.id, m.supersedes_measurement_id, m.evidence_quality, m.evidence_sources, 0 as depth
    from public.partner_commitment_measurements m
    where m.id = p_measurement_id
    union all
    select parent.id, parent.supersedes_measurement_id, parent.evidence_quality, parent.evidence_sources, chain.depth + 1
    from chain
    join public.partner_commitment_measurements parent on parent.id = chain.supersedes_measurement_id
    where chain.depth < 64
  )
  select c.id
  from chain c
  where c.evidence_quality = 'manual-operator'
    and c.evidence_sources = array['manual-operator']::text[]
  order by c.depth asc
  limit 1;
$$;

create or replace function public.partner_commitment_manual_measurement_review_state(p_measurement_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_manual_id uuid;
  v_manual public.partner_commitment_measurements;
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_owner_a uuid;
  v_owner_b uuid;
  v_role text;
  v_principal uuid;
  v_decision text;
  v_pending boolean := false;
begin
  v_manual_id := public.partner_commitment_manual_measurement_source(p_measurement_id);
  if v_manual_id is null then return 'not-required'; end if;

  select * into v_manual from public.partner_commitment_measurements where id = v_manual_id;
  select * into v_revision from public.partner_commitment_revisions where id = v_manual.revision_id;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  select owner_id into v_owner_a from public.community_partners where id = v_scope.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_scope.community_b_id;

  foreach v_role in array coalesce(public.partner_commitment_required_roles(v_revision.id), '{}'::text[]) loop
    v_principal := case v_role
      when 'community-a' then v_owner_a
      when 'community-b' then v_owner_b
      else v_scope.host_id
    end;

    -- The committed party's manual submission is itself its acknowledgement of
    -- the claim. Every other required party must independently acknowledge or
    -- may explicitly dispute it.
    if v_principal = v_manual.created_by then
      continue;
    end if;

    select r.decision into v_decision
    from public.partner_commitment_manual_measurement_reviews r
    where r.manual_measurement_id = v_manual_id
      and r.actor_role = v_role
    order by r.created_at desc, r.id desc
    limit 1;

    if v_decision = 'disputed' then return 'disputed'; end if;
    if v_decision is distinct from 'acknowledged' then v_pending := true; end if;
  end loop;

  if v_pending then return 'pending'; end if;
  return 'acknowledged';
end;
$$;

create or replace function public.review_partner_commitment_manual_measurement(
  p_measurement_id uuid,
  p_decision text,
  p_idempotency_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manual_id uuid;
  v_manual public.partner_commitment_measurements;
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_roles text[];
  v_required text[];
  v_role text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_decision not in ('acknowledged','disputed') then raise exception 'unsupported manual measurement review decision'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;

  v_manual_id := public.partner_commitment_manual_measurement_source(p_measurement_id);
  if v_manual_id is null then raise exception 'measurement has no manual assertion to review'; end if;
  select * into v_manual from public.partner_commitment_measurements where id = v_manual_id;
  select * into v_revision from public.partner_commitment_revisions where id = v_manual.revision_id;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;

  if not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then
    raise exception 'shared partnership scope required';
  end if;
  if public.partner_commitment_effective_revision(v_commitment.id) is distinct from v_revision.id then
    raise exception 'manual review is available only on the effective commitment revision';
  end if;

  v_roles := public.partner_commitment_actor_roles(v_scope.id, auth.uid());
  v_required := public.partner_commitment_required_roles(v_revision.id);
  v_roles := array(select unnest(v_roles) intersect select unnest(v_required));
  if cardinality(coalesce(v_roles, '{}'::text[])) = 0 then
    raise exception 'caller is not a required commitment party';
  end if;

  foreach v_role in array v_roles loop
    if not exists (
      select 1
      from public.partner_commitment_manual_measurement_reviews r
      where r.actor_user_id = auth.uid()
        and r.actor_role = v_role
        and r.idempotency_key = trim(p_idempotency_key)
    ) then
      insert into public.partner_commitment_manual_measurement_reviews (
        manual_measurement_id, actor_role, actor_user_id, decision, idempotency_key
      ) values (
        v_manual_id, v_role, auth.uid(), p_decision, trim(p_idempotency_key)
      );
    end if;
  end loop;

  return public.partner_commitment_manual_measurement_review_state(p_measurement_id);
end;
$$;

-- Measurement is legal only on the effective accepted event contract. A stale
-- accepted revision must not continue accumulating evidence after an amendment
-- becomes effective.
create or replace function public.enforce_partner_commitment_measurement_admission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceptance text;
  v_status text;
  v_scope_kind text;
  v_commitment_id uuid;
begin
  select s.scope_kind, c.id into v_scope_kind, v_commitment_id
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  join public.partner_commitment_scopes s on s.id = c.scope_id
  where r.id = new.revision_id;

  if v_scope_kind is distinct from 'event-exchange' then
    raise exception 'program templates cannot receive delivery measurements';
  end if;
  if public.partner_commitment_effective_revision(v_commitment_id) is distinct from new.revision_id then
    raise exception 'measurement is allowed only on the effective accepted commitment revision';
  end if;

  v_acceptance := public.partner_commitment_acceptance_state(new.revision_id);
  if v_acceptance <> 'accepted' then
    raise exception 'all required parties must accept before commitment measurement';
  end if;

  v_status := public.partner_commitment_latest_status(new.revision_id);
  if v_status not in ('accepted','scheduled','delivering') then
    raise exception 'terminal or rejected commitment cannot receive a new measurement';
  end if;

  return new;
end;
$$;

-- Accepting a second indistinguishable obligation is rejected at the state
-- boundary. This is stronger than merely deduplicating rows after the fact.
create or replace function public.enforce_partner_commitment_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  select e.status into v_previous
  from public.partner_commitment_lifecycle_events e
  where e.revision_id = new.revision_id
  order by e.created_at desc, e.id desc
  limit 1;

  if v_previous is null then
    if new.status <> 'proposed' then raise exception 'commitment lifecycle must begin as proposed'; end if;
    return new;
  end if;

  if v_previous = 'proposed' and new.status not in ('accepted','rejected','cancelled') then
    raise exception 'invalid commitment transition from proposed to %', new.status;
  elsif v_previous = 'accepted' and new.status not in (
    'scheduled','delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from accepted to %', new.status;
  elsif v_previous = 'scheduled' and new.status not in (
    'delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from scheduled to %', new.status;
  elsif v_previous = 'delivering' and new.status not in (
    'fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from delivering to %', new.status;
  elsif v_previous in ('fulfilled','partially_fulfilled','cancelled','not_fulfilled','rejected') then
    raise exception 'terminal commitment state % is append-only and cannot transition again', v_previous;
  end if;

  if new.status = 'accepted' and public.partner_commitment_has_semantic_overlap(new.revision_id) then
    raise exception 'an overlapping accepted commitment already covers this party, resource type, domain, and delivery window; revise the existing obligation instead';
  end if;

  return new;
end;
$$;

-- Manual evidence is a claim by the party that actually owns the commitment.
-- An event host may manually acknowledge only the host's own contribution; it
-- cannot author a community's delivery quantity. Counterpart review happens via
-- the review RPC above.
create or replace function public.record_manual_partner_commitment_measurement(
  p_revision_id uuid,
  p_delivered_quantity numeric,
  p_utilized_quantity numeric,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_previous public.partner_commitment_measurements;
  v_number integer;
  v_id uuid;
  v_existing uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then raise exception 'strong idempotency key required'; end if;
  select id into v_existing from public.partner_commitment_measurements
    where created_by = auth.uid() and idempotency_key = trim(p_idempotency_key) limit 1;
  if v_existing is not null then return v_existing; end if;

  select * into v_revision from public.partner_commitment_revisions where id = p_revision_id;
  if v_revision.id is null then raise exception 'commitment revision not found'; end if;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  if v_scope.scope_kind <> 'event-exchange' then raise exception 'program templates do not carry fulfillment measurements'; end if;
  if not public.partner_commitment_committed_actor_authorized(p_revision_id, auth.uid()) then
    raise exception 'manual delivery assertion may be authored only by the committed party';
  end if;
  if public.partner_commitment_effective_revision(v_commitment.id) is distinct from p_revision_id then
    raise exception 'manual evidence may be recorded only against the effective accepted revision';
  end if;
  if p_delivered_quantity is null or p_utilized_quantity is null
     or p_delivered_quantity < 0 or p_utilized_quantity < 0
     or p_utilized_quantity > p_delivered_quantity
     or p_delivered_quantity > 10000 then
    raise exception 'manual delivered/utilized quantities are invalid';
  end if;

  select * into v_previous from public.partner_commitment_measurements
    where revision_id = p_revision_id order by measurement_no desc limit 1;
  v_number := coalesce(v_previous.measurement_no, 0) + 1;

  insert into public.partner_commitment_measurements (
    revision_id, measurement_no, delivered_quantity, utilized_quantity,
    measurement_state, evidence_quality, evidence_sources,
    supersedes_measurement_id, created_by, idempotency_key
  ) values (
    p_revision_id, v_number, p_delivered_quantity, p_utilized_quantity,
    'manual-only', 'manual-operator', array['manual-operator']::text[],
    v_previous.id, auth.uid(), trim(p_idempotency_key)
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Preserve the existing conservative native evidence adapters behind an internal
-- function, then put a stronger admission wrapper on the public RPC. In
-- particular, current Office Hours rows do not carry a reviewed domain field, so
-- a domain-specific Office Hours promise must not be "verified" from generic
-- completed Office Hours traffic.
alter function public.refresh_partner_commitment_measurement(uuid)
  rename to _refresh_partner_commitment_measurement_v1;
revoke all on function public._refresh_partner_commitment_measurement_v1(uuid) from public, authenticated, anon;

create or replace function public.refresh_partner_commitment_measurement(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.partner_commitment_revisions;
  v_commitment_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_revision
  from public.partner_commitment_revisions r where r.id = p_revision_id;
  v_commitment_id := v_revision.commitment_id;
  if v_revision.id is null then raise exception 'commitment revision not found'; end if;
  if public.partner_commitment_effective_revision(v_commitment_id) is distinct from p_revision_id then
    raise exception 'evidence refresh is allowed only on the effective accepted commitment revision';
  end if;
  if v_revision.commitment_type = 'office_hours_slots' and v_revision.domain is not null then
    raise exception 'domain-specific Office Hours lacks server-recorded domain provenance; use an explicit manual assertion subject to counterpart review';
  end if;
  return public._refresh_partner_commitment_measurement_v1(p_revision_id);
end;
$$;

-- Delivery finalization remains controlled by the committed party, but any final
-- state that relies on manual evidence now requires bilateral review. Pending or
-- disputed manual claims can be displayed, but cannot silently close the contract.
create or replace function public.advance_partner_commitment(
  p_revision_id uuid,
  p_target_status text,
  p_idempotency_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_event public.events;
  v_measurement public.partner_commitment_measurements;
  v_current text;
  v_actor_kind text;
  v_manual_review text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_target_status not in ('scheduled','delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled') then
    raise exception 'unsupported commitment lifecycle target';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then raise exception 'strong idempotency key required'; end if;
  if exists (select 1 from public.partner_commitment_lifecycle_events e where e.actor_user_id = auth.uid() and e.idempotency_key = trim(p_idempotency_key)) then return true; end if;

  select * into v_revision from public.partner_commitment_revisions where id = p_revision_id;
  if v_revision.id is null then raise exception 'commitment revision not found'; end if;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  if v_scope.scope_kind <> 'event-exchange' then raise exception 'program templates do not enter event delivery lifecycle'; end if;
  if not public.partner_commitment_committed_actor_authorized(p_revision_id, auth.uid()) then
    raise exception 'only the committed party controls its delivery lifecycle';
  end if;
  if public.partner_commitment_effective_revision(v_commitment.id) is distinct from p_revision_id then
    raise exception 'delivery lifecycle may advance only on the effective accepted commitment revision';
  end if;
  if public.partner_commitment_acceptance_state(p_revision_id) <> 'accepted' and p_target_status <> 'cancelled' then
    raise exception 'bilateral acceptance required before delivery state';
  end if;

  select * into v_event from public.events where id = v_scope.event_id;
  select * into v_measurement from public.partner_commitment_measurements
    where revision_id = p_revision_id order by measurement_no desc limit 1;
  v_current := public.partner_commitment_latest_status(p_revision_id);

  if p_target_status = 'scheduled' and v_current <> 'accepted' then raise exception 'only an accepted commitment can be scheduled'; end if;
  if p_target_status = 'delivering' and v_current not in ('accepted','scheduled') then raise exception 'commitment is not ready to deliver'; end if;

  if p_target_status in ('fulfilled','partially_fulfilled','not_fulfilled') and v_measurement.id is not null then
    v_manual_review := public.partner_commitment_manual_measurement_review_state(v_measurement.id);
    if v_manual_review in ('pending','disputed') then
      raise exception 'manual delivery evidence must be acknowledged by every required counterparty before it can finalize the commitment';
    end if;
  end if;

  if p_target_status = 'fulfilled' then
    if v_measurement.id is null or v_measurement.delivered_quantity < v_revision.committed_quantity then
      raise exception 'measured delivered quantity does not support fulfilled state';
    end if;
  end if;
  if p_target_status = 'partially_fulfilled' then
    if v_measurement.id is null or v_measurement.delivered_quantity <= 0
       or v_measurement.delivered_quantity >= v_revision.committed_quantity then
      raise exception 'measured delivered quantity does not support partial fulfillment';
    end if;
  end if;
  if p_target_status = 'not_fulfilled' then
    if v_measurement.id is null or v_measurement.delivered_quantity <> 0 then
      raise exception 'zero measured delivery is required for not-fulfilled acknowledgement';
    end if;
    if v_event.ended_at is null and v_revision.window_end > now() then
      raise exception 'observation window is still open';
    end if;
  end if;

  v_actor_kind := case when v_commitment.committed_party_kind = 'event-host' then 'event-host' else 'community' end;
  insert into public.partner_commitment_lifecycle_events (
    revision_id, status, actor_kind, actor_user_id, reason_code, idempotency_key
  ) values (
    p_revision_id, p_target_status, v_actor_kind, auth.uid(),
    case p_target_status
      when 'scheduled' then 'scheduled-by-committed-party'
      when 'delivering' then 'delivery-started'
      when 'fulfilled' then 'measured-delivery-finalized'
      when 'partially_fulfilled' then 'measured-delivery-finalized'
      when 'cancelled' then 'committed-party-cancelled'
      else 'event-window-closed-without-delivery'
    end,
    trim(p_idempotency_key)
  );
  return true;
end;
$$;

-- Shared projection: if an accepted contract has a pending amendment, the
-- accepted terms remain the main row and the amendment is surfaced separately.
-- This avoids the subtle but dangerous UX where proposing 12 slots makes an
-- accepted 8-slot obligation appear to have vanished before the other party acts.
drop function if exists public.get_partner_commitment_ledger(uuid);
create function public.get_partner_commitment_ledger(p_scope_id uuid)
returns table (
  commitment_id uuid,
  revision_id uuid,
  revision_no integer,
  effective_revision_id uuid,
  pending_revision_id uuid,
  committed_party_kind text,
  committed_community_id uuid,
  committed_party_label text,
  commitment_type text,
  domain text,
  committed_quantity numeric,
  window_start timestamptz,
  window_end timestamptz,
  acceptance_state text,
  lifecycle_status text,
  required_roles text[],
  caller_pending_decision boolean,
  caller_can_manage boolean,
  delivered_quantity numeric,
  utilized_quantity numeric,
  measurement_state text,
  evidence_quality text,
  evidence_sources text[],
  supported_bilateral_outcomes integer,
  supported_warm_introductions integer,
  source_template_revision_id uuid,
  created_at timestamptz,
  pending_commitment_type text,
  pending_domain text,
  pending_committed_quantity numeric,
  pending_acceptance_state text,
  caller_pending_amendment_decision boolean,
  latest_measurement_id uuid,
  manual_measurement_id uuid,
  measurement_review_state text,
  caller_can_review_measurement boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with roots as (
    select
      c.*,
      (select r.id from public.partner_commitment_revisions r where r.commitment_id = c.id order by r.revision_no desc limit 1) as latest_revision_id,
      public.partner_commitment_effective_revision(c.id) as effective_revision_id,
      public.partner_commitment_pending_revision(c.id) as pending_revision_id
    from public.partner_commitments c
    where c.scope_id = p_scope_id
  ), chosen as (
    select roots.*, coalesce(roots.effective_revision_id, roots.latest_revision_id) as display_revision_id
    from roots
  )
  select
    c.id,
    d.id,
    d.revision_no,
    c.effective_revision_id,
    c.pending_revision_id,
    c.committed_party_kind,
    c.committed_community_id,
    case
      when c.committed_party_kind = 'event-host' then 'Event host'
      when c.committed_community_id = s.community_a_id then a.name
      else b.name
    end,
    d.commitment_type,
    d.domain,
    d.committed_quantity,
    d.window_start,
    d.window_end,
    public.partner_commitment_acceptance_state(d.id),
    public.partner_commitment_latest_status(d.id),
    public.partner_commitment_required_roles(d.id),
    c.effective_revision_id is null
    and public.partner_commitment_acceptance_state(d.id) = 'awaiting-acceptance'
    and public.partner_commitment_latest_status(d.id) = 'proposed'
    and exists (
      select 1
      from unnest(public.partner_commitment_actor_roles(s.id, auth.uid())) role
      where role = any(public.partner_commitment_required_roles(d.id))
        and coalesce((
          select decision from public.partner_commitment_decisions pd
          where pd.revision_id = d.id and pd.actor_role = role
          order by pd.created_at desc, pd.id desc limit 1
        ), '') <> 'accepted'
    ),
    public.partner_commitment_committed_actor_authorized(d.id, auth.uid()),
    m.delivered_quantity,
    m.utilized_quantity,
    case when s.scope_kind = 'program-template' then 'not-applicable' else coalesce(m.measurement_state, 'not-measured') end,
    case when s.scope_kind = 'program-template' then 'insufficient' else coalesce(m.evidence_quality, 'insufficient') end,
    coalesce(m.evidence_sources, '{}'::text[]),
    m.supported_bilateral_outcomes,
    m.supported_warm_introductions,
    c.source_template_revision_id,
    d.created_at,
    pr.commitment_type,
    pr.domain,
    pr.committed_quantity,
    case when pr.id is null then null else public.partner_commitment_acceptance_state(pr.id) end,
    c.effective_revision_id is not null and pr.id is not null and exists (
      select 1
      from unnest(public.partner_commitment_actor_roles(s.id, auth.uid())) role
      where role = any(public.partner_commitment_required_roles(pr.id))
        and coalesce((
          select decision from public.partner_commitment_decisions pd
          where pd.revision_id = pr.id and pd.actor_role = role
          order by pd.created_at desc, pd.id desc limit 1
        ), '') <> 'accepted'
    ),
    m.id,
    case when m.id is null then null else public.partner_commitment_manual_measurement_source(m.id) end,
    case when m.id is null then 'not-required' else public.partner_commitment_manual_measurement_review_state(m.id) end,
    m.id is not null
      and public.partner_commitment_manual_measurement_source(m.id) is not null
      and exists (
        select 1
        from unnest(public.partner_commitment_actor_roles(s.id, auth.uid())) role
        where role = any(public.partner_commitment_required_roles(d.id))
      )
      and auth.uid() is distinct from (
        select mm.created_by
        from public.partner_commitment_measurements mm
        where mm.id = public.partner_commitment_manual_measurement_source(m.id)
      )
  from chosen c
  join public.partner_commitment_scopes s on s.id = c.scope_id
  join public.community_partners a on a.id = s.community_a_id
  join public.community_partners b on b.id = s.community_b_id
  join public.partner_commitment_revisions d on d.id = c.display_revision_id
  left join public.partner_commitment_revisions pr on pr.id = c.pending_revision_id and pr.id <> d.id
  left join lateral (
    select pm.* from public.partner_commitment_measurements pm
    where pm.revision_id = d.id
    order by pm.measurement_no desc limit 1
  ) m on true
  where public.partner_commitment_scope_access(s.id, auth.uid())
  order by case public.partner_commitment_latest_status(d.id)
      when 'delivering' then 0 when 'scheduled' then 1 when 'accepted' then 2 when 'proposed' then 3 else 4 end,
    d.created_at, c.id;
$$;

-- Host summary now exposes operational unresolved states, not a partner score.
drop function if exists public.get_event_partner_commitment_summary(uuid);
create function public.get_event_partner_commitment_summary(p_event_id uuid)
returns table (
  exchange_ledger_count integer,
  accepted_commitment_count integer,
  scheduled_or_delivering_count integer,
  fulfilled_commitment_count integer,
  partially_fulfilled_count integer,
  unresolved_commitment_count integer,
  pending_amendment_count integer,
  manual_review_pending_count integer,
  manual_dispute_count integer,
  closed_without_measurement_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then return; end if;
  return query
  with scopes as (
    select * from public.partner_commitment_scopes s
    where s.event_id = p_event_id and s.scope_kind = 'event-exchange'
  ), roots as (
    select
      c.id as commitment_id,
      c.scope_id,
      public.partner_commitment_effective_revision(c.id) as effective_revision_id,
      public.partner_commitment_pending_revision(c.id) as pending_revision_id
    from public.partner_commitments c
    join scopes s on s.id = c.scope_id
  ), chosen as (
    select r.*,
      coalesce(r.effective_revision_id, (
        select pr.id from public.partner_commitment_revisions pr
        where pr.commitment_id = r.commitment_id order by pr.revision_no desc limit 1
      )) as revision_id
    from roots r
  ), states as (
    select
      c.*,
      public.partner_commitment_latest_status(c.revision_id) as status,
      public.partner_commitment_acceptance_state(c.revision_id) as acceptance,
      m.id as measurement_id,
      coalesce(m.measurement_state, 'not-measured') as measurement_state,
      case when m.id is null then 'not-required' else public.partner_commitment_manual_measurement_review_state(m.id) end as review_state
    from chosen c
    left join lateral (
      select pm.* from public.partner_commitment_measurements pm
      where pm.revision_id = c.revision_id order by pm.measurement_no desc limit 1
    ) m on true
  )
  select
    (select count(*)::integer from scopes),
    count(*) filter (where acceptance = 'accepted')::integer,
    count(*) filter (where status in ('scheduled','delivering'))::integer,
    count(*) filter (where status = 'fulfilled')::integer,
    count(*) filter (where status = 'partially_fulfilled')::integer,
    count(*) filter (where status in ('proposed','accepted','scheduled','delivering'))::integer,
    count(*) filter (where effective_revision_id is not null and pending_revision_id is not null)::integer,
    count(*) filter (where review_state = 'pending')::integer,
    count(*) filter (where review_state = 'disputed')::integer,
    count(*) filter (
      where (select ended_at from public.events where id = p_event_id) is not null
        and acceptance = 'accepted'
        and measurement_state in ('not-measured','insufficient-evidence')
    )::integer
  from states;
end;
$$;

-- Longitudinal memory distinguishes "zero" from "not measured". A partnership
-- should never appear consistently unused merely because evidence coverage is
-- sparse. All utilization averages are calculated only over admissible measured
-- events, and the coverage denominator is returned beside the result.
drop function if exists public.get_partner_program_commitment_memory(uuid);
create function public.get_partner_program_commitment_memory(p_program_id uuid)
returns table (
  party_kind text,
  party_community_id uuid,
  party_label text,
  commitment_type text,
  domain text,
  sample_event_count integer,
  commitment_occurrences integer,
  measured_event_count integer,
  measurement_coverage numeric,
  average_committed_quantity numeric,
  average_delivered_quantity numeric,
  average_utilized_quantity numeric,
  utilized_event_count integer,
  unused_measured_event_count integer,
  zero_utilization_measured_event_count integer,
  suggested_quantity numeric,
  latest_event_ended_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  if auth.uid() is null then return; end if;
  select * into v_program from public.community_partner_programs where id = p_program_id;
  if v_program.id is null then return; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_program.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_program.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b) then return; end if;

  return query
  with event_scopes as (
    select s.*, e.ended_at
    from public.partner_commitment_scopes s
    join public.events e on e.id = s.event_id
    where s.scope_kind = 'event-exchange'
      and s.program_id = p_program_id
      and e.ended_at is not null
  ), effective as (
    select
      c.id as commitment_id,
      c.committed_party_kind,
      c.committed_community_id,
      s.event_id,
      s.ended_at,
      public.partner_commitment_effective_revision(c.id) as revision_id
    from public.partner_commitments c
    join event_scopes s on s.id = c.scope_id
  ), rows as (
    select
      e.*,
      r.commitment_type,
      r.domain,
      r.committed_quantity,
      m.id as measurement_id,
      m.delivered_quantity,
      m.utilized_quantity,
      m.measurement_state,
      case when m.id is null then 'not-required' else public.partner_commitment_manual_measurement_review_state(m.id) end as review_state,
      (m.id is not null
        and m.measurement_state in ('measured','partial','manual-only')
        and (case when m.id is null then 'not-required' else public.partner_commitment_manual_measurement_review_state(m.id) end) in ('not-required','acknowledged')) as measurement_admissible
    from effective e
    join public.partner_commitment_revisions r on r.id = e.revision_id
    left join lateral (
      select pm.* from public.partner_commitment_measurements pm
      where pm.revision_id = e.revision_id order by pm.measurement_no desc limit 1
    ) m on true
    where e.revision_id is not null
  )
  select
    r.committed_party_kind,
    r.committed_community_id,
    case
      when r.committed_party_kind = 'event-host' then 'Event host'
      when r.committed_community_id = v_program.community_a_id then ca.name
      else cb.name
    end,
    r.commitment_type,
    r.domain,
    count(distinct r.event_id)::integer,
    count(*)::integer,
    count(distinct r.event_id) filter (where r.measurement_admissible)::integer,
    round(
      count(distinct r.event_id) filter (where r.measurement_admissible)::numeric
      / greatest(1, count(distinct r.event_id)),
      4
    ),
    round(avg(r.committed_quantity), 2),
    round(avg(r.delivered_quantity) filter (where r.measurement_admissible), 2),
    round(avg(r.utilized_quantity) filter (where r.measurement_admissible), 2),
    count(distinct r.event_id) filter (where r.measurement_admissible and coalesce(r.utilized_quantity, 0) > 0)::integer,
    count(distinct r.event_id) filter (where r.measurement_admissible and coalesce(r.delivered_quantity, 0) > coalesce(r.utilized_quantity, 0))::integer,
    count(distinct r.event_id) filter (where r.measurement_admissible and coalesce(r.delivered_quantity, 0) > 0 and coalesce(r.utilized_quantity, 0) = 0)::integer,
    case when count(distinct r.event_id) >= 2
      then round(percentile_cont(0.5) within group (order by r.committed_quantity)::numeric, 2)
      else null::numeric end,
    max(r.ended_at)
  from rows r
  join public.community_partners ca on ca.id = v_program.community_a_id
  join public.community_partners cb on cb.id = v_program.community_b_id
  group by r.committed_party_kind, r.committed_community_id, ca.name, cb.name,
           r.commitment_type, r.domain
  order by count(distinct r.event_id) desc, r.commitment_type, r.domain nulls first;
end;
$$;

revoke all on function public.reject_partner_commitment_mutation() from public;
revoke all on function public.partner_commitment_effective_revision(uuid) from public;
revoke all on function public.partner_commitment_pending_revision(uuid) from public;
revoke all on function public.partner_commitment_has_semantic_overlap(uuid) from public;
revoke all on function public.partner_commitment_manual_measurement_source(uuid) from public;
revoke all on function public.partner_commitment_manual_measurement_review_state(uuid) from public;
revoke all on function public.review_partner_commitment_manual_measurement(uuid,text,text) from public;
revoke all on function public.enforce_partner_commitment_measurement_admission() from public;
revoke all on function public.enforce_partner_commitment_lifecycle_transition() from public;
revoke all on function public.record_manual_partner_commitment_measurement(uuid,numeric,numeric,text) from public;
revoke all on function public.refresh_partner_commitment_measurement(uuid) from public;
revoke all on function public.advance_partner_commitment(uuid,text,text) from public;
revoke all on function public.get_partner_commitment_ledger(uuid) from public;
revoke all on function public.get_event_partner_commitment_summary(uuid) from public;
revoke all on function public.get_partner_program_commitment_memory(uuid) from public;

grant execute on function public.review_partner_commitment_manual_measurement(uuid,text,text) to authenticated;
grant execute on function public.record_manual_partner_commitment_measurement(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.refresh_partner_commitment_measurement(uuid) to authenticated;
grant execute on function public.advance_partner_commitment(uuid,text,text) to authenticated;
grant execute on function public.get_partner_commitment_ledger(uuid) to authenticated;
grant execute on function public.get_event_partner_commitment_summary(uuid) to authenticated;
grant execute on function public.get_partner_program_commitment_memory(uuid) to authenticated;

comment on function public.partner_commitment_effective_revision(uuid) is
  'Keeps a previously accepted operating contract effective while an immutable amendment awaits fresh bilateral acceptance.';
comment on function public.partner_commitment_has_semantic_overlap(uuid) is
  'Prevents parallel accepted obligations with indistinguishable party/resource/domain/window semantics that could double-claim the same activity.';
comment on table public.partner_commitment_manual_measurement_reviews is
  'Append-only bilateral review of the underlying manual delivery assertion. Manual claims can remain pending or disputed without becoming hidden verified facts.';
comment on function public.get_partner_program_commitment_memory(uuid) is
  'Owner-private longitudinal memory with explicit measurement coverage; unknown evidence is never coerced to zero utilization.';
