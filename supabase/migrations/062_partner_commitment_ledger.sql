-- Partner Commitment Ledger
--
-- Community partnerships become operationally useful when both sides can answer
-- what each organization actually promised, what was delivered, what was used,
-- and what supported outcomes followed. This migration creates a bilateral,
-- append-only operating contract for reusable Partner Programs and event-scoped
-- Community Exchanges without inventing a cross-resource score or public
-- reputation ranking.
--
-- Core rules:
--   * a party may propose only its own commitment;
--   * every commitment requires the counterpart's explicit acceptance;
--   * event-host commitments require both community owners plus the host;
--   * accepted quantities are never edited in place -- revisions supersede;
--   * native event state can support fulfillment, but elapsed time never does;
--   * manual acknowledgement is permitted and labelled lower-quality;
--   * participant-derived result evidence remains aggregate and cohort-gated;
--   * historical configuration can prefill a future event but never auto-binds.

alter table public.community_exchange_agreements
  add column if not exists source_program_id uuid
    references public.community_partner_programs(id) on delete set null;

create table if not exists public.partner_commitment_scopes (
  id uuid primary key default gen_random_uuid(),
  scope_kind text not null check (scope_kind in ('program-template','event-exchange')),
  program_id uuid references public.community_partner_programs(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  exchange_id uuid references public.community_exchange_agreements(id) on delete cascade,
  community_a_id uuid not null references public.community_partners(id) on delete cascade,
  community_b_id uuid not null references public.community_partners(id) on delete cascade,
  host_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (community_a_id <> community_b_id),
  check (community_a_id::text < community_b_id::text),
  check (
    (scope_kind = 'program-template' and program_id is not null and event_id is null and exchange_id is null and host_id is null)
    or
    (scope_kind = 'event-exchange' and event_id is not null and exchange_id is not null and host_id is not null)
  )
);

create unique index if not exists partner_commitment_scope_program_idx
  on public.partner_commitment_scopes (program_id)
  where scope_kind = 'program-template';
create unique index if not exists partner_commitment_scope_exchange_idx
  on public.partner_commitment_scopes (exchange_id)
  where scope_kind = 'event-exchange';
create index if not exists partner_commitment_scope_event_idx
  on public.partner_commitment_scopes (event_id, created_at desc)
  where scope_kind = 'event-exchange';

create table if not exists public.partner_commitments (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.partner_commitment_scopes(id) on delete cascade,
  committed_party_kind text not null check (committed_party_kind in ('community','event-host')),
  committed_community_id uuid references public.community_partners(id) on delete cascade,
  source_template_revision_id uuid,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (committed_party_kind = 'community' and committed_community_id is not null)
    or
    (committed_party_kind = 'event-host' and committed_community_id is null)
  )
);

create index if not exists partner_commitments_scope_idx
  on public.partner_commitments (scope_id, created_at, id);

create table if not exists public.partner_commitment_revisions (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.partner_commitments(id) on delete cascade,
  revision_no integer not null check (revision_no >= 1),
  commitment_type text not null check (commitment_type in (
    'mentor_slots',
    'office_hours_slots',
    'hiring_conversations',
    'technical_review_sessions',
    'founder_seats',
    'investor_advisor_sessions',
    'workshops',
    'focus_windows',
    'speaker_sessions',
    'facilitator_hours',
    'community_member_capacity',
    'domain_support_capacity'
  )),
  domain text check (domain is null or domain in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  )),
  committed_quantity numeric(12,2) not null check (committed_quantity > 0 and committed_quantity <= 10000),
  window_start timestamptz,
  window_end timestamptz,
  supersedes_revision_id uuid references public.partner_commitment_revisions(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (commitment_id, revision_no),
  unique (created_by, idempotency_key),
  check (char_length(idempotency_key) between 20 and 180),
  check (window_end is null or window_start is not null),
  check (window_end is null or window_end > window_start),
  check (commitment_type <> 'domain_support_capacity' or domain is not null)
);

alter table public.partner_commitments
  drop constraint if exists partner_commitments_source_template_revision_id_fkey;
alter table public.partner_commitments
  add constraint partner_commitments_source_template_revision_id_fkey
  foreign key (source_template_revision_id)
  references public.partner_commitment_revisions(id)
  on delete set null;

create unique index if not exists partner_commitments_template_copy_idx
  on public.partner_commitments (scope_id, source_template_revision_id)
  where source_template_revision_id is not null;
create index if not exists partner_commitment_revision_current_idx
  on public.partner_commitment_revisions (commitment_id, revision_no desc, created_at desc);

create table if not exists public.partner_commitment_decisions (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.partner_commitment_revisions(id) on delete cascade,
  actor_role text not null check (actor_role in ('community-a','community-b','event-host')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('accepted','rejected','withdrawn')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, actor_role, idempotency_key),
  check (char_length(idempotency_key) between 20 and 180)
);

create index if not exists partner_commitment_decision_latest_idx
  on public.partner_commitment_decisions (revision_id, actor_role, created_at desc, id desc);

create table if not exists public.partner_commitment_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.partner_commitment_revisions(id) on delete cascade,
  status text not null check (status in (
    'proposed','accepted','rejected','scheduled','delivering',
    'fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  )),
  actor_kind text not null check (actor_kind in ('system','community','event-host')),
  actor_user_id uuid references public.users(id) on delete restrict,
  reason_code text not null check (reason_code in (
    'proposal-created',
    'bilateral-acceptance-complete',
    'required-party-rejected',
    'partner-withdrawn',
    'scheduled-by-committed-party',
    'delivery-started',
    'server-evidence-satisfied',
    'server-evidence-partial',
    'manual-measurement-finalized',
    'committed-party-cancelled',
    'event-cancelled',
    'event-window-closed-without-delivery'
  )),
  idempotency_key text,
  created_at timestamptz not null default now(),
  check ((actor_kind = 'system' and actor_user_id is null) or actor_kind <> 'system'),
  check (idempotency_key is null or char_length(idempotency_key) between 20 and 180)
);

create unique index if not exists partner_commitment_lifecycle_idempotency_idx
  on public.partner_commitment_lifecycle_events (actor_user_id, idempotency_key)
  where actor_user_id is not null and idempotency_key is not null;
create index if not exists partner_commitment_lifecycle_latest_idx
  on public.partner_commitment_lifecycle_events (revision_id, created_at desc, id desc);

create table if not exists public.partner_commitment_measurements (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.partner_commitment_revisions(id) on delete cascade,
  measurement_no integer not null check (measurement_no >= 1),
  delivered_quantity numeric(12,2) not null default 0 check (delivered_quantity >= 0),
  utilized_quantity numeric(12,2) not null default 0 check (utilized_quantity >= 0),
  supported_bilateral_outcomes integer check (supported_bilateral_outcomes is null or supported_bilateral_outcomes >= 0),
  supported_warm_introductions integer check (supported_warm_introductions is null or supported_warm_introductions >= 0),
  measurement_state text not null check (measurement_state in (
    'measured','partial','suppressed','manual-only','insufficient-evidence'
  )),
  evidence_quality text not null check (evidence_quality in (
    'server-recorded','participant-attested-aggregate','manual-operator','mixed','insufficient'
  )),
  evidence_sources text[] not null default '{}',
  supersedes_measurement_id uuid references public.partner_commitment_measurements(id) on delete restrict,
  created_by uuid references public.users(id) on delete restrict,
  idempotency_key text,
  observed_at timestamptz not null default now(),
  unique (revision_id, measurement_no),
  check (utilized_quantity <= delivered_quantity or delivered_quantity = 0),
  check (evidence_sources <@ array[
    'office-hours-completed',
    'focus-window-state',
    'community-affiliation',
    'outcome-receipts',
    'warm-introduction',
    'manual-operator',
    'event-closeout'
  ]::text[]),
  check (idempotency_key is null or char_length(idempotency_key) between 20 and 180)
);

create unique index if not exists partner_commitment_measurement_idempotency_idx
  on public.partner_commitment_measurements (created_by, idempotency_key)
  where created_by is not null and idempotency_key is not null;
create index if not exists partner_commitment_measurement_latest_idx
  on public.partner_commitment_measurements (revision_id, measurement_no desc, observed_at desc);

create table if not exists public.partner_commitment_evidence_links (
  id bigint generated always as identity primary key,
  revision_id uuid not null references public.partner_commitment_revisions(id) on delete cascade,
  first_measurement_id uuid not null references public.partner_commitment_measurements(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'office-hours','focus-window','warm-introduction','event-closeout'
  )),
  source_id uuid not null,
  evidence_quality text not null check (evidence_quality in ('server-recorded','participant-attested-aggregate')),
  recorded_at timestamptz not null default now(),
  unique (revision_id, source_kind, source_id)
);

