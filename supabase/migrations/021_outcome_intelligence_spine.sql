-- =============================================================================
-- 021_outcome_intelligence_spine.sql
-- Privacy-safe event outcome intelligence, repeat-event memory, and organizer
-- learning without exposing individual signals, proximity trails, or identities.
-- =============================================================================

create type public.event_health_state as enum (
  'insufficient_data',
  'fragile',
  'forming',
  'healthy',
  'exceptional'
);

create table if not exists public.event_outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  host_id uuid not null references public.users(id) on delete cascade,
  captured_at timestamptz not null default now(),

  approved_participants integer not null default 0 check (approved_participants >= 0),
  discoverable_participants integer not null default 0 check (discoverable_participants >= 0),
  verified_role_participants integer not null default 0 check (verified_role_participants >= 0),
  protected_access_participants integer not null default 0 check (protected_access_participants >= 0),

  signals_sent integer not null default 0 check (signals_sent >= 0),
  mutuals_formed integer not null default 0 check (mutuals_formed >= 0),
  office_hours_requested integer not null default 0 check (office_hours_requested >= 0),
  office_hours_completed integer not null default 0 check (office_hours_completed >= 0),
  drops_claimed integer not null default 0 check (drops_claimed >= 0),
  drops_waitlisted integer not null default 0 check (drops_waitlisted >= 0),
  vault_actions_open integer not null default 0 check (vault_actions_open >= 0),
  vault_actions_completed integer not null default 0 check (vault_actions_completed >= 0),
  missed_opportunities_recorded integer not null default 0 check (missed_opportunities_recorded >= 0),

  activation_rate numeric(6,5) not null default 0 check (activation_rate between 0 and 1),
  signal_to_mutual_rate numeric(6,5) not null default 0 check (signal_to_mutual_rate between 0 and 1),
  office_hours_completion_rate numeric(6,5) not null default 0 check (office_hours_completion_rate between 0 and 1),
  vault_follow_through_rate numeric(6,5) not null default 0 check (vault_follow_through_rate between 0 and 1),
  verified_supply_rate numeric(6,5) not null default 0 check (verified_supply_rate between 0 and 1),

  beacon_index smallint not null default 0 check (beacon_index between 0 and 100),
  health_state public.event_health_state not null default 'insufficient_data',
  confidence numeric(6,5) not null default 0 check (confidence between 0 and 1),
  diagnostics jsonb not null default '[]'::jsonb,
  methodology_version text not null default 'v0.1-private',

  unique (event_id, captured_at)
);

create index if not exists event_outcome_snapshots_event_idx
  on public.event_outcome_snapshots (event_id, captured_at desc);
create index if not exists event_outcome_snapshots_host_idx
  on public.event_outcome_snapshots (host_id, captured_at desc);

alter table public.event_outcome_snapshots enable row level security;

create policy "event_outcome_snapshots_select_host"
  on public.event_outcome_snapshots
  for select
  using (auth.uid() = host_id);

-- Snapshots are generated only through the SECURITY DEFINER RPC below. Clients
-- cannot insert or update organizer intelligence directly.

create table if not exists public.organizer_learning_memory (
  host_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  learned_at timestamptz not null default now(),
  participant_band text not null,
  strongest_conversion_phase text,
  weakest_conversion_phase text,
  highest_demand_role text,
  strongest_access_mechanic text,
  largest_dropoff text,
  recommendations jsonb not null default '[]'::jsonb,
  outcome_fingerprint jsonb not null default '{}'::jsonb,
  methodology_version text not null default 'v0.1-private',
  primary key (host_id, event_id)
);

alter table public.organizer_learning_memory enable row level security;

create policy "organizer_learning_memory_select_own"
  on public.organizer_learning_memory
  for select
  using (auth.uid() = host_id);

create or replace function public.safe_ratio(p_numerator bigint, p_denominator bigint)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_denominator, 0) <= 0 then 0::numeric
    else least(1::numeric, greatest(0::numeric, p_numerator::numeric / p_denominator::numeric))
  end;
$$;

create or replace function public.compute_private_beacon_index(
  p_activation_rate numeric,
  p_signal_to_mutual_rate numeric,
  p_office_hours_completion_rate numeric,
  p_vault_follow_through_rate numeric,
  p_verified_supply_rate numeric,
  p_sample_size integer
)
returns table(index_score smallint, confidence numeric, health_state public.event_health_state)
language plpgsql
immutable
as $$
declare
  v_confidence numeric;
  v_score numeric;
  v_health public.event_health_state;
begin
  v_confidence := least(1::numeric, greatest(0::numeric, p_sample_size::numeric / 80::numeric));

  v_score := (
    least(1::numeric, greatest(0::numeric, p_activation_rate)) * 24
    + least(1::numeric, greatest(0::numeric, p_signal_to_mutual_rate)) * 28
    + least(1::numeric, greatest(0::numeric, p_office_hours_completion_rate)) * 18
    + least(1::numeric, greatest(0::numeric, p_vault_follow_through_rate)) * 16
    + least(1::numeric, greatest(0::numeric, p_verified_supply_rate)) * 14
  );

  if p_sample_size < 8 then
    v_health := 'insufficient_data';
  elsif v_score < 28 then
    v_health := 'fragile';
  elsif v_score < 50 then
    v_health := 'forming';
  elsif v_score < 76 then
    v_health := 'healthy';
  else
    v_health := 'exceptional';
  end if;

  return query select round(v_score)::smallint, v_confidence, v_health;
end;
$$;

