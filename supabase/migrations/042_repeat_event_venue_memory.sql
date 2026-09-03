-- Repeat-event venue memory
-- Converts a host's own ended events into bounded historical evidence for the
-- next event at the same venue. This is intentionally host-private: no
-- cross-customer benchmark or competitor data is exposed by these functions.

create or replace function public.get_venue_repeat_event_measurements(
  p_event_id uuid,
  p_limit integer default 120
)
returns table (
  source_event_id uuid,
  source_closed_at timestamptz,
  command_id text,
  command_kind text,
  effect_score numeric,
  confidence numeric,
  measured_at timestamptz,
  context_key text,
  context_version text,
  venue_key text,
  layout_version text,
  geometry_hash text,
  total_capacity integer,
  topology_redundancy numeric,
  accessible_coverage numeric,
  attendance_band text,
  duration_band text,
  zone_kinds text[],
  service_point_kinds text[],
  program_fingerprint text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_venue_key text;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select e.host_id
    into v_host_id
  from public.events e
  where e.id = p_event_id;

  if v_host_id is null or v_host_id <> auth.uid() then
    raise exception 'event host scope required for repeat-event memory';
  end if;

  select c.venue_key
    into v_venue_key
  from public.venue_learning_contexts c
  where c.event_id = p_event_id
  limit 1;

  if v_venue_key is null then
    return;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 120), 240));

  return query
  select
    m.event_id as source_event_id,
    co.closed_at as source_closed_at,
    m.command_id,
    coalesce(ac.command_kind, 'unknown')::text as command_kind,
    m.effect_score,
    m.confidence,
    m.measured_at,
    hc.context_key,
    hc.context_version,
    hc.venue_key,
    hc.layout_version,
    hc.geometry_hash,
    hc.total_capacity,
    hc.topology_redundancy,
    hc.accessible_coverage,
    hc.attendance_band,
    hc.duration_band,
    hc.zone_kinds,
    hc.service_point_kinds,
    hc.program_fingerprint
  from public.venue_intervention_measurements m
  join public.events he
    on he.id = m.event_id
   and he.host_id = v_host_id
   and he.id <> p_event_id
   and he.ended_at is not null
  join public.venue_learning_contexts hc
    on hc.event_id = he.id
   and hc.venue_key = v_venue_key
   and m.learning_context_key = hc.context_key
  join public.venue_event_closeouts co
    on co.event_id = he.id
  left join lateral (
    select c.command_kind
    from public.venue_admitted_commands c
    where c.event_id = m.event_id
      and c.command_id = m.command_id
    order by c.created_at desc
    limit 1
  ) ac on true
  where m.confidence >= 0.35
  order by m.measured_at desc, m.event_id, m.command_id
  limit v_limit;
end;
$$;

create or replace function public.get_venue_repeat_event_closeouts(
  p_event_id uuid,
  p_limit integer default 24
)
returns table (
  source_event_id uuid,
  venue_key text,
  closed_at timestamptz,
  measured_intervention_count integer,
  positive_intervention_count integer,
  mean_measured_effect numeric,
  positive_rate numeric,
  mean_measurement_confidence numeric,
  evidence_coverage numeric,
  release_id text,
  layout_version text,
  geometry_hash text,
  policy_version text,
  model_version text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
  v_venue_key text;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select e.host_id
    into v_host_id
  from public.events e
  where e.id = p_event_id;

  if v_host_id is null or v_host_id <> auth.uid() then
    raise exception 'event host scope required for repeat-event memory';
  end if;

  select c.venue_key
    into v_venue_key
  from public.venue_learning_contexts c
  where c.event_id = p_event_id
  limit 1;

  if v_venue_key is null then
    return;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 24), 60));

  return query
  select
    co.event_id as source_event_id,
    co.venue_key,
    co.closed_at,
    co.measured_intervention_count,
    co.positive_intervention_count,
    co.mean_measured_effect,
    co.positive_rate,
    co.mean_measurement_confidence,
    co.evidence_coverage,
    co.release_id,
    co.layout_version,
    co.geometry_hash,
    co.policy_version,
    co.model_version
  from public.venue_event_closeouts co
  join public.events he
    on he.id = co.event_id
   and he.host_id = v_host_id
   and he.id <> p_event_id
   and he.ended_at is not null
  where co.venue_key = v_venue_key
  order by co.closed_at desc, co.event_id
  limit v_limit;
end;
$$;

revoke all on function public.get_venue_repeat_event_measurements(uuid, integer) from public;
revoke all on function public.get_venue_repeat_event_closeouts(uuid, integer) from public;
grant execute on function public.get_venue_repeat_event_measurements(uuid, integer) to authenticated;
grant execute on function public.get_venue_repeat_event_closeouts(uuid, integer) to authenticated;

comment on function public.get_venue_repeat_event_measurements(uuid, integer) is
  'Returns bounded, host-private measured intervention history from the same venue for context-scoped repeat-event learning. Does not expose other hosts or attendee trajectories.';
comment on function public.get_venue_repeat_event_closeouts(uuid, integer) is
  'Returns bounded, host-private aggregate closeouts from the same venue for portfolio benchmarking. No cross-customer benchmark is exposed.';