create table if not exists public.partner_commitment_event_closeouts (
  event_id uuid not null references public.events(id) on delete cascade,
  revision_id uuid not null references public.partner_commitment_revisions(id) on delete cascade,
  ended_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (event_id, revision_id)
);

alter table public.partner_commitment_scopes enable row level security;
alter table public.partner_commitments enable row level security;
alter table public.partner_commitment_revisions enable row level security;
alter table public.partner_commitment_decisions enable row level security;
alter table public.partner_commitment_lifecycle_events enable row level security;
alter table public.partner_commitment_measurements enable row level security;
alter table public.partner_commitment_evidence_links enable row level security;
alter table public.partner_commitment_event_closeouts enable row level security;

-- Shared B2B state is exposed only through purpose-built RPC projections. Raw
-- rows contain actor and provenance references that should not become a member or
-- relationship directory.
revoke all on public.partner_commitment_scopes from authenticated, anon;
revoke all on public.partner_commitments from authenticated, anon;
revoke all on public.partner_commitment_revisions from authenticated, anon;
revoke all on public.partner_commitment_decisions from authenticated, anon;
revoke all on public.partner_commitment_lifecycle_events from authenticated, anon;
revoke all on public.partner_commitment_measurements from authenticated, anon;
revoke all on public.partner_commitment_evidence_links from authenticated, anon;
revoke all on public.partner_commitment_event_closeouts from authenticated, anon;

create or replace function public.reject_partner_commitment_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'partner commitment evidence is append-only; create a revision or event instead';
end;
$$;

create trigger partner_commitment_scope_update_guard
before update on public.partner_commitment_scopes
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_root_update_guard
before update on public.partner_commitments
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_revision_update_guard
before update on public.partner_commitment_revisions
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_decision_update_guard
before update on public.partner_commitment_decisions
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_lifecycle_update_guard
before update on public.partner_commitment_lifecycle_events
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_measurement_update_guard
before update on public.partner_commitment_measurements
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_evidence_update_guard
before update on public.partner_commitment_evidence_links
for each row execute function public.reject_partner_commitment_update();
create trigger partner_commitment_closeout_update_guard
before update on public.partner_commitment_event_closeouts
for each row execute function public.reject_partner_commitment_update();

create or replace function public.partner_commitment_scope_access(
  p_scope_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.partner_commitment_scopes s
    join public.community_partners a on a.id = s.community_a_id
    join public.community_partners b on b.id = s.community_b_id
    where s.id = p_scope_id
      and p_user_id is not null
      and (p_user_id in (a.owner_id, b.owner_id) or p_user_id = s.host_id)
  );
$$;

create or replace function public.partner_commitment_actor_roles(
  p_scope_id uuid,
  p_user_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_remove(array[
    case when a.owner_id = p_user_id then 'community-a' end,
    case when b.owner_id = p_user_id then 'community-b' end,
    case when s.scope_kind = 'event-exchange' and s.host_id = p_user_id then 'event-host' end
  ]::text[], null), '{}'::text[])
  from public.partner_commitment_scopes s
  join public.community_partners a on a.id = s.community_a_id
  join public.community_partners b on b.id = s.community_b_id
  where s.id = p_scope_id;
$$;

