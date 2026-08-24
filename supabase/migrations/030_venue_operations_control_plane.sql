-- Venue operations control plane
-- Persists operator decisions and aggregate service-point measurements without
-- storing attendee trajectories or identity-linked movement histories.

create table if not exists public.venue_operation_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  venue_key text not null,
  event_type text not null check (event_type in (
    'recommendation-admitted',
    'operator-decision',
    'intervention-applied',
    'intervention-observing',
    'intervention-measured',
    'intervention-reverted',
    'command-expired'
  )),
  command_id text,
  intervention_id text,
  operator_id uuid,
  target_zone_ids text[] not null default '{}',
  layout_version text not null,
  geometry_hash text not null,
  policy_version text not null,
  model_version text not null,
  admission_decision text check (admission_decision in ('allow','review','block')),
  evidence_score numeric check (evidence_score between 0 and 1),
  reason_code text,
  note text check (note is null or length(note) <= 1000),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (event_id, idempotency_key)
);

create table if not exists public.venue_intervention_measurements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  intervention_id text not null,
  command_id text not null,
  venue_key text not null,
  layout_version text not null,
  geometry_hash text not null,
  before_saturated_zones integer not null check (before_saturated_zones >= 0),
  after_saturated_zones integer not null check (after_saturated_zones >= 0),
  before_mean_occupancy numeric not null check (before_mean_occupancy between 0 and 1),
  after_mean_occupancy numeric not null check (after_mean_occupancy between 0 and 1),
  effect_score numeric not null check (effect_score between -1 and 1),
  confidence numeric not null check (confidence between 0 and 1),
  measured_at timestamptz not null default now(),
  unique (event_id, intervention_id)
);

create table if not exists public.venue_service_point_samples (
  id bigserial primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  service_point_id text not null,
  zone_id text not null,
  kind text not null check (kind in ('check-in','food','coat-check','restroom','booth','security','other')),
  queue_length integer not null check (queue_length >= 0),
  arrivals integer not null check (arrivals >= 0),
  completions integer not null check (completions >= 0),
  window_minutes numeric not null check (window_minutes > 0 and window_minutes <= 120),
  sample_support integer not null check (sample_support >= 0),
  confidence numeric not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.venue_operation_audit_events enable row level security;
alter table public.venue_intervention_measurements enable row level security;
alter table public.venue_service_point_samples enable row level security;

-- Organizers may read operational evidence only for events they host. Direct
-- client inserts are intentionally absent; writes go through controlled RPCs or
-- trusted service-role aggregation.
create policy "event hosts can read venue operation audit"
on public.venue_operation_audit_events for select
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = venue_operation_audit_events.event_id
      and e.host_id = auth.uid()
  )
);

create policy "event hosts can read venue intervention measurements"
on public.venue_intervention_measurements for select
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = venue_intervention_measurements.event_id
      and e.host_id = auth.uid()
  )
);

create policy "event hosts can read venue service samples"
on public.venue_service_point_samples for select
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = venue_service_point_samples.event_id
      and e.host_id = auth.uid()
  )
);

revoke insert, update, delete on public.venue_operation_audit_events from authenticated;
revoke insert, update, delete on public.venue_intervention_measurements from authenticated;
revoke insert, update, delete on public.venue_service_point_samples from authenticated;

create or replace function public.prevent_venue_operation_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'venue operation audit records are append-only';
end;
$$;

create trigger venue_operation_audit_append_only
before update or delete on public.venue_operation_audit_events
for each row execute function public.prevent_venue_operation_audit_mutation();

create trigger venue_intervention_measurements_append_only
before update or delete on public.venue_intervention_measurements
for each row execute function public.prevent_venue_operation_audit_mutation();

-- Human operators can append only the event classes that represent an explicit
-- decision or physical/programming action. Model admission, measurement, and
-- provenance remain trusted-service responsibilities.
create or replace function public.append_venue_operator_event(
  p_event_id uuid,
  p_venue_key text,
  p_event_type text,
  p_command_id text,
  p_intervention_id text,
  p_target_zone_ids text[],
  p_layout_version text,
  p_geometry_hash text,
  p_policy_version text,
  p_model_version text,
  p_admission_decision text,
  p_evidence_score numeric,
  p_reason_code text,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1 from public.events e
    where e.id = p_event_id and e.host_id = auth.uid()
  ) then
    raise exception 'event operator scope required';
  end if;

  if p_event_type not in ('operator-decision','intervention-applied','intervention-reverted') then
    raise exception 'event type is not writable by an operator client';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'idempotency key is required';
  end if;

  if p_evidence_score is not null and (p_evidence_score < 0 or p_evidence_score > 1) then
    raise exception 'evidence score outside [0,1]';
  end if;

  insert into public.venue_operation_audit_events (
    event_id,
    venue_key,
    event_type,
    command_id,
    intervention_id,
    operator_id,
    target_zone_ids,
    layout_version,
    geometry_hash,
    policy_version,
    model_version,
    admission_decision,
    evidence_score,
    reason_code,
    note,
    idempotency_key
  ) values (
    p_event_id,
    left(p_venue_key, 160),
    p_event_type,
    left(p_command_id, 200),
    left(p_intervention_id, 200),
    auth.uid(),
    coalesce(p_target_zone_ids, '{}'),
    left(p_layout_version, 120),
    left(p_geometry_hash, 200),
    left(p_policy_version, 120),
    left(p_model_version, 120),
    p_admission_decision,
    p_evidence_score,
    left(p_reason_code, 120),
    left(p_note, 1000),
    left(p_idempotency_key, 200)
  )
  on conflict (event_id, idempotency_key) do nothing
  returning id into v_id;

  -- Preserve append-only semantics on retries. `DO UPDATE` would fire the
  -- mutation-prevention trigger, so a duplicate idempotency key resolves by
  -- reading the immutable record that already won the race.
  if v_id is null then
    select id
      into v_id
    from public.venue_operation_audit_events
    where event_id = p_event_id
      and idempotency_key = left(p_idempotency_key, 200);
  end if;

  return v_id;
end;
$$;

revoke all on function public.append_venue_operator_event(
  uuid,text,text,text,text,text[],text,text,text,text,text,numeric,text,text,text
) from public;
grant execute on function public.append_venue_operator_event(
  uuid,text,text,text,text,text[],text,text,text,text,text,numeric,text,text,text
) to authenticated;

create index if not exists venue_operation_audit_event_idx
  on public.venue_operation_audit_events (event_id, created_at desc);
create index if not exists venue_operation_audit_command_idx
  on public.venue_operation_audit_events (event_id, command_id, created_at desc);
create index if not exists venue_intervention_measurements_event_idx
  on public.venue_intervention_measurements (event_id, measured_at desc);
create index if not exists venue_service_point_samples_latest_idx
  on public.venue_service_point_samples (event_id, service_point_id, observed_at desc);
