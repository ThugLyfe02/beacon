-- Partner Commitment Ledger governance, preflight, and bilateral closeout
--
-- The ledger already records immutable commitments, revisions, decisions,
-- delivery state, measurements, evidence quality, and reusable Partner Program
-- memory. This layer closes the next-order B2B gaps:
--
--   * accepted terms receive a tamper-evident server-side contract seal;
--   * the two communities can see operational exceptions before an event rather
--     than discovering them at closeout;
--   * ended-event evidence is captured into an immutable point-in-time snapshot;
--   * both community owners can independently acknowledge or dispute the exact
--     same closeout snapshot;
--   * late evidence does not silently rewrite a settled history -- a changed
--     evidence payload makes the prior snapshot stale and requires a new version;
--   * reusable Partner Programs can distinguish settled institutional evidence
--     from provisional, disputed, or stale event history.
--
-- A seal is tamper-evident inside Beacon's database. It is NOT an external
-- signature, blockchain notarization, legal opinion, or proof that a party
-- performed the real-world work. Closeout settlement means both communities
-- reviewed the same evidence snapshot; it does not prove causality or commercial
-- success.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Accepted-contract seals
-- ---------------------------------------------------------------------------

create table if not exists public.partner_commitment_acceptance_seals (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.partner_commitment_scopes(id) on delete restrict,
  commitment_id uuid not null references public.partner_commitments(id) on delete restrict,
  revision_id uuid not null unique references public.partner_commitment_revisions(id) on delete restrict,
  previous_seal_hash text,
  seal_hash text not null unique,
  sealed_at timestamptz not null default now(),
  check (char_length(seal_hash) = 64),
  check (previous_seal_hash is null or char_length(previous_seal_hash) = 64)
);

create index if not exists partner_commitment_acceptance_seals_scope_idx
  on public.partner_commitment_acceptance_seals (scope_id, commitment_id, sealed_at, id);

alter table public.partner_commitment_acceptance_seals enable row level security;
revoke all on public.partner_commitment_acceptance_seals from authenticated, anon;