create or replace function public.partner_commitment_required_roles(p_revision_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.committed_party_kind = 'event-host'
      then array['community-a','community-b','event-host']::text[]
    else array['community-a','community-b']::text[]
  end
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  where r.id = p_revision_id;
$$;

create or replace function public.partner_commitment_acceptance_state(p_revision_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_decision text;
  v_pending boolean := false;
begin
  foreach v_role in array coalesce(public.partner_commitment_required_roles(p_revision_id), '{}'::text[]) loop
    select d.decision into v_decision
    from public.partner_commitment_decisions d
    where d.revision_id = p_revision_id and d.actor_role = v_role
    order by d.created_at desc, d.id desc
    limit 1;

    if v_decision = 'rejected' then return 'rejected'; end if;
    if v_decision = 'withdrawn' then return 'withdrawn'; end if;
    if v_decision is distinct from 'accepted' then v_pending := true; end if;
  end loop;
  if v_pending then return 'awaiting-acceptance'; end if;
  return 'accepted';
end;
$$;

create or replace function public.partner_commitment_latest_status(p_revision_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select e.status
    from public.partner_commitment_lifecycle_events e
    where e.revision_id = p_revision_id
    order by e.created_at desc, e.id desc
    limit 1
  ), 'proposed');
$$;

create or replace function public.partner_commitment_committed_actor_authorized(
  p_revision_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    join public.partner_commitment_scopes s on s.id = c.scope_id
    left join public.community_partners committed on committed.id = c.committed_community_id
    where r.id = p_revision_id
      and (
        (c.committed_party_kind = 'community' and committed.owner_id = p_user_id)
        or (c.committed_party_kind = 'event-host' and s.host_id = p_user_id)
      )
  );
$$;

create or replace function public.ensure_partner_program_commitment_scope(p_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_owner_a uuid;
  v_owner_b uuid;
  v_scope_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_program from public.community_partner_programs p where p.id = p_program_id;
  if v_program.id is null then raise exception 'partner program not found'; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_program.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_program.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b) then raise exception 'community owner scope required'; end if;
  if v_program.state not in ('active','paused') then raise exception 'active or paused partner program required'; end if;

  select id into v_scope_id
  from public.partner_commitment_scopes
  where scope_kind = 'program-template' and program_id = p_program_id;
  if v_scope_id is not null then return v_scope_id; end if;

  insert into public.partner_commitment_scopes (
    scope_kind, program_id, community_a_id, community_b_id
  ) values (
    'program-template', p_program_id, v_program.community_a_id, v_program.community_b_id
  ) returning id into v_scope_id;
  return v_scope_id;
end;
$$;

create or replace function public.ensure_partner_exchange_commitment_scope(p_exchange_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exchange public.community_exchange_agreements;
  v_host_id uuid;
  v_owner_a uuid;
  v_owner_b uuid;
  v_scope_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_exchange from public.community_exchange_agreements x where x.id = p_exchange_id;
  if v_exchange.id is null then raise exception 'community exchange not found'; end if;
  select host_id into v_host_id from public.events where id = v_exchange.event_id;
  select owner_id into v_owner_a from public.community_partners where id = v_exchange.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_exchange.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b, v_host_id) then raise exception 'shared partnership scope required'; end if;

  select id into v_scope_id
  from public.partner_commitment_scopes
  where scope_kind = 'event-exchange' and exchange_id = p_exchange_id;
  if v_scope_id is not null then return v_scope_id; end if;

  if v_exchange.state <> 'active' then raise exception 'active exchange required to initialize commitment ledger'; end if;

  insert into public.partner_commitment_scopes (
    scope_kind, program_id, event_id, exchange_id,
    community_a_id, community_b_id, host_id
  ) values (
    'event-exchange', v_exchange.source_program_id, v_exchange.event_id, v_exchange.id,
    v_exchange.community_a_id, v_exchange.community_b_id, v_host_id
  ) returning id into v_scope_id;
  return v_scope_id;
end;
$$;

create or replace function public.get_partner_commitment_scope(p_scope_id uuid)
returns table (
  scope_id uuid,
  scope_kind text,
  program_id uuid,
  program_name text,
  event_id uuid,
  exchange_id uuid,
  community_a_id uuid,
  community_a_name text,
  community_b_id uuid,
  community_b_name text,
  host_id uuid,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  event_ended_at timestamptz,
  scope_state text,
  caller_roles text[],
  can_prefill_program boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.scope_kind,
    s.program_id,
    p.name,
    s.event_id,
    s.exchange_id,
    a.id,
    a.name,
    b.id,
    b.name,
    s.host_id,
    e.starts_at,
    e.ends_at,
    e.ended_at,
    case when s.scope_kind = 'program-template' then p.state else x.state end,
    public.partner_commitment_actor_roles(s.id, auth.uid()),
    s.scope_kind = 'event-exchange' and s.program_id is not null
  from public.partner_commitment_scopes s
  join public.community_partners a on a.id = s.community_a_id
  join public.community_partners b on b.id = s.community_b_id
  left join public.community_partner_programs p on p.id = s.program_id
  left join public.events e on e.id = s.event_id
  left join public.community_exchange_agreements x on x.id = s.exchange_id
  where s.id = p_scope_id
    and public.partner_commitment_scope_access(s.id, auth.uid());
$$;

create or replace function public.propose_partner_commitment(
  p_scope_id uuid,
  p_party_kind text,
  p_community_id uuid,
  p_commitment_type text,
  p_domain text,
  p_committed_quantity numeric,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope public.partner_commitment_scopes;
  v_program_state text;
  v_exchange_state text;
  v_event public.events;
  v_owner uuid;
  v_commitment_id uuid;
  v_revision_id uuid;
  v_existing uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;

  select r.commitment_id into v_existing
  from public.partner_commitment_revisions r
  where r.created_by = auth.uid() and r.idempotency_key = trim(p_idempotency_key)
  limit 1;
  if v_existing is not null then return v_existing; end if;

  select * into v_scope from public.partner_commitment_scopes s where s.id = p_scope_id;
  if v_scope.id is null or not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then
    raise exception 'shared partnership scope required';
  end if;

  if p_commitment_type not in (
    'mentor_slots','office_hours_slots','hiring_conversations','technical_review_sessions',
    'founder_seats','investor_advisor_sessions','workshops','focus_windows',
    'speaker_sessions','facilitator_hours','community_member_capacity','domain_support_capacity'
  ) then raise exception 'unsupported commitment type'; end if;
  if p_domain is not null and p_domain not in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ) then raise exception 'unsupported commitment domain'; end if;
  if p_commitment_type = 'domain_support_capacity' and p_domain is null then
    raise exception 'domain support capacity requires an explicit domain';
  end if;
  if p_committed_quantity is null or p_committed_quantity <= 0 or p_committed_quantity > 10000 then
    raise exception 'committed quantity must be positive and bounded';
  end if;

  if p_party_kind = 'community' then
    if p_community_id is null or p_community_id not in (v_scope.community_a_id, v_scope.community_b_id) then
      raise exception 'committed community must belong to this bilateral scope';
    end if;
    select owner_id into v_owner from public.community_partners where id = p_community_id;
    if v_owner is distinct from auth.uid() then
      raise exception 'a community may propose only its own commitment';
    end if;
  elsif p_party_kind = 'event-host' then
    if v_scope.scope_kind <> 'event-exchange' or v_scope.host_id is distinct from auth.uid() then
      raise exception 'only the current event host may propose a host commitment';
    end if;
    p_community_id := null;
  else
    raise exception 'unsupported committed party kind';
  end if;

  if v_scope.scope_kind = 'program-template' then
    if p_party_kind <> 'community' then raise exception 'program templates contain community commitments only'; end if;
    select state into v_program_state from public.community_partner_programs where id = v_scope.program_id;
    if v_program_state <> 'active' then raise exception 'active partner program required for new templates'; end if;
    v_start := null;
    v_end := null;
  else
    select * into v_event from public.events where id = v_scope.event_id;
    select state into v_exchange_state from public.community_exchange_agreements where id = v_scope.exchange_id;
    if v_exchange_state <> 'active' or not public.is_event_operational(v_scope.event_id) then
      raise exception 'active operational exchange required for new commitments';
    end if;
    v_start := coalesce(p_window_start, v_event.starts_at, v_event.created_at);
    v_end := coalesce(p_window_end, v_event.ends_at);
    if v_end is null or v_end <= v_start then
      raise exception 'event commitments require an explicit valid observation window';
    end if;
    if v_event.ends_at is not null and v_end > v_event.ends_at then
      raise exception 'commitment window cannot extend beyond the event';
    end if;
  end if;

  insert into public.partner_commitments (
    scope_id, committed_party_kind, committed_community_id, created_by
  ) values (
    v_scope.id, p_party_kind, p_community_id, auth.uid()
  ) returning id into v_commitment_id;

  insert into public.partner_commitment_revisions (
    commitment_id, revision_no, commitment_type, domain, committed_quantity,
    window_start, window_end, created_by, idempotency_key
  ) values (
    v_commitment_id, 1, p_commitment_type, p_domain, p_committed_quantity,
    v_start, v_end, auth.uid(), trim(p_idempotency_key)
  ) returning id into v_revision_id;

  insert into public.partner_commitment_lifecycle_events (
    revision_id, status, actor_kind, actor_user_id, reason_code, idempotency_key
  ) values (
    v_revision_id, 'proposed',
    case when p_party_kind = 'event-host' then 'event-host' else 'community' end,
    auth.uid(), 'proposal-created', trim(p_idempotency_key) || '-lifecycle'
  );

  return v_commitment_id;
end;
$$;

create or replace function public.revise_partner_commitment(
  p_commitment_id uuid,
  p_commitment_type text,
  p_domain text,
  p_committed_quantity numeric,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_previous public.partner_commitment_revisions;
  v_event public.events;
  v_revision_id uuid;
  v_existing uuid;
  v_start timestamptz;
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;
  select id into v_existing from public.partner_commitment_revisions
  where created_by = auth.uid() and idempotency_key = trim(p_idempotency_key) limit 1;
  if v_existing is not null then return v_existing; end if;

  select * into v_commitment from public.partner_commitments where id = p_commitment_id;
  if v_commitment.id is null then raise exception 'commitment not found'; end if;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  select * into v_previous from public.partner_commitment_revisions
  where commitment_id = p_commitment_id order by revision_no desc limit 1;
  if not public.partner_commitment_committed_actor_authorized(v_previous.id, auth.uid()) then
    raise exception 'only the committed party may revise its commitment';
  end if;

  if p_commitment_type not in (
    'mentor_slots','office_hours_slots','hiring_conversations','technical_review_sessions',
    'founder_seats','investor_advisor_sessions','workshops','focus_windows',
    'speaker_sessions','facilitator_hours','community_member_capacity','domain_support_capacity'
  ) then raise exception 'unsupported commitment type'; end if;
  if p_domain is not null and p_domain not in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ) then raise exception 'unsupported commitment domain'; end if;
  if p_commitment_type = 'domain_support_capacity' and p_domain is null then
    raise exception 'domain support capacity requires an explicit domain';
  end if;
  if p_committed_quantity is null or p_committed_quantity <= 0 or p_committed_quantity > 10000 then
    raise exception 'committed quantity must be positive and bounded';
  end if;

  if v_scope.scope_kind = 'program-template' then
    if (select state from public.community_partner_programs where id = v_scope.program_id) <> 'active' then
      raise exception 'active partner program required for template revision';
    end if;
    v_start := null; v_end := null;
  else
    select * into v_event from public.events where id = v_scope.event_id;
    if not public.is_event_operational(v_scope.event_id) then raise exception 'event is no longer operational'; end if;
    v_start := coalesce(p_window_start, v_previous.window_start, v_event.starts_at, v_event.created_at);
    v_end := coalesce(p_window_end, v_previous.window_end, v_event.ends_at);
    if v_end is null or v_end <= v_start then raise exception 'valid commitment observation window required'; end if;
    if v_event.ends_at is not null and v_end > v_event.ends_at then raise exception 'commitment window cannot extend beyond the event'; end if;
  end if;

  insert into public.partner_commitment_revisions (
    commitment_id, revision_no, commitment_type, domain, committed_quantity,
    window_start, window_end, supersedes_revision_id, created_by, idempotency_key
  ) values (
    p_commitment_id, v_previous.revision_no + 1, p_commitment_type, p_domain,
    p_committed_quantity, v_start, v_end, v_previous.id, auth.uid(), trim(p_idempotency_key)
  ) returning id into v_revision_id;

  insert into public.partner_commitment_lifecycle_events (
    revision_id, status, actor_kind, actor_user_id, reason_code, idempotency_key
  ) values (
    v_revision_id, 'proposed',
    case when v_commitment.committed_party_kind = 'event-host' then 'event-host' else 'community' end,
    auth.uid(), 'proposal-created', trim(p_idempotency_key) || '-lifecycle'
  );

  return v_revision_id;
end;
$$;

create or replace function public.decide_partner_commitment_revision(
  p_revision_id uuid,
  p_decision text,
  p_idempotency_key text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_current_revision uuid;
  v_role text;
  v_roles text[];
  v_required text[];
  v_state text;
  v_status text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_decision not in ('accepted','rejected','withdrawn') then raise exception 'unsupported commitment decision'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;

  select * into v_revision from public.partner_commitment_revisions where id = p_revision_id;
  if v_revision.id is null then raise exception 'commitment revision not found'; end if;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  if not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then raise exception 'shared partnership scope required'; end if;
  select id into v_current_revision from public.partner_commitment_revisions
    where commitment_id = v_commitment.id order by revision_no desc limit 1;
  if v_current_revision <> p_revision_id then raise exception 'only the current revision can receive a decision'; end if;

  v_roles := public.partner_commitment_actor_roles(v_scope.id, auth.uid());
  v_required := public.partner_commitment_required_roles(p_revision_id);
  v_roles := array(select unnest(v_roles) intersect select unnest(v_required));
  if cardinality(v_roles) = 0 then raise exception 'caller is not a required commitment party'; end if;

  v_status := public.partner_commitment_latest_status(p_revision_id);
  if p_decision = 'withdrawn' and v_status in ('delivering','fulfilled','partially_fulfilled','not_fulfilled') then
    raise exception 'an in-delivery or measured commitment cannot be silently withdrawn';
  end if;

  foreach v_role in array v_roles loop
    if not exists (
      select 1 from public.partner_commitment_decisions d
      where d.actor_user_id = auth.uid() and d.actor_role = v_role and d.idempotency_key = trim(p_idempotency_key)
    ) then
      insert into public.partner_commitment_decisions (
        revision_id, actor_role, actor_user_id, decision, idempotency_key
      ) values (
        p_revision_id, v_role, auth.uid(), p_decision, trim(p_idempotency_key)
      );
    end if;
  end loop;

  v_state := public.partner_commitment_acceptance_state(p_revision_id);
  v_status := public.partner_commitment_latest_status(p_revision_id);

  if v_state = 'accepted' and v_status <> 'accepted' then
    insert into public.partner_commitment_lifecycle_events (
      revision_id, status, actor_kind, actor_user_id, reason_code
    ) values (
      p_revision_id, 'accepted', 'system', null, 'bilateral-acceptance-complete'
    );
  elsif v_state = 'rejected' and v_status <> 'rejected' then
    insert into public.partner_commitment_lifecycle_events (
      revision_id, status, actor_kind, actor_user_id, reason_code
    ) values (
      p_revision_id, 'rejected', 'system', null, 'required-party-rejected'
    );
  elsif v_state = 'withdrawn' and v_status not in ('cancelled','fulfilled','partially_fulfilled','not_fulfilled') then
    insert into public.partner_commitment_lifecycle_events (
      revision_id, status, actor_kind, actor_user_id, reason_code
    ) values (
      p_revision_id, 'cancelled', 'system', null, 'partner-withdrawn'
    );
  end if;

  return v_state;
end;
$$;

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
  if not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then raise exception 'shared partnership scope required'; end if;
  if not public.partner_commitment_committed_actor_authorized(p_revision_id, auth.uid()) and v_scope.host_id <> auth.uid() then
    raise exception 'manual acknowledgement requires the committed party or event host';
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

create or replace function public.refresh_partner_commitment_measurement(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.partner_commitment_revisions;
  v_commitment public.partner_commitments;
  v_scope public.partner_commitment_scopes;
  v_event public.events;
  v_supplier_owner uuid;
  v_other_community uuid;
  v_previous public.partner_commitment_measurements;
  v_manual public.partner_commitment_measurements;
  v_native_delivered numeric := 0;
  v_native_used numeric := 0;
  v_delivered numeric := 0;
  v_used numeric := 0;
  v_outcome_raw integer := 0;
  v_outcome_supported integer;
  v_intro_raw integer := 0;
  v_intro_supported integer;
  v_sources text[] := '{}';
  v_quality text := 'insufficient';
  v_measure_state text := 'insufficient-evidence';
  v_measurement_id uuid;
  v_measurement_no integer;
  v_current_status text;
  v_window_closed boolean := false;
  v_has_server boolean := false;
  v_has_participant boolean := false;
  v_has_manual boolean := false;
  v_suppressed boolean := false;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_revision from public.partner_commitment_revisions where id = p_revision_id;
  if v_revision.id is null then raise exception 'commitment revision not found'; end if;
  select * into v_commitment from public.partner_commitments where id = v_revision.commitment_id;
  select * into v_scope from public.partner_commitment_scopes where id = v_commitment.scope_id;
  if v_scope.scope_kind <> 'event-exchange' then raise exception 'program templates do not carry fulfillment measurements'; end if;
  if not public.partner_commitment_scope_access(v_scope.id, auth.uid()) then raise exception 'shared partnership scope required'; end if;
  select * into v_event from public.events where id = v_scope.event_id;

  select * into v_previous from public.partner_commitment_measurements
    where revision_id = p_revision_id order by measurement_no desc limit 1;
  select * into v_manual from public.partner_commitment_measurements
    where revision_id = p_revision_id and 'manual-operator' = any(evidence_sources)
    order by measurement_no desc limit 1;
  v_has_manual := v_manual.id is not null;

  if v_commitment.committed_party_kind = 'community' then
    select owner_id into v_supplier_owner from public.community_partners where id = v_commitment.committed_community_id;
    v_other_community := case when v_commitment.committed_community_id = v_scope.community_a_id
      then v_scope.community_b_id else v_scope.community_a_id end;
  end if;

  -- Office Hours are counted only when a completed request can be attributed to
  -- the committed community as the recipient/provider. A host commitment uses
  -- total completed event Office Hours as facilitation evidence.
  if v_revision.commitment_type = 'office_hours_slots' then
    if v_commitment.committed_party_kind = 'community' then
      select count(*)::numeric into v_native_used
      from public.office_hours_requests o
      where o.event_id = v_scope.event_id
        and o.status = 'completed'
        and o.proposed_start >= v_revision.window_start
        and o.proposed_start < v_revision.window_end
        and exists (
          select 1 from public.participant_event_community_affiliations supplier
          where supplier.event_id = o.event_id and supplier.user_id = o.recipient_id
            and supplier.community_id = v_commitment.committed_community_id
        )
        and exists (
          select 1 from public.participant_event_community_affiliations counterpart
          where counterpart.event_id = o.event_id and counterpart.user_id = o.requester_id
            and counterpart.community_id = v_other_community
        );
    else
      select count(*)::numeric into v_native_used
      from public.office_hours_requests o
      where o.event_id = v_scope.event_id
        and o.status = 'completed'
        and o.proposed_start >= v_revision.window_start
        and o.proposed_start < v_revision.window_end;
    end if;
    v_native_delivered := v_native_used;
    if v_native_used > 0 then
      v_sources := array_append(v_sources, 'office-hours-completed');
      v_has_server := true;
    end if;
  end if;

  -- Focus Window delivery is attributable only to the committed actor who
  -- created the window. Usage is the number of delivered windows with at least
  -- one explicit participant opt-in; we do not expose the attendee roster.
  if v_revision.commitment_type = 'focus_windows' then
    select count(*)::numeric,
           count(*) filter (where exists (
             select 1 from public.event_focus_window_opt_ins oi where oi.window_id = w.id
           ))::numeric
    into v_native_delivered, v_native_used
    from public.event_focus_windows w
    where w.event_id = v_scope.event_id
      and w.state <> 'cancelled'
      and w.starts_at >= v_revision.window_start
      and w.starts_at < v_revision.window_end
      and (w.state = 'closed' or w.ends_at <= now())
      and (v_revision.domain is null or w.intent_key = v_revision.domain)
      and (
        (v_commitment.committed_party_kind = 'community' and w.created_by = v_supplier_owner)
        or (v_commitment.committed_party_kind = 'event-host' and w.created_by = v_scope.host_id)
      );
    if v_native_delivered > 0 then
      v_sources := array_append(v_sources, 'focus-window-state');
      v_has_server := true;
    end if;
  end if;

  -- Member capacity usage is the count of approved event participants who
  -- explicitly verified the committed community affiliation. It is usage only;
  -- Beacon does not infer how much capacity the community actually made available.
  if v_revision.commitment_type = 'community_member_capacity'
     and v_commitment.committed_party_kind = 'community' then
    select count(distinct a.user_id)::numeric into v_native_used
    from public.participant_event_community_affiliations a
    join public.event_participants ep
      on ep.event_id = a.event_id and ep.user_id = a.user_id and ep.status = 'approved'
    where a.event_id = v_scope.event_id
      and a.community_id = v_commitment.committed_community_id;
    if v_native_used > 0 then
      v_sources := array_append(v_sources, 'community-affiliation');
      v_has_server := true;
    end if;
  end if;

  -- Outcome receipts are result evidence, not automatic fulfillment. Exact
  -- bilateral confirmations are counted only when the receipt is linked to this
  -- exchange and the cohort reaches five distinct mutuals. Smaller cohorts stay
  -- suppressed even from the shared partner ledger.
  with latest as (
    select distinct on (s.id)
      s.match_id, s.participant_id, e.id as receipt_event_id,
      e.event_type, e.receipt_type, e.domains
    from public.participant_outcome_receipt_streams s
    join public.participant_outcome_receipt_events e on e.stream_id = s.id
    where s.event_id = v_scope.event_id
    order by s.id, e.sequence_no desc
  ), current_receipts as (
    select l.* from latest l
    where l.event_type = 'submitted'
      and exists (
        select 1 from public.participant_outcome_receipt_context_links link
        where link.receipt_event_id = l.receipt_event_id
          and link.context_kind = 'community-exchange'
          and link.context_id = v_scope.exchange_id
      )
      and (v_revision.domain is null or v_revision.domain = any(l.domains))
  ), exact_pairs as (
    select a.match_id
    from current_receipts a
    join current_receipts b
      on b.match_id = a.match_id and b.participant_id <> a.participant_id
    where a.receipt_type = b.receipt_type
    group by a.match_id
  )
  select count(*)::integer into v_outcome_raw from exact_pairs;

  if v_outcome_raw >= 5 then
    v_outcome_supported := v_outcome_raw;
    v_sources := array_append(v_sources, 'outcome-receipts');
    v_has_participant := true;
  elsif v_outcome_raw > 0 then
    v_suppressed := true;
  end if;

  -- Warm-introduction result evidence is attributable to a community only when
  -- one of its verified members acted as the connector. Counts remain suppressed
  -- below five to avoid turning a small partner ledger into a pair directory.
  if v_commitment.committed_party_kind = 'community' then
    select count(distinct r.id)::integer into v_intro_raw
    from public.event_introduction_requests r
    where r.event_id = v_scope.event_id
      and r.status in ('accepted','matched')
      and r.created_at >= v_revision.window_start
      and r.created_at < v_revision.window_end
      and (v_revision.domain is null or r.intent_key = v_revision.domain)
      and exists (
        select 1 from public.participant_event_community_affiliations connector
        where connector.event_id = r.event_id and connector.user_id = r.connector_id
          and connector.community_id = v_commitment.committed_community_id
      )
      and (
        exists (
          select 1 from public.participant_event_community_affiliations requester
          where requester.event_id = r.event_id and requester.user_id = r.requester_id
            and requester.community_id = v_other_community
        )
        or exists (
          select 1 from public.participant_event_community_affiliations target
          where target.event_id = r.event_id and target.user_id = r.target_id
            and target.community_id = v_other_community
        )
      );
    if v_intro_raw >= 5 then
      v_intro_supported := v_intro_raw;
      v_sources := array_append(v_sources, 'warm-introduction');
      v_has_server := true;
    elsif v_intro_raw > 0 then
      v_suppressed := true;
    end if;
  end if;

  if v_has_manual then
    v_sources := array_append(v_sources, 'manual-operator');
  end if;
  if v_event.ended_at is not null or exists (
    select 1 from public.partner_commitment_event_closeouts c
    where c.event_id = v_scope.event_id and c.revision_id = p_revision_id
  ) then
    v_sources := array_append(v_sources, 'event-closeout');
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into v_sources
  from unnest(v_sources) value;

  v_delivered := greatest(coalesce(v_native_delivered, 0), coalesce(v_manual.delivered_quantity, 0));
  v_used := greatest(coalesce(v_native_used, 0), coalesce(v_manual.utilized_quantity, 0));
  if v_delivered > 0 then v_used := least(v_used, v_delivered); end if;

  if v_has_manual and (v_has_server or v_has_participant) then v_quality := 'mixed';
  elsif v_has_manual then v_quality := 'manual-operator';
  elsif v_has_server and v_has_participant then v_quality := 'mixed';
  elsif v_has_server then v_quality := 'server-recorded';
  elsif v_has_participant then v_quality := 'participant-attested-aggregate';
  else v_quality := 'insufficient'; end if;

  if v_has_manual and not v_has_server and not v_has_participant then v_measure_state := 'manual-only';
  elsif v_delivered > 0 or v_used > 0 then v_measure_state := 'measured';
  elsif v_has_server or v_has_participant then v_measure_state := 'partial';
  elsif v_suppressed then v_measure_state := 'suppressed';
  else v_measure_state := 'insufficient-evidence'; end if;

  v_measurement_no := coalesce(v_previous.measurement_no, 0) + 1;
  insert into public.partner_commitment_measurements (
    revision_id, measurement_no, delivered_quantity, utilized_quantity,
    supported_bilateral_outcomes, supported_warm_introductions,
    measurement_state, evidence_quality, evidence_sources,
    supersedes_measurement_id, created_by
  ) values (
    p_revision_id, v_measurement_no, v_delivered, v_used,
    v_outcome_supported, v_intro_supported,
    v_measure_state, v_quality, v_sources,
    v_previous.id, auth.uid()
  ) returning id into v_measurement_id;

  -- Store server-private source provenance once. Repeated measurement refreshes
  -- remain snapshots and cannot double-count the same activity as new evidence.
  if v_revision.commitment_type = 'office_hours_slots' then
    insert into public.partner_commitment_evidence_links (
      revision_id, first_measurement_id, source_kind, source_id, evidence_quality
    )
    select p_revision_id, v_measurement_id, 'office-hours', o.id, 'server-recorded'
    from public.office_hours_requests o
    where o.event_id = v_scope.event_id
      and o.status = 'completed'
      and o.proposed_start >= v_revision.window_start
      and o.proposed_start < v_revision.window_end
      and (
        v_commitment.committed_party_kind = 'event-host'
        or (
          exists (select 1 from public.participant_event_community_affiliations supplier
            where supplier.event_id = o.event_id and supplier.user_id = o.recipient_id
              and supplier.community_id = v_commitment.committed_community_id)
          and exists (select 1 from public.participant_event_community_affiliations counterpart
            where counterpart.event_id = o.event_id and counterpart.user_id = o.requester_id
              and counterpart.community_id = v_other_community)
        )
      )
    on conflict (revision_id, source_kind, source_id) do nothing;
  end if;

  if v_revision.commitment_type = 'focus_windows' then
    insert into public.partner_commitment_evidence_links (
      revision_id, first_measurement_id, source_kind, source_id, evidence_quality
    )
    select p_revision_id, v_measurement_id, 'focus-window', w.id, 'server-recorded'
    from public.event_focus_windows w
    where w.event_id = v_scope.event_id
      and w.state <> 'cancelled'
      and w.starts_at >= v_revision.window_start
      and w.starts_at < v_revision.window_end
      and (w.state = 'closed' or w.ends_at <= now())
      and (v_revision.domain is null or w.intent_key = v_revision.domain)
      and (
        (v_commitment.committed_party_kind = 'community' and w.created_by = v_supplier_owner)
        or (v_commitment.committed_party_kind = 'event-host' and w.created_by = v_scope.host_id)
      )
    on conflict (revision_id, source_kind, source_id) do nothing;
  end if;

  if v_intro_supported is not null then
    insert into public.partner_commitment_evidence_links (
      revision_id, first_measurement_id, source_kind, source_id, evidence_quality
    )
    select p_revision_id, v_measurement_id, 'warm-introduction', r.id, 'server-recorded'
    from public.event_introduction_requests r
    where r.event_id = v_scope.event_id
      and r.status in ('accepted','matched')
      and r.created_at >= v_revision.window_start
      and r.created_at < v_revision.window_end
      and (v_revision.domain is null or r.intent_key = v_revision.domain)
      and exists (select 1 from public.participant_event_community_affiliations connector
        where connector.event_id = r.event_id and connector.user_id = r.connector_id
          and connector.community_id = v_commitment.committed_community_id)
    on conflict (revision_id, source_kind, source_id) do nothing;
  end if;

  if v_event.ended_at is not null then
    insert into public.partner_commitment_evidence_links (
      revision_id, first_measurement_id, source_kind, source_id, evidence_quality
    ) values (
      p_revision_id, v_measurement_id, 'event-closeout', v_scope.event_id, 'server-recorded'
    ) on conflict (revision_id, source_kind, source_id) do nothing;
  end if;

  -- Time alone never satisfies a commitment. Automatic lifecycle advancement is
  -- allowed only when server-recorded delivery itself supplies the quantity.
  v_window_closed := v_event.ended_at is not null or v_revision.window_end <= now();
  v_current_status := public.partner_commitment_latest_status(p_revision_id);
  if v_window_closed and v_current_status in ('accepted','scheduled','delivering') then
    if v_native_delivered >= v_revision.committed_quantity then
      insert into public.partner_commitment_lifecycle_events (
        revision_id, status, actor_kind, actor_user_id, reason_code
      ) values (
        p_revision_id, 'fulfilled', 'system', null, 'server-evidence-satisfied'
      );
    elsif v_native_delivered > 0 and v_native_delivered < v_revision.committed_quantity then
      insert into public.partner_commitment_lifecycle_events (
        revision_id, status, actor_kind, actor_user_id, reason_code
      ) values (
        p_revision_id, 'partially_fulfilled', 'system', null, 'server-evidence-partial'
      );
    end if;
  end if;

  return v_measurement_id;
end;
$$;

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
  if public.partner_commitment_acceptance_state(p_revision_id) <> 'accepted' and p_target_status <> 'cancelled' then
    raise exception 'bilateral acceptance required before delivery state';
  end if;

  select * into v_event from public.events where id = v_scope.event_id;
  select * into v_measurement from public.partner_commitment_measurements
    where revision_id = p_revision_id order by measurement_no desc limit 1;
  v_current := public.partner_commitment_latest_status(p_revision_id);

  if p_target_status = 'scheduled' and v_current <> 'accepted' then raise exception 'only an accepted commitment can be scheduled'; end if;
  if p_target_status = 'delivering' and v_current not in ('accepted','scheduled') then raise exception 'commitment is not ready to deliver'; end if;
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
      when 'fulfilled' then 'manual-measurement-finalized'
      when 'partially_fulfilled' then 'manual-measurement-finalized'
      when 'cancelled' then 'committed-party-cancelled'
      else 'event-window-closed-without-delivery'
    end,
    trim(p_idempotency_key)
  );
  return true;
end;
$$;

create or replace function public.prefill_partner_program_commitments(
  p_exchange_id uuid,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_scope_id uuid;
  v_event_scope public.partner_commitment_scopes;
  v_program_scope_id uuid;
  v_event public.events;
  v_template record;
  v_commitment_id uuid;
  v_revision_id uuid;
  v_created integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then raise exception 'strong idempotency key required'; end if;

  v_event_scope_id := public.ensure_partner_exchange_commitment_scope(p_exchange_id);
  select * into v_event_scope from public.partner_commitment_scopes where id = v_event_scope_id;
  if v_event_scope.program_id is null then raise exception 'exchange was not instantiated from a reusable partner program'; end if;
  select id into v_program_scope_id from public.partner_commitment_scopes
    where scope_kind = 'program-template' and program_id = v_event_scope.program_id;
  if v_program_scope_id is null then return 0; end if;
  select * into v_event from public.events where id = v_event_scope.event_id;
  if not public.is_event_operational(v_event_scope.event_id) then raise exception 'event is no longer operational'; end if;
  if v_event.ends_at is null then raise exception 'event end time is required before commitments can be prefilled'; end if;

  for v_template in
    with latest as (
      select distinct on (c.id)
        c.id as commitment_id,
        c.committed_party_kind,
        c.committed_community_id,
        r.*
      from public.partner_commitments c
      join public.partner_commitment_revisions r on r.commitment_id = c.id
      where c.scope_id = v_program_scope_id
      order by c.id, r.revision_no desc
    )
    select * from latest l
    where public.partner_commitment_acceptance_state(l.id) = 'accepted'
      and public.partner_commitment_latest_status(l.id) = 'accepted'
    order by l.committed_party_kind, l.committed_community_id, l.commitment_type, l.domain nulls first, l.id
  loop
    if exists (
      select 1 from public.partner_commitments c
      where c.scope_id = v_event_scope_id and c.source_template_revision_id = v_template.id
    ) then continue; end if;

    insert into public.partner_commitments (
      scope_id, committed_party_kind, committed_community_id,
      source_template_revision_id, created_by
    ) values (
      v_event_scope_id, v_template.committed_party_kind, v_template.committed_community_id,
      v_template.id, auth.uid()
    ) returning id into v_commitment_id;

    insert into public.partner_commitment_revisions (
      commitment_id, revision_no, commitment_type, domain, committed_quantity,
      window_start, window_end, created_by, idempotency_key
    ) values (
      v_commitment_id, 1, v_template.commitment_type, v_template.domain, v_template.committed_quantity,
      coalesce(v_event.starts_at, v_event.created_at), v_event.ends_at,
      auth.uid(), trim(p_idempotency_key) || '-' || substr(v_template.id::text, 1, 12)
    ) returning id into v_revision_id;

    insert into public.partner_commitment_lifecycle_events (
      revision_id, status, actor_kind, actor_user_id, reason_code
    ) values (
      v_revision_id, 'proposed', 'system', null, 'proposal-created'
    );
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

create or replace function public.get_partner_commitment_ledger(p_scope_id uuid)
returns table (
  commitment_id uuid,
  revision_id uuid,
  revision_no integer,
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
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (c.id)
      c.id as commitment_id,
      c.scope_id,
      c.committed_party_kind,
      c.committed_community_id,
      c.source_template_revision_id,
      r.*
    from public.partner_commitments c
    join public.partner_commitment_revisions r on r.commitment_id = c.id
    where c.scope_id = p_scope_id
    order by c.id, r.revision_no desc
  )
  select
    l.commitment_id,
    l.id,
    l.revision_no,
    l.committed_party_kind,
    l.committed_community_id,
    case
      when l.committed_party_kind = 'event-host' then 'Event host'
      when l.committed_community_id = s.community_a_id then a.name
      else b.name
    end,
    l.commitment_type,
    l.domain,
    l.committed_quantity,
    l.window_start,
    l.window_end,
    public.partner_commitment_acceptance_state(l.id),
    public.partner_commitment_latest_status(l.id),
    public.partner_commitment_required_roles(l.id),
    exists (
      select 1
      from unnest(public.partner_commitment_actor_roles(s.id, auth.uid())) role
      where role = any(public.partner_commitment_required_roles(l.id))
        and coalesce((
          select d.decision from public.partner_commitment_decisions d
          where d.revision_id = l.id and d.actor_role = role
          order by d.created_at desc, d.id desc limit 1
        ), '') <> 'accepted'
    ),
    public.partner_commitment_committed_actor_authorized(l.id, auth.uid()),
    m.delivered_quantity,
    m.utilized_quantity,
    case when s.scope_kind = 'program-template' then 'not-applicable' else coalesce(m.measurement_state, 'not-measured') end,
    case when s.scope_kind = 'program-template' then 'insufficient' else coalesce(m.evidence_quality, 'insufficient') end,
    coalesce(m.evidence_sources, '{}'::text[]),
    m.supported_bilateral_outcomes,
    m.supported_warm_introductions,
    l.source_template_revision_id,
    l.created_at
  from latest l
  join public.partner_commitment_scopes s on s.id = l.scope_id
  join public.community_partners a on a.id = s.community_a_id
  join public.community_partners b on b.id = s.community_b_id
  left join lateral (
    select pm.* from public.partner_commitment_measurements pm
    where pm.revision_id = l.id
    order by pm.measurement_no desc limit 1
  ) m on true
  where public.partner_commitment_scope_access(s.id, auth.uid())
  order by case public.partner_commitment_latest_status(l.id)
      when 'delivering' then 0 when 'scheduled' then 1 when 'accepted' then 2 when 'proposed' then 3 else 4 end,
    l.created_at, l.commitment_id;
$$;

create or replace function public.get_partner_commitment_history(p_commitment_id uuid)
returns table (
  revision_id uuid,
  revision_no integer,
  commitment_type text,
  domain text,
  committed_quantity numeric,
  window_start timestamptz,
  window_end timestamptz,
  acceptance_state text,
  lifecycle_status text,
  delivered_quantity numeric,
  utilized_quantity numeric,
  measurement_state text,
  evidence_quality text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.revision_no, r.commitment_type, r.domain, r.committed_quantity,
    r.window_start, r.window_end,
    public.partner_commitment_acceptance_state(r.id),
    public.partner_commitment_latest_status(r.id),
    m.delivered_quantity, m.utilized_quantity,
    coalesce(m.measurement_state, case when s.scope_kind = 'program-template' then 'not-applicable' else 'not-measured' end),
    coalesce(m.evidence_quality, 'insufficient'),
    r.created_at
  from public.partner_commitments c
  join public.partner_commitment_scopes s on s.id = c.scope_id
  join public.partner_commitment_revisions r on r.commitment_id = c.id
  left join lateral (
    select pm.* from public.partner_commitment_measurements pm
    where pm.revision_id = r.id order by pm.measurement_no desc limit 1
  ) m on true
  where c.id = p_commitment_id
    and public.partner_commitment_scope_access(s.id, auth.uid())
  order by r.revision_no desc;
$$;

create or replace function public.get_event_partner_commitment_summary(p_event_id uuid)
returns table (
  exchange_ledger_count integer,
  accepted_commitment_count integer,
  scheduled_or_delivering_count integer,
  fulfilled_commitment_count integer,
  partially_fulfilled_count integer,
  unresolved_commitment_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then return; end if;
  return query
  with scopes as (
    select * from public.partner_commitment_scopes s
    where s.event_id = p_event_id and s.scope_kind = 'event-exchange'
  ), latest as (
    select distinct on (c.id) c.scope_id, r.id as revision_id
    from public.partner_commitments c
    join scopes s on s.id = c.scope_id
    join public.partner_commitment_revisions r on r.commitment_id = c.id
    order by c.id, r.revision_no desc
  ), states as (
    select l.scope_id, public.partner_commitment_latest_status(l.revision_id) as status,
      public.partner_commitment_acceptance_state(l.revision_id) as acceptance
    from latest l
  )
  select
    (select count(*)::integer from scopes),
    count(*) filter (where acceptance = 'accepted')::integer,
    count(*) filter (where status in ('scheduled','delivering'))::integer,
    count(*) filter (where status = 'fulfilled')::integer,
    count(*) filter (where status = 'partially_fulfilled')::integer,
    count(*) filter (where status in ('proposed','accepted','scheduled','delivering'))::integer
  from states;
end;
$$;

create or replace function public.get_partner_program_commitment_memory(p_program_id uuid)
returns table (
  party_kind text,
  party_community_id uuid,
  party_label text,
  commitment_type text,
  domain text,
  sample_event_count integer,
  commitment_occurrences integer,
  average_committed_quantity numeric,
  average_delivered_quantity numeric,
  average_utilized_quantity numeric,
  utilized_event_count integer,
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
  ), latest as (
    select distinct on (c.id)
      c.id as commitment_id, c.committed_party_kind, c.committed_community_id,
      s.event_id, s.host_id, s.community_a_id, s.community_b_id, s.ended_at,
      r.*
    from public.partner_commitments c
    join event_scopes s on s.id = c.scope_id
    join public.partner_commitment_revisions r on r.commitment_id = c.id
    order by c.id, r.revision_no desc
  ), accepted as (
    select l.* from latest l where public.partner_commitment_acceptance_state(l.id) = 'accepted'
  ), measured as (
    select a.*, m.delivered_quantity, m.utilized_quantity
    from accepted a
    left join lateral (
      select pm.* from public.partner_commitment_measurements pm
      where pm.revision_id = a.id order by pm.measurement_no desc limit 1
    ) m on true
  )
  select
    m.committed_party_kind,
    m.committed_community_id,
    case
      when m.committed_party_kind = 'event-host' then 'Event host'
      when m.committed_community_id = v_program.community_a_id then ca.name
      else cb.name
    end,
    m.commitment_type,
    m.domain,
    count(distinct m.event_id)::integer,
    count(*)::integer,
    round(avg(m.committed_quantity), 2),
    round(avg(coalesce(m.delivered_quantity, 0)), 2),
    round(avg(coalesce(m.utilized_quantity, 0)), 2),
    count(distinct m.event_id) filter (where coalesce(m.utilized_quantity, 0) > 0)::integer,
    case when count(distinct m.event_id) >= 2
      then round(percentile_cont(0.5) within group (order by m.committed_quantity)::numeric, 2)
      else null::numeric end,
    max(m.ended_at)
  from measured m
  join public.community_partners ca on ca.id = v_program.community_a_id
  join public.community_partners cb on cb.id = v_program.community_b_id
  group by m.committed_party_kind, m.committed_community_id, ca.name, cb.name,
           m.commitment_type, m.domain
  order by count(distinct m.event_id) desc, m.commitment_type, m.domain nulls first;
end;
$$;

create or replace function public.capture_partner_commitment_event_closeout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    insert into public.partner_commitment_event_closeouts (event_id, revision_id, ended_at)
    select new.id, latest.revision_id, new.ended_at
    from (
      select distinct on (c.id) r.id as revision_id
      from public.partner_commitment_scopes s
      join public.partner_commitments c on c.scope_id = s.id
      join public.partner_commitment_revisions r on r.commitment_id = c.id
      where s.scope_kind = 'event-exchange' and s.event_id = new.id
      order by c.id, r.revision_no desc
    ) latest
    on conflict (event_id, revision_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_partner_commitment_closeout_after_event on public.events;
create trigger capture_partner_commitment_closeout_after_event
after update of ended_at on public.events
for each row execute function public.capture_partner_commitment_event_closeout();

-- Preserve Partner Program provenance when a host instantiates a reusable
-- program. Event-specific exchange approval remains reset exactly as before.
create or replace function public.use_community_partner_program(
  p_event_id uuid,
  p_program_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if not public.is_event_operational(p_event_id) then raise exception 'event is not operational'; end if;

  select p.* into v_program from public.community_partner_programs p where p.id = p_program_id and p.state = 'active';
  if v_program.id is null then raise exception 'active partner program not found'; end if;
  if not exists (
    select 1 from public.community_event_partnerships ep
    where ep.event_id = p_event_id and ep.community_id = v_program.community_a_id and ep.state = 'active'
  ) or not exists (
    select 1 from public.community_event_partnerships ep
    where ep.event_id = p_event_id and ep.community_id = v_program.community_b_id and ep.state = 'active'
  ) then raise exception 'both program communities must be active partners of this event'; end if;

  insert into public.community_exchange_agreements (
    event_id,
    community_a_id,
    community_b_id,
    domains,
    proposed_by,
    community_a_approved,
    community_b_approved,
    state,
    source_program_id
  ) values (
    p_event_id,
    v_program.community_a_id,
    v_program.community_b_id,
    v_program.domains,
    auth.uid(),
    false,
    false,
    'proposed',
    p_program_id
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.reject_partner_commitment_update() from public;
revoke all on function public.partner_commitment_scope_access(uuid,uuid) from public;
revoke all on function public.partner_commitment_actor_roles(uuid,uuid) from public;
revoke all on function public.partner_commitment_required_roles(uuid) from public;
revoke all on function public.partner_commitment_acceptance_state(uuid) from public;
revoke all on function public.partner_commitment_latest_status(uuid) from public;
revoke all on function public.partner_commitment_committed_actor_authorized(uuid,uuid) from public;
revoke all on function public.ensure_partner_program_commitment_scope(uuid) from public;
revoke all on function public.ensure_partner_exchange_commitment_scope(uuid) from public;
revoke all on function public.get_partner_commitment_scope(uuid) from public;
revoke all on function public.propose_partner_commitment(uuid,text,uuid,text,text,numeric,timestamptz,timestamptz,text) from public;
revoke all on function public.revise_partner_commitment(uuid,text,text,numeric,timestamptz,timestamptz,text) from public;
revoke all on function public.decide_partner_commitment_revision(uuid,text,text) from public;
revoke all on function public.record_manual_partner_commitment_measurement(uuid,numeric,numeric,text) from public;
revoke all on function public.refresh_partner_commitment_measurement(uuid) from public;
revoke all on function public.advance_partner_commitment(uuid,text,text) from public;
revoke all on function public.prefill_partner_program_commitments(uuid,text) from public;
revoke all on function public.get_partner_commitment_ledger(uuid) from public;
revoke all on function public.get_partner_commitment_history(uuid) from public;
revoke all on function public.get_event_partner_commitment_summary(uuid) from public;
revoke all on function public.get_partner_program_commitment_memory(uuid) from public;
revoke all on function public.capture_partner_commitment_event_closeout() from public;

grant execute on function public.ensure_partner_program_commitment_scope(uuid) to authenticated;
grant execute on function public.ensure_partner_exchange_commitment_scope(uuid) to authenticated;
grant execute on function public.get_partner_commitment_scope(uuid) to authenticated;
grant execute on function public.propose_partner_commitment(uuid,text,uuid,text,text,numeric,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.revise_partner_commitment(uuid,text,text,numeric,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.decide_partner_commitment_revision(uuid,text,text) to authenticated;
grant execute on function public.record_manual_partner_commitment_measurement(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.refresh_partner_commitment_measurement(uuid) to authenticated;
grant execute on function public.advance_partner_commitment(uuid,text,text) to authenticated;
grant execute on function public.prefill_partner_program_commitments(uuid,text) to authenticated;
grant execute on function public.get_partner_commitment_ledger(uuid) to authenticated;
grant execute on function public.get_partner_commitment_history(uuid) to authenticated;
grant execute on function public.get_event_partner_commitment_summary(uuid) to authenticated;
grant execute on function public.get_partner_program_commitment_memory(uuid) to authenticated;

grant execute on function public.use_community_partner_program(uuid,uuid) to authenticated;

comment on table public.partner_commitment_scopes is
  'Bilateral Partner Program template or event-exchange commitment scope. Shared only with the two community owners and, for event scope, the event host.';
comment on table public.partner_commitment_revisions is
  'Immutable commitment contract revisions. Accepted quantities are superseded by a new revision rather than edited in place.';
comment on table public.partner_commitment_measurements is
  'Append-only observational delivery/utilization snapshots with explicit evidence quality. No cross-resource value score is computed.';
comment on function public.refresh_partner_commitment_measurement(uuid) is
  'Refreshes server-supported and cohort-gated evidence. Elapsed time alone never marks a commitment fulfilled.';
comment on function public.prefill_partner_program_commitments(uuid,text) is
  'Copies accepted reusable program templates into the current event as proposed commitments with every event-specific acceptance reset.';
comment on function public.get_partner_program_commitment_memory(uuid) is
  'Owner-private longitudinal memory grouped only within the same commitment type/domain semantics; suggested quantities require at least two ended events and are non-binding.';
