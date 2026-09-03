-- Durable event operations closeout
-- Normal event closure preserves a compact, immutable aggregate record that can
-- support recap, calibration, and repeat-event learning after live telemetry is gone.

create table if not exists public.venue_event_closeouts (
  event_id uuid primary key references public.events(id) on delete cascade,
  venue_key text not null,
  release_id text,
  layout_version text,
  geometry_hash text,
  policy_version text,
  model_version text,
  audit_event_count integer not null default 0 check (audit_event_count >= 0),
  operator_decision_count integer not null default 0 check (operator_decision_count >= 0),
  applied_intervention_count integer not null default 0 check (applied_intervention_count >= 0),
  reverted_intervention_count integer not null default 0 check (reverted_intervention_count >= 0),
  measured_intervention_count integer not null default 0 check (measured_intervention_count >= 0),
  positive_intervention_count integer not null default 0 check (positive_intervention_count >= 0),
  mean_measured_effect numeric check (mean_measured_effect between -1 and 1),
  positive_rate numeric check (positive_rate between 0 and 1),
  mean_measurement_confidence numeric check (mean_measurement_confidence between 0 and 1),
  service_point_count integer not null default 0 check (service_point_count >= 0),
  evidence_coverage numeric not null default 0 check (evidence_coverage between 0 and 1),
  closed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (positive_intervention_count <= measured_intervention_count),
  check (reverted_intervention_count <= audit_event_count),
  check (applied_intervention_count <= audit_event_count)
);

alter table public.venue_event_closeouts enable row level security;

create policy "event hosts can read venue closeout"
on public.venue_event_closeouts for select
to authenticated
using (public.is_event_host(event_id, auth.uid()));

revoke insert, update, delete on public.venue_event_closeouts from authenticated;

-- Closeouts are immutable evidence. Reuse the append-only mutation guard already
-- established by the venue operations control plane.
drop trigger if exists venue_event_closeouts_append_only on public.venue_event_closeouts;
create trigger venue_event_closeouts_append_only
before update or delete on public.venue_event_closeouts
for each row execute function public.prevent_venue_operation_audit_mutation();

create index if not exists venue_event_closeouts_venue_idx
  on public.venue_event_closeouts (venue_key, closed_at desc);

-- Upgrade event closure so it becomes one idempotent operational boundary:
-- close participation/action paths, revoke command authority, and freeze a
-- compact evidence summary without destroying the event row or its history.
create or replace function public.end_event(p_event_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ended_at timestamptz;
  v_venue_key text;
  v_release_id text;
  v_layout_version text;
  v_geometry_hash text;
  v_policy_version text;
  v_model_version text;
  v_audit_count integer := 0;
  v_decision_count integer := 0;
  v_applied_count integer := 0;
  v_reverted_count integer := 0;
  v_measured_count integer := 0;
  v_positive_count integer := 0;
  v_mean_effect numeric;
  v_mean_confidence numeric;
  v_service_point_count integer := 0;
  v_evidence_signals integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select e.ended_at
    into v_ended_at
  from public.events e
  where e.id = p_event_id
    and e.host_id = auth.uid()
  for update;

  if not found then
    raise exception 'event host scope required';
  end if;

  if v_ended_at is null then
    v_ended_at := now();
    update public.events
    set
      ended_at = v_ended_at,
      latitude = null,
      longitude = null
    where id = p_event_id;
  end if;

  update public.venue_admitted_commands
  set revoked_at = coalesce(revoked_at, v_ended_at)
  where event_id = p_event_id
    and revoked_at is null;

  select
    r.release_id,
    r.layout_version,
    r.geometry_hash,
    r.policy_version,
    r.model_version,
    r.venue_key
  into
    v_release_id,
    v_layout_version,
    v_geometry_hash,
    v_policy_version,
    v_model_version,
    v_venue_key
  from public.venue_operation_releases r
  where r.event_id = p_event_id
  order by r.activated_at desc
  limit 1;

  if v_venue_key is null then
    select a.venue_key into v_venue_key
    from public.venue_operation_audit_events a
    where a.event_id = p_event_id
    order by a.created_at desc
    limit 1;
  end if;

  if v_venue_key is null then
    select c.venue_key into v_venue_key
    from public.venue_learning_contexts c
    where c.event_id = p_event_id
    limit 1;
  end if;

  v_venue_key := coalesce(v_venue_key, 'event:' || p_event_id::text);

  select
    count(*)::integer,
    count(*) filter (where a.event_type = 'operator-decision')::integer,
    count(*) filter (where a.event_type = 'intervention-applied')::integer,
    count(*) filter (where a.event_type = 'intervention-reverted')::integer
  into v_audit_count, v_decision_count, v_applied_count, v_reverted_count
  from public.venue_operation_audit_events a
  where a.event_id = p_event_id;

  select
    count(*)::integer,
    count(*) filter (where m.effect_score > 0.08)::integer,
    avg(m.effect_score),
    avg(m.confidence)
  into v_measured_count, v_positive_count, v_mean_effect, v_mean_confidence
  from public.venue_intervention_measurements m
  where m.event_id = p_event_id;

  select count(distinct s.service_point_id)::integer
    into v_service_point_count
  from public.venue_service_point_samples s
  where s.event_id = p_event_id;

  v_evidence_signals :=
    (case when v_audit_count > 0 then 1 else 0 end)
    + (case when v_decision_count > 0 or v_applied_count = 0 then 1 else 0 end)
    + (case when v_applied_count = 0 or v_measured_count > 0 then 1 else 0 end)
    + (case when v_layout_version is not null and v_geometry_hash is not null then 1 else 0 end)
    + (case when v_policy_version is not null and v_model_version is not null then 1 else 0 end);

  insert into public.venue_event_closeouts (
    event_id,
    venue_key,
    release_id,
    layout_version,
    geometry_hash,
    policy_version,
    model_version,
    audit_event_count,
    operator_decision_count,
    applied_intervention_count,
    reverted_intervention_count,
    measured_intervention_count,
    positive_intervention_count,
    mean_measured_effect,
    positive_rate,
    mean_measurement_confidence,
    service_point_count,
    evidence_coverage,
    closed_at
  ) values (
    p_event_id,
    left(v_venue_key, 160),
    left(v_release_id, 200),
    left(v_layout_version, 120),
    left(v_geometry_hash, 200),
    left(v_policy_version, 120),
    left(v_model_version, 120),
    coalesce(v_audit_count, 0),
    coalesce(v_decision_count, 0),
    coalesce(v_applied_count, 0),
    coalesce(v_reverted_count, 0),
    coalesce(v_measured_count, 0),
    coalesce(v_positive_count, 0),
    v_mean_effect,
    case when coalesce(v_measured_count, 0) > 0
      then v_positive_count::numeric / v_measured_count
      else null end,
    v_mean_confidence,
    coalesce(v_service_point_count, 0),
    v_evidence_signals::numeric / 5,
    v_ended_at
  )
  on conflict (event_id) do nothing;

  return v_ended_at;
end;
$$;

revoke all on function public.end_event(uuid) from public;
grant execute on function public.end_event(uuid) to authenticated;

comment on table public.venue_event_closeouts is
  'Immutable aggregate event closeout used for host recap and repeat-event operational learning; contains no attendee movement history.';