create or replace function public.capture_event_outcome_snapshot(p_event_id uuid)
returns public.event_outcome_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_participants integer;
  v_discoverable integer;
  v_verified integer;
  v_protected integer;
  v_signals integer;
  v_mutuals integer;
  v_oh_requested integer;
  v_oh_completed integer;
  v_drop_claimed integer;
  v_drop_waitlisted integer;
  v_vault_open integer;
  v_vault_completed integer;
  v_missed integer;
  v_activation numeric;
  v_signal_to_mutual numeric;
  v_oh_completion numeric;
  v_vault_follow numeric;
  v_verified_supply numeric;
  v_index smallint;
  v_confidence numeric;
  v_health public.event_health_state;
  v_diagnostics jsonb := '[]'::jsonb;
  v_snapshot public.event_outcome_snapshots;
begin
  select e.host_id into v_host_id
  from public.events e
  where e.id = p_event_id;

  if v_host_id is null or auth.uid() <> v_host_id then
    raise exception 'Only the event host can capture private outcome intelligence';
  end if;

  select count(*) filter (where ep.status = 'approved'),
         count(*) filter (where ep.status = 'approved' and coalesce(ep.is_discoverable, false))
    into v_participants, v_discoverable
  from public.event_participants ep
  where ep.event_id = p_event_id;

  select count(distinct era.user_id)
    into v_verified
  from public.event_role_attestations era
  where era.event_id = p_event_id
    and era.status = 'verified'
    and (era.expires_at is null or era.expires_at > now());

  select count(*)
    into v_protected
  from public.event_visibility_policies evp
  where evp.event_id = p_event_id
    and evp.visibility_mode in ('aggregate_only', 'eligible_only', 'invisible');

  select count(*) into v_signals
  from public.connection_requests cr
  where cr.event_id = p_event_id;

  select count(*) into v_mutuals
  from public.matches m
  where m.event_id = p_event_id;

  select count(*), count(*) filter (where ohr.status = 'completed')
    into v_oh_requested, v_oh_completed
  from public.office_hours_requests ohr
  where ohr.event_id = p_event_id;

  select count(*) filter (where adc.status = 'confirmed'),
         count(*) filter (where adc.status = 'waitlisted')
    into v_drop_claimed, v_drop_waitlisted
  from public.access_drop_claims adc
  join public.access_drops ad on ad.id = adc.drop_id
  where ad.event_id = p_event_id;

  select count(*) filter (where ve.status = 'open'),
         count(*) filter (where ve.status = 'completed')
    into v_vault_open, v_vault_completed
  from public.vault_entries ve
  where ve.event_id = p_event_id;

  select count(*) into v_missed
  from public.missed_opportunities mo
  where mo.event_id = p_event_id;

  v_activation := public.safe_ratio(v_discoverable, v_participants);
  v_signal_to_mutual := public.safe_ratio(v_mutuals, v_signals);
  v_oh_completion := public.safe_ratio(v_oh_completed, v_oh_requested);
  v_vault_follow := public.safe_ratio(v_vault_completed, v_vault_open + v_vault_completed);
  v_verified_supply := public.safe_ratio(v_verified, v_participants);

  select index_score, confidence, health_state
    into v_index, v_confidence, v_health
  from public.compute_private_beacon_index(
    v_activation,
    v_signal_to_mutual,
    v_oh_completion,
    v_vault_follow,
    v_verified_supply,
    v_participants
  );

  if v_participants < 8 then
    v_diagnostics := v_diagnostics || jsonb_build_array('More participant activity is required before drawing reliable conclusions.');
  end if;
  if v_participants >= 8 and v_activation < 0.45 then
    v_diagnostics := v_diagnostics || jsonb_build_array('Activation is the primary constraint: improve onboarding and organizer stage direction.');
  end if;
  if v_signals >= 5 and v_signal_to_mutual < 0.12 then
    v_diagnostics := v_diagnostics || jsonb_build_array('Signal quality is weak: tighten intent framing or reduce high-intent budget volume.');
  end if;
  if v_oh_requested >= 3 and v_oh_completion < 0.55 then
    v_diagnostics := v_diagnostics || jsonb_build_array('Office Hours demand is not converting: inspect capacity, queue quality, and physical handoff.');
  end if;
  if v_verified_supply < 0.10 and v_participants >= 15 then
    v_diagnostics := v_diagnostics || jsonb_build_array('Verified high-signal supply is thin relative to room size.');
  end if;
  if v_vault_open >= 4 and v_vault_follow < 0.35 then
    v_diagnostics := v_diagnostics || jsonb_build_array('Post-event follow-through is decaying: surface fewer, sharper next actions.');
  end if;
  if jsonb_array_length(v_diagnostics) = 0 then
    v_diagnostics := jsonb_build_array('No dominant failure mode detected at the current confidence level.');
  end if;

  insert into public.event_outcome_snapshots (
    event_id, host_id, approved_participants, discoverable_participants,
    verified_role_participants, protected_access_participants, signals_sent,
    mutuals_formed, office_hours_requested, office_hours_completed,
    drops_claimed, drops_waitlisted, vault_actions_open,
    vault_actions_completed, missed_opportunities_recorded, activation_rate,
    signal_to_mutual_rate, office_hours_completion_rate,
    vault_follow_through_rate, verified_supply_rate, beacon_index,
    health_state, confidence, diagnostics
  ) values (
    p_event_id, v_host_id, v_participants, v_discoverable, v_verified,
    v_protected, v_signals, v_mutuals, v_oh_requested, v_oh_completed,
    v_drop_claimed, v_drop_waitlisted, v_vault_open, v_vault_completed,
    v_missed, v_activation, v_signal_to_mutual, v_oh_completion,
    v_vault_follow, v_verified_supply, v_index, v_health, v_confidence,
    v_diagnostics
  ) returning * into v_snapshot;

  return v_snapshot;
end;
$$;

grant execute on function public.capture_event_outcome_snapshot(uuid) to authenticated;