create or replace function public.compute_partner_commitment_acceptance_seal(
  p_revision_id uuid,
  p_previous_seal_hash text
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
  ), accepted_decisions as (
    select string_agg(
      d.actor_role || ':' || d.actor_user_id::text,
      ',' order by d.actor_role, d.actor_user_id::text
    ) as decision_fingerprint
    from (
      select distinct on (pd.actor_role)
        pd.actor_role,
        pd.actor_user_id,
        pd.decision
      from public.partner_commitment_decisions pd
      where pd.revision_id = p_revision_id
      order by pd.actor_role, pd.created_at desc, pd.id desc
    ) d
    where d.decision = 'accepted'
  )
  select encode(
    digest(
      convert_to(
        concat_ws('|',
          'partner-commitment-contract-v1',
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
          coalesce(a.decision_fingerprint, ''),
          coalesce(p_previous_seal_hash, 'GENESIS')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from contract c
  cross join accepted_decisions a;
$$;

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

  v_hash := public.compute_partner_commitment_acceptance_seal(new.revision_id, v_previous_hash);
  if v_hash is null then raise exception 'could not compute partner commitment contract seal'; end if;

  insert into public.partner_commitment_acceptance_seals (
    scope_id, commitment_id, revision_id, previous_seal_hash, seal_hash
  ) values (
    v_scope_id, v_commitment_id, new.revision_id, v_previous_hash, v_hash
  ) on conflict (revision_id) do nothing;

  return new;
end;
$$;

drop trigger if exists seal_partner_commitment_after_decision
  on public.partner_commitment_decisions;
create trigger seal_partner_commitment_after_decision
after insert on public.partner_commitment_decisions
for each row execute function public.seal_partner_commitment_acceptance();

-- Backfill already-accepted revisions in contiguous revision order. The seal
-- records the existing immutable data; it does not retroactively claim an
-- external signature existed before this migration.
do $$
declare
  v_revision record;
  v_previous_hash text;
  v_hash text;
begin
  for v_revision in
    select r.id as revision_id, r.commitment_id, c.scope_id, r.revision_no
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    where public.partner_commitment_acceptance_state(r.id) = 'accepted'
    order by r.commitment_id, r.revision_no, r.id
  loop
    if exists (
      select 1 from public.partner_commitment_acceptance_seals s
      where s.revision_id = v_revision.revision_id
    ) then
      select s.seal_hash into v_previous_hash
      from public.partner_commitment_acceptance_seals s
      where s.revision_id = v_revision.revision_id;
      continue;
    end if;

    select s.seal_hash into v_previous_hash
    from public.partner_commitment_acceptance_seals s
    join public.partner_commitment_revisions previous_revision on previous_revision.id = s.revision_id
    where s.commitment_id = v_revision.commitment_id
      and previous_revision.revision_no < v_revision.revision_no
    order by previous_revision.revision_no desc, s.id desc
    limit 1;

    v_hash := public.compute_partner_commitment_acceptance_seal(
      v_revision.revision_id,
      v_previous_hash
    );

    insert into public.partner_commitment_acceptance_seals (
      scope_id, commitment_id, revision_id, previous_seal_hash, seal_hash
    ) values (
      v_revision.scope_id,
      v_revision.commitment_id,
      v_revision.revision_id,
      v_previous_hash,
      v_hash
    ) on conflict (revision_id) do nothing;
  end loop;
end;
$$;

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
  v_accepted integer := 0;
  v_fingerprint text;
  v_last_commitment uuid;
begin
  if auth.uid() is null or not public.partner_commitment_scope_access(p_scope_id, auth.uid()) then
    return;
  end if;

  select count(*)::integer into v_accepted
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  where c.scope_id = p_scope_id
    and public.partner_commitment_acceptance_state(r.id) = 'accepted';

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

    v_expected_hash := public.compute_partner_commitment_acceptance_seal(
      v_row.revision_id,
      v_previous_hash
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
      convert_to(string_agg(s.seal_hash, '|' order by s.commitment_id, r.revision_no, s.id), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) end
  into v_fingerprint
  from public.partner_commitment_acceptance_seals s
  join public.partner_commitment_revisions r on r.id = s.revision_id
  where s.scope_id = p_scope_id;

  return query select
    v_invalid is null and v_sealed = v_accepted,
    v_sealed,
    v_accepted,
    v_invalid,
    v_fingerprint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deterministic execution preflight
-- ---------------------------------------------------------------------------

create or replace function public.partner_commitment_has_native_delivery_adapter(
  p_commitment_type text,
  p_domain text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_commitment_type = 'office_hours_slots' then p_domain is null
    when p_commitment_type = 'focus_windows' then true
    when p_commitment_type = 'community_member_capacity' then true
    else false
  end;
$$;

create or replace function public.partner_commitment_requires_scheduling(p_commitment_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_commitment_type in (
    'mentor_slots',
    'office_hours_slots',
    'hiring_conversations',
    'technical_review_sessions',
    'investor_advisor_sessions',
    'workshops',
    'focus_windows',
    'speaker_sessions',
    'facilitator_hours'
  );
$$;

create or replace function public.get_partner_commitment_execution_preflight(p_scope_id uuid)
returns table (
  severity text,
  issue_code text,
  commitment_id uuid,
  revision_id uuid,
  party_label text,
  detail text,
  suggested_action text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.partner_commitment_scope_access(p_scope_id, auth.uid()) then
    return;
  end if;

  return query
  with roots as (
    select
      c.*,
      public.partner_commitment_effective_revision(c.id) as effective_revision_id,
      public.partner_commitment_pending_revision(c.id) as pending_revision_id,
      (select r.id from public.partner_commitment_revisions r
       where r.commitment_id = c.id order by r.revision_no desc limit 1) as latest_revision_id
    from public.partner_commitments c
    where c.scope_id = p_scope_id
  ), rows as (
    select
      roots.*,
      coalesce(roots.effective_revision_id, roots.latest_revision_id) as display_revision_id
    from roots
  ), facts as (
    select
      r.*,
      revision.commitment_type,
      revision.domain,
      revision.window_start,
      revision.window_end,
      public.partner_commitment_acceptance_state(revision.id) as acceptance_state,
      public.partner_commitment_latest_status(revision.id) as lifecycle_status,
      case
        when r.committed_party_kind = 'event-host' then 'Event host'
        when r.committed_community_id = s.community_a_id then a.name
        else b.name
      end as party_label,
      m.id as measurement_id,
      m.measurement_state,
      case when m.id is null then 'not-required'
        else public.partner_commitment_manual_measurement_review_state(m.id) end as manual_review_state,
      s.scope_kind,
      s.event_id,
      e.ended_at
    from rows r
    join public.partner_commitment_revisions revision on revision.id = r.display_revision_id
    join public.partner_commitment_scopes s on s.id = r.scope_id
    join public.community_partners a on a.id = s.community_a_id
    join public.community_partners b on b.id = s.community_b_id
    left join public.events e on e.id = s.event_id
    left join lateral (
      select pm.* from public.partner_commitment_measurements pm
      where pm.revision_id = revision.id
      order by pm.measurement_no desc, pm.observed_at desc, pm.id desc
      limit 1
    ) m on true
  ), issues as (
    select
      'block'::text as severity,
      'acceptance-pending'::text as issue_code,
      f.id as commitment_id,
      f.display_revision_id as revision_id,
      f.party_label,
      'This obligation has no accepted operating revision yet.'::text as detail,
      'Every required party should explicitly accept or reject the current revision before delivery begins.'::text as suggested_action
    from facts f
    where f.scope_kind = 'event-exchange'
      and f.effective_revision_id is null
      and f.acceptance_state = 'awaiting-acceptance'

    union all

    select
      'review',
      'amendment-pending',
      f.id,
      f.pending_revision_id,
      f.party_label,
      'An accepted obligation remains in force while a newer amendment is awaiting fresh acceptance.',
      'Review the pending amendment; do not operate as though the proposed terms already replaced the accepted contract.'
    from facts f
    where f.pending_revision_id is not null
      and f.effective_revision_id is not null

    union all

    select
      case when f.window_start is not null and f.window_start <= now() + interval '2 hours'
        then 'review' else 'info' end,
      'schedule-not-declared',
      f.id,
      f.display_revision_id,
      f.party_label,
      'This accepted session-like obligation has not entered the scheduled lifecycle state.',
      'Confirm the delivery plan and mark it scheduled when the committed party has a real operating slot.'
    from facts f
    where f.scope_kind = 'event-exchange'
      and f.effective_revision_id is not null
      and f.lifecycle_status = 'accepted'
      and public.partner_commitment_requires_scheduling(f.commitment_type)

    union all

    select
      'info',
      'manual-measurement-route',
      f.id,
      f.display_revision_id,
      f.party_label,
      'Beacon does not currently have a native delivery adapter for this exact resource/domain contract.',
      'Plan for an explicit committed-party measurement that the required counterparties can review; do not infer delivery from unrelated telemetry.'
    from facts f
    where f.scope_kind = 'event-exchange'
      and f.effective_revision_id is not null
      and f.lifecycle_status in ('accepted','scheduled','delivering')
      and not public.partner_commitment_has_native_delivery_adapter(f.commitment_type, f.domain)

    union all

    select
      case when f.manual_review_state = 'disputed' then 'block' else 'review' end,
      case when f.manual_review_state = 'disputed' then 'manual-evidence-disputed' else 'manual-evidence-pending' end,
      f.id,
      f.display_revision_id,
      f.party_label,
      case when f.manual_review_state = 'disputed'
        then 'A required counterparty disputed the manual delivery assertion attached to this obligation.'
        else 'A manual delivery assertion is still waiting for required counterparty acknowledgement.' end,
      case when f.manual_review_state = 'disputed'
        then 'Resolve the operating disagreement or record a new supported measurement; do not finalize from disputed evidence.'
        else 'Have the remaining required party review the manual assertion before using it to close the obligation.' end
    from facts f
    where f.manual_review_state in ('pending','disputed')

    union all

    select
      'review',
      'window-closed-without-measurement',
      f.id,
      f.display_revision_id,
      f.party_label,
      'The delivery window is closed, but no measurement snapshot exists for this accepted obligation.',
      'Refresh native evidence or record an explicit zero/partial manual measurement so closeout does not confuse unknown with zero.'
    from facts f
    where f.scope_kind = 'event-exchange'
      and f.effective_revision_id is not null
      and f.measurement_id is null
      and f.lifecycle_status in ('accepted','scheduled','delivering')
      and (f.ended_at is not null or (f.window_end is not null and f.window_end <= now()))
  )
  select * from issues
  order by case severity when 'block' then 0 when 'review' then 1 else 2 end,
           party_label, issue_code, commitment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immutable bilateral closeout snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.partner_commitment_closeout_snapshots (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.partner_commitment_scopes(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  snapshot_no integer not null check (snapshot_no >= 1),
  event_ended_at timestamptz not null,
  snapshot_payload jsonb not null,
  snapshot_hash text not null unique,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (scope_id, snapshot_no),
  check (char_length(snapshot_hash) = 64),
  check (jsonb_typeof(snapshot_payload) = 'array')
);

create table if not exists public.partner_commitment_closeout_decisions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.partner_commitment_closeout_snapshots(id) on delete restrict,
  actor_role text not null check (actor_role in ('community-a','community-b')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('acknowledged','disputed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, actor_role, idempotency_key),
  check (char_length(idempotency_key) between 20 and 180)
);

create index if not exists partner_commitment_closeout_scope_idx
  on public.partner_commitment_closeout_snapshots (scope_id, snapshot_no desc, created_at desc);
create index if not exists partner_commitment_closeout_decision_latest_idx
  on public.partner_commitment_closeout_decisions (snapshot_id, actor_role, created_at desc, id desc);

alter table public.partner_commitment_closeout_snapshots enable row level security;
alter table public.partner_commitment_closeout_decisions enable row level security;
revoke all on public.partner_commitment_closeout_snapshots from authenticated, anon;
revoke all on public.partner_commitment_closeout_decisions from authenticated, anon;

create or replace function public.reject_partner_commitment_governance_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'partner commitment governance evidence is append-only';
end;
$$;

create trigger partner_commitment_acceptance_seal_immutable
before update or delete on public.partner_commitment_acceptance_seals
for each row execute function public.reject_partner_commitment_governance_mutation();
create trigger partner_commitment_closeout_snapshot_immutable
before update or delete on public.partner_commitment_closeout_snapshots
for each row execute function public.reject_partner_commitment_governance_mutation();
create trigger partner_commitment_closeout_decision_immutable
before update or delete on public.partner_commitment_closeout_decisions
for each row execute function public.reject_partner_commitment_governance_mutation();

create or replace function public.partner_commitment_closeout_payload(p_scope_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with roots as (
    select
      c.*,
      public.partner_commitment_effective_revision(c.id) as effective_revision_id,
      public.partner_commitment_pending_revision(c.id) as pending_revision_id,
      (select r.id from public.partner_commitment_revisions r
       where r.commitment_id = c.id order by r.revision_no desc limit 1) as latest_revision_id
    from public.partner_commitments c
    where c.scope_id = p_scope_id
  ), chosen as (
    select roots.*, coalesce(roots.effective_revision_id, roots.latest_revision_id) as display_revision_id
    from roots
  ), rows as (
    select
      c.id as commitment_id,
      r.id as revision_id,
      r.revision_no,
      c.effective_revision_id,
      c.pending_revision_id,
      c.committed_party_kind,
      c.committed_community_id,
      r.commitment_type,
      r.domain,
      r.committed_quantity,
      r.window_start,
      r.window_end,
      public.partner_commitment_acceptance_state(r.id) as acceptance_state,
      public.partner_commitment_latest_status(r.id) as lifecycle_status,
      seal.seal_hash,
      m.id as measurement_id,
      m.delivered_quantity,
      m.utilized_quantity,
      m.measurement_state,
      m.evidence_quality,
      coalesce(m.evidence_sources, '{}'::text[]) as evidence_sources,
      m.supported_bilateral_outcomes,
      m.supported_warm_introductions,
      case when m.id is null then 'not-required'
        else public.partner_commitment_manual_measurement_review_state(m.id) end as manual_review_state
    from chosen c
    join public.partner_commitment_revisions r on r.id = c.display_revision_id
    left join public.partner_commitment_acceptance_seals seal on seal.revision_id = r.id
    left join lateral (
      select pm.*
      from public.partner_commitment_measurements pm
      where pm.revision_id = r.id
      order by pm.measurement_no desc, pm.observed_at desc, pm.id desc
      limit 1
    ) m on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'commitmentId', commitment_id,
        'revisionId', revision_id,
        'revisionNo', revision_no,
        'effectiveRevisionId', effective_revision_id,
        'pendingRevisionId', pending_revision_id,
        'partyKind', committed_party_kind,
        'communityId', committed_community_id,
        'type', commitment_type,
        'domain', domain,
        'committed', committed_quantity,
        'windowStart', window_start,
        'windowEnd', window_end,
        'acceptance', acceptance_state,
        'status', lifecycle_status,
        'contractSeal', seal_hash,
        'measurementId', measurement_id,
        'delivered', delivered_quantity,
        'utilized', utilized_quantity,
        'measurementState', measurement_state,
        'evidenceQuality', evidence_quality,
        'evidenceSources', evidence_sources,
        'supportedBilateralOutcomes', supported_bilateral_outcomes,
        'supportedWarmIntroductions', supported_warm_introductions,
        'manualReviewState', manual_review_state
      ) order by commitment_id, revision_no, revision_id
    ),
    '[]'::jsonb
  )
  from rows;
$$;

create or replace function public.compute_partner_commitment_closeout_hash(
  p_scope_id uuid,
  p_snapshot_no integer,
  p_event_ended_at timestamptz,
  p_payload jsonb
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(
      convert_to(
        concat_ws('|',
          'partner-commitment-closeout-v1',
          coalesce(p_scope_id::text, ''),
          coalesce(p_snapshot_no::text, ''),
          coalesce(extract(epoch from p_event_ended_at)::bigint::text, ''),
          coalesce(p_payload::text, '[]')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.capture_partner_commitment_closeout_snapshot_internal(
  p_scope_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_scope public.partner_commitment_scopes;
  v_event public.events;
  v_latest public.partner_commitment_closeout_snapshots;
  v_payload jsonb;
  v_snapshot_no integer;
  v_hash text;
  v_id uuid;
begin
  select * into v_scope from public.partner_commitment_scopes where id = p_scope_id;
  if v_scope.id is null or v_scope.scope_kind <> 'event-exchange' then
    raise exception 'event commitment scope required';
  end if;

  select * into v_event from public.events where id = v_scope.event_id;
  if v_event.ended_at is null then raise exception 'event must be ended before closeout snapshot'; end if;

  perform pg_advisory_xact_lock(hashtext('partner-closeout:' || p_scope_id::text));

  v_payload := public.partner_commitment_closeout_payload(p_scope_id);
  select * into v_latest
  from public.partner_commitment_closeout_snapshots s
  where s.scope_id = p_scope_id
  order by s.snapshot_no desc, s.created_at desc, s.id desc
  limit 1;

  -- No-op if the exact evidence payload is already snapshotted. This keeps
  -- retries idempotent without pretending a later timestamp is new evidence.
  if v_latest.id is not null and v_latest.snapshot_payload = v_payload then
    return v_latest.id;
  end if;

  v_snapshot_no := coalesce(v_latest.snapshot_no, 0) + 1;
  v_hash := public.compute_partner_commitment_closeout_hash(
    p_scope_id,
    v_snapshot_no,
    v_event.ended_at,
    v_payload
  );

  insert into public.partner_commitment_closeout_snapshots (
    scope_id, event_id, snapshot_no, event_ended_at,
    snapshot_payload, snapshot_hash, created_by
  ) values (
    p_scope_id, v_scope.event_id, v_snapshot_no, v_event.ended_at,
    v_payload, v_hash, p_created_by
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.capture_partner_commitment_closeout_snapshot(p_scope_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.partner_commitment_scope_access(p_scope_id, auth.uid()) then
    raise exception 'shared partnership scope required';
  end if;
  return public.capture_partner_commitment_closeout_snapshot_internal(p_scope_id, auth.uid());
end;
$$;

create or replace function public.partner_commitment_closeout_settlement_state(p_snapshot_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_snapshot public.partner_commitment_closeout_snapshots;
  v_current jsonb;
  v_role text;
  v_decision text;
  v_pending boolean := false;
begin
  select * into v_snapshot
  from public.partner_commitment_closeout_snapshots
  where id = p_snapshot_id;
  if v_snapshot.id is null then return 'missing'; end if;

  v_current := public.partner_commitment_closeout_payload(v_snapshot.scope_id);
  if v_current is distinct from v_snapshot.snapshot_payload then
    return 'stale';
  end if;

  foreach v_role in array array['community-a','community-b']::text[] loop
    select d.decision into v_decision
    from public.partner_commitment_closeout_decisions d
    where d.snapshot_id = p_snapshot_id and d.actor_role = v_role
    order by d.created_at desc, d.id desc
    limit 1;

    if v_decision = 'disputed' then return 'disputed'; end if;
    if v_decision is distinct from 'acknowledged' then v_pending := true; end if;
  end loop;

  if v_pending then return 'pending'; end if;
  return 'settled';
end;
$$;

create or replace function public.decide_partner_commitment_closeout(
  p_snapshot_id uuid,
  p_decision text,
  p_idempotency_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.partner_commitment_closeout_snapshots;
  v_latest_id uuid;
  v_scope public.partner_commitment_scopes;
  v_roles text[];
  v_role text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_decision not in ('acknowledged','disputed') then raise exception 'unsupported closeout decision'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;

  select * into v_snapshot from public.partner_commitment_closeout_snapshots where id = p_snapshot_id;
  if v_snapshot.id is null then raise exception 'closeout snapshot not found'; end if;
  select * into v_scope from public.partner_commitment_scopes where id = v_snapshot.scope_id;
  if not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then
    raise exception 'shared partnership scope required';
  end if;

  select id into v_latest_id
  from public.partner_commitment_closeout_snapshots
  where scope_id = v_scope.id
  order by snapshot_no desc, created_at desc, id desc
  limit 1;
  if v_latest_id is distinct from p_snapshot_id then
    raise exception 'only the latest closeout evidence version may receive a decision';
  end if;
  if public.partner_commitment_closeout_settlement_state(p_snapshot_id) = 'stale' then
    raise exception 'closeout evidence changed; capture a new snapshot before deciding';
  end if;

  v_roles := public.partner_commitment_actor_roles(v_scope.id, auth.uid());
  v_roles := array(select unnest(v_roles) intersect select unnest(array['community-a','community-b']::text[]));
  if cardinality(coalesce(v_roles, '{}'::text[])) = 0 then
    raise exception 'community owner scope required for bilateral closeout decision';
  end if;

  foreach v_role in array v_roles loop
    if not exists (
      select 1 from public.partner_commitment_closeout_decisions d
      where d.actor_user_id = auth.uid()
        and d.actor_role = v_role
        and d.idempotency_key = trim(p_idempotency_key)
    ) then
      insert into public.partner_commitment_closeout_decisions (
        snapshot_id, actor_role, actor_user_id, decision, idempotency_key
      ) values (
        p_snapshot_id, v_role, auth.uid(), p_decision, trim(p_idempotency_key)
      );
    end if;
  end loop;

  return public.partner_commitment_closeout_settlement_state(p_snapshot_id);
end;
$$;

create or replace function public.get_partner_commitment_closeout(p_scope_id uuid)
returns table (
  snapshot_id uuid,
  snapshot_no integer,
  snapshot_hash text,
  settlement_state text,
  is_current boolean,
  event_ended_at timestamptz,
  commitment_count integer,
  terminal_commitment_count integer,
  measured_commitment_count integer,
  manual_pending_count integer,
  manual_dispute_count integer,
  caller_can_decide boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_snapshot public.partner_commitment_closeout_snapshots;
  v_state text;
  v_roles text[];
begin
  if auth.uid() is null or not public.partner_commitment_scope_access(p_scope_id, auth.uid()) then
    return;
  end if;

  select * into v_snapshot
  from public.partner_commitment_closeout_snapshots s
  where s.scope_id = p_scope_id
  order by s.snapshot_no desc, s.created_at desc, s.id desc
  limit 1;
  if v_snapshot.id is null then return; end if;

  v_state := public.partner_commitment_closeout_settlement_state(v_snapshot.id);
  v_roles := public.partner_commitment_actor_roles(p_scope_id, auth.uid());

  return query
  select
    v_snapshot.id,
    v_snapshot.snapshot_no,
    v_snapshot.snapshot_hash,
    v_state,
    v_state <> 'stale',
    v_snapshot.event_ended_at,
    jsonb_array_length(v_snapshot.snapshot_payload),
    (select count(*)::integer from jsonb_array_elements(v_snapshot.snapshot_payload) item
      where item->>'status' in ('fulfilled','partially_fulfilled','cancelled','not_fulfilled','rejected')),
    (select count(*)::integer from jsonb_array_elements(v_snapshot.snapshot_payload) item
      where item->>'measurementState' in ('measured','partial','manual-only')),
    (select count(*)::integer from jsonb_array_elements(v_snapshot.snapshot_payload) item
      where item->>'manualReviewState' = 'pending'),
    (select count(*)::integer from jsonb_array_elements(v_snapshot.snapshot_payload) item
      where item->>'manualReviewState' = 'disputed'),
    exists (
      select 1 from unnest(v_roles) role
      where role in ('community-a','community-b')
    ),
    v_snapshot.created_at;
end;
$$;

-- Automatically capture a first immutable evidence version when an event ends.
-- Late participant receipts or later evidence refresh can make this snapshot
-- stale; that is intentional and visible rather than silently rewriting history.
create or replace function public.capture_partner_commitment_scope_closeouts_after_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_id uuid;
begin
  if old.ended_at is null and new.ended_at is not null then
    for v_scope_id in
      select s.id
      from public.partner_commitment_scopes s
      where s.scope_kind = 'event-exchange' and s.event_id = new.id
      order by s.id
    loop
      perform public.capture_partner_commitment_closeout_snapshot_internal(v_scope_id, null);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_partner_commitment_scope_closeouts_after_event
  on public.events;
create trigger capture_partner_commitment_scope_closeouts_after_event
after update of ended_at on public.events
for each row execute function public.capture_partner_commitment_scope_closeouts_after_event();

-- ---------------------------------------------------------------------------
-- Repeat-program evidence maturity
-- ---------------------------------------------------------------------------

create or replace function public.get_partner_program_commitment_settlement_summary(p_program_id uuid)
returns table (
  ended_event_count integer,
  event_scope_count integer,
  settled_scope_count integer,
  pending_scope_count integer,
  disputed_scope_count integer,
  stale_scope_count integer,
  settlement_coverage numeric
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
  with scopes as (
    select s.id as scope_id, s.event_id
    from public.partner_commitment_scopes s
    join public.events e on e.id = s.event_id
    where s.scope_kind = 'event-exchange'
      and s.program_id = p_program_id
      and e.ended_at is not null
  ), latest as (
    select
      scopes.*,
      snapshot.id as snapshot_id
    from scopes
    left join lateral (
      select cs.id
      from public.partner_commitment_closeout_snapshots cs
      where cs.scope_id = scopes.scope_id
      order by cs.snapshot_no desc, cs.created_at desc, cs.id desc
      limit 1
    ) snapshot on true
  ), states as (
    select
      latest.*,
      case when latest.snapshot_id is null then 'pending'
        else public.partner_commitment_closeout_settlement_state(latest.snapshot_id) end as state
    from latest
  )
  select
    count(distinct event_id)::integer,
    count(*)::integer,
    count(*) filter (where state = 'settled')::integer,
    count(*) filter (where state = 'pending')::integer,
    count(*) filter (where state = 'disputed')::integer,
    count(*) filter (where state = 'stale')::integer,
    round(
      count(*) filter (where state = 'settled')::numeric / greatest(1, count(*)),
      4
    )
  from states;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and trust-language comments
-- ---------------------------------------------------------------------------

revoke all on function public.compute_partner_commitment_acceptance_seal(uuid,text) from public;
revoke all on function public.seal_partner_commitment_acceptance() from public;
revoke all on function public.verify_partner_commitment_scope_integrity(uuid) from public;
revoke all on function public.partner_commitment_has_native_delivery_adapter(text,text) from public;
revoke all on function public.partner_commitment_requires_scheduling(text) from public;
revoke all on function public.get_partner_commitment_execution_preflight(uuid) from public;
revoke all on function public.reject_partner_commitment_governance_mutation() from public;
revoke all on function public.partner_commitment_closeout_payload(uuid) from public;
revoke all on function public.compute_partner_commitment_closeout_hash(uuid,integer,timestamptz,jsonb) from public;
revoke all on function public.capture_partner_commitment_closeout_snapshot_internal(uuid,uuid) from public;
revoke all on function public.capture_partner_commitment_closeout_snapshot(uuid) from public;
revoke all on function public.partner_commitment_closeout_settlement_state(uuid) from public;
revoke all on function public.decide_partner_commitment_closeout(uuid,text,text) from public;
revoke all on function public.get_partner_commitment_closeout(uuid) from public;
revoke all on function public.capture_partner_commitment_scope_closeouts_after_event() from public;
revoke all on function public.get_partner_program_commitment_settlement_summary(uuid) from public;

grant execute on function public.verify_partner_commitment_scope_integrity(uuid) to authenticated;
grant execute on function public.get_partner_commitment_execution_preflight(uuid) to authenticated;
grant execute on function public.capture_partner_commitment_closeout_snapshot(uuid) to authenticated;
grant execute on function public.decide_partner_commitment_closeout(uuid,text,text) to authenticated;
grant execute on function public.get_partner_commitment_closeout(uuid) to authenticated;
grant execute on function public.get_partner_program_commitment_settlement_summary(uuid) to authenticated;

comment on table public.partner_commitment_acceptance_seals is
  'Tamper-evident server-side fingerprints of accepted immutable commitment revisions. Not an external signature, notarization, or legal opinion.';
comment on function public.get_partner_commitment_execution_preflight(uuid) is
  'Deterministic operating exceptions for a shared commitment scope. It emits explainable issue codes, not a partner score or prediction.';
comment on table public.partner_commitment_closeout_snapshots is
  'Immutable point-in-time B2B closeout evidence. Later evidence creates a new snapshot version instead of rewriting a previously reviewed record.';
comment on function public.partner_commitment_closeout_settlement_state(uuid) is
  'Bilateral evidence-review state. Settled means both communities acknowledged the same current snapshot; it does not establish causality or commercial success.';
comment on function public.get_partner_program_commitment_settlement_summary(uuid) is
  'Owner-private evidence-maturity summary for repeat Partner Programs. Settled evidence is distinguished from pending, disputed, and stale history.';
