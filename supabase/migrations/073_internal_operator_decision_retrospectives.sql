-- =============================================================================
-- 073_internal_operator_decision_retrospectives.sql
-- Bounded metrics-only retrospective context for falsifiable operator decisions.
--
-- The journal intentionally keeps graph evidence as a digest. Retrospectives add
-- only a strict allowlist of analytical-state metrics so Beacon can learn which
-- reasoning conditions preceded supported/weakened/invalidated hypotheses without
-- retaining graph payloads, person ids, target queries, contact data, or movement.
-- =============================================================================

create table if not exists public.internal_operator_decision_context (
  journal_id uuid primary key references public.internal_operator_decision_journal(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  created_graph_version text not null check (char_length(created_graph_version) between 8 and 240),
  created_health_score numeric(6,5) not null check (created_health_score between 0 and 1),
  created_verified_ratio numeric(6,5) not null check (created_verified_ratio between 0 and 1),
  created_ambiguous_ratio numeric(6,5) not null check (created_ambiguous_ratio between 0 and 1),
  created_fresh_ratio numeric(6,5) not null check (created_fresh_ratio between 0 and 1),
  created_repeated_ratio numeric(6,5) not null check (created_repeated_ratio between 0 and 1),
  created_route_diversity numeric(6,5) check (created_route_diversity is null or created_route_diversity between 0 and 1),
  created_route_count integer not null default 0 check (created_route_count between 0 and 32),
  created_shared_bottlenecks integer not null default 0 check (created_shared_bottlenecks between 0 and 64),
  created_temporal_overlap numeric(6,5) check (created_temporal_overlap is null or created_temporal_overlap between 0 and 1),
  created_chronology_gaps integer not null default 0 check (created_chronology_gaps between 0 and 10000),
  created_open_incidents integer not null default 0 check (created_open_incidents between 0 and 10000),
  created_critical_incidents integer not null default 0 check (created_critical_incidents between 0 and 10000),
  created_calibration_penalty numeric(6,5) not null default 0 check (created_calibration_penalty between 0 and 0.45),
  resolved_graph_version text check (resolved_graph_version is null or char_length(resolved_graph_version) between 8 and 240),
  resolved_health_score numeric(6,5) check (resolved_health_score is null or resolved_health_score between 0 and 1),
  resolved_verified_ratio numeric(6,5) check (resolved_verified_ratio is null or resolved_verified_ratio between 0 and 1),
  resolved_ambiguous_ratio numeric(6,5) check (resolved_ambiguous_ratio is null or resolved_ambiguous_ratio between 0 and 1),
  resolved_fresh_ratio numeric(6,5) check (resolved_fresh_ratio is null or resolved_fresh_ratio between 0 and 1),
  resolved_repeated_ratio numeric(6,5) check (resolved_repeated_ratio is null or resolved_repeated_ratio between 0 and 1),
  resolved_route_diversity numeric(6,5) check (resolved_route_diversity is null or resolved_route_diversity between 0 and 1),
  resolved_route_count integer check (resolved_route_count is null or resolved_route_count between 0 and 32),
  resolved_shared_bottlenecks integer check (resolved_shared_bottlenecks is null or resolved_shared_bottlenecks between 0 and 64),
  resolved_temporal_overlap numeric(6,5) check (resolved_temporal_overlap is null or resolved_temporal_overlap between 0 and 1),
  resolved_chronology_gaps integer check (resolved_chronology_gaps is null or resolved_chronology_gaps between 0 and 10000),
  resolved_open_incidents integer check (resolved_open_incidents is null or resolved_open_incidents between 0 and 10000),
  resolved_critical_incidents integer check (resolved_critical_incidents is null or resolved_critical_incidents between 0 and 10000),
  resolved_calibration_penalty numeric(6,5) check (resolved_calibration_penalty is null or resolved_calibration_penalty between 0 and 0.45),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.internal_operator_decision_context enable row level security;
revoke all on table public.internal_operator_decision_context from public, anon, authenticated;

create or replace function public.internal_decision_metric(
  p_metrics jsonb,
  p_key text,
  p_default numeric,
  p_min numeric,
  p_max numeric
)
returns numeric
language plpgsql
immutable
as $$
declare v numeric;
begin
  if p_metrics ? p_key then
    begin
      v := (p_metrics->>p_key)::numeric;
    exception when others then
      raise exception 'Invalid retrospective metric: %', p_key;
    end;
  else
    v := p_default;
  end if;
  if v < p_min or v > p_max then raise exception 'Retrospective metric out of range: %', p_key; end if;
  return v;
end;
$$;
revoke all on function public.internal_decision_metric(jsonb, text, numeric, numeric, numeric) from public;

create or replace function public.internal_decision_metric_int(
  p_metrics jsonb,
  p_key text,
  p_default integer,
  p_min integer,
  p_max integer
)
returns integer
language plpgsql
immutable
as $$
declare v integer;
begin
  if p_metrics ? p_key then
    begin
      v := (p_metrics->>p_key)::integer;
    exception when others then
      raise exception 'Invalid retrospective integer metric: %', p_key;
    end;
  else
    v := p_default;
  end if;
  if v < p_min or v > p_max then raise exception 'Retrospective integer metric out of range: %', p_key; end if;
  return v;
end;
$$;
revoke all on function public.internal_decision_metric_int(jsonb, text, integer, integer, integer) from public;

create or replace function public.internal_decision_metrics_valid(p_metrics jsonb)
returns boolean
language plpgsql
immutable
as $$
declare k text;
begin
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'object' or pg_column_size(p_metrics) > 4096 then return false; end if;
  for k in select jsonb_object_keys(p_metrics) loop
    if k not in (
      'healthScore','verifiedRatio','ambiguousRatio','freshRatio','repeatedRatio',
      'routeDiversity','routeCount','sharedBottlenecks','temporalOverlap',
      'chronologyGaps','openIncidents','criticalIncidents','calibrationPenalty'
    ) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.internal_decision_metrics_valid(jsonb) from public;

create or replace function public.record_internal_operator_decision_context(
  p_journal_id uuid,
  p_phase text,
  p_graph_version text,
  p_metrics jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.internal_operator_decision_journal;
  v_route_div numeric;
  v_temporal numeric;
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  if p_phase not in ('created','resolved') then raise exception 'Unsupported retrospective phase'; end if;
  if not public.internal_decision_metrics_valid(p_metrics) then raise exception 'Retrospective metrics violate strict allowlist/bounds'; end if;

  select * into v_entry from public.internal_operator_decision_journal j
  where j.id = p_journal_id and j.operator_id = auth.uid() and j.expires_at > now();
  if v_entry.id is null then raise exception 'Decision journal entry unavailable'; end if;
  if nullif(trim(p_graph_version),'') is null or char_length(trim(p_graph_version)) not between 8 and 240 then raise exception 'Graph version is invalid'; end if;

  v_route_div := case when p_metrics ? 'routeDiversity' then public.internal_decision_metric(p_metrics,'routeDiversity',0,0,1) else null end;
  v_temporal := case when p_metrics ? 'temporalOverlap' then public.internal_decision_metric(p_metrics,'temporalOverlap',0,0,1) else null end;

  if p_phase = 'created' then
    insert into public.internal_operator_decision_context(
      journal_id, operator_id, event_id, created_graph_version,
      created_health_score, created_verified_ratio, created_ambiguous_ratio,
      created_fresh_ratio, created_repeated_ratio, created_route_diversity,
      created_route_count, created_shared_bottlenecks, created_temporal_overlap,
      created_chronology_gaps, created_open_incidents, created_critical_incidents,
      created_calibration_penalty
    ) values (
      v_entry.id, auth.uid(), v_entry.event_id, trim(p_graph_version),
      public.internal_decision_metric(p_metrics,'healthScore',0,0,1),
      public.internal_decision_metric(p_metrics,'verifiedRatio',0,0,1),
      public.internal_decision_metric(p_metrics,'ambiguousRatio',0,0,1),
      public.internal_decision_metric(p_metrics,'freshRatio',0,0,1),
      public.internal_decision_metric(p_metrics,'repeatedRatio',0,0,1),
      v_route_div,
      public.internal_decision_metric_int(p_metrics,'routeCount',0,0,32),
      public.internal_decision_metric_int(p_metrics,'sharedBottlenecks',0,0,64),
      v_temporal,
      public.internal_decision_metric_int(p_metrics,'chronologyGaps',0,0,10000),
      public.internal_decision_metric_int(p_metrics,'openIncidents',0,0,10000),
      public.internal_decision_metric_int(p_metrics,'criticalIncidents',0,0,10000),
      public.internal_decision_metric(p_metrics,'calibrationPenalty',0,0,0.45)
    )
    on conflict (journal_id) do nothing;
  else
    update public.internal_operator_decision_context c set
      resolved_graph_version = trim(p_graph_version),
      resolved_health_score = public.internal_decision_metric(p_metrics,'healthScore',0,0,1),
      resolved_verified_ratio = public.internal_decision_metric(p_metrics,'verifiedRatio',0,0,1),
      resolved_ambiguous_ratio = public.internal_decision_metric(p_metrics,'ambiguousRatio',0,0,1),
      resolved_fresh_ratio = public.internal_decision_metric(p_metrics,'freshRatio',0,0,1),
      resolved_repeated_ratio = public.internal_decision_metric(p_metrics,'repeatedRatio',0,0,1),
      resolved_route_diversity = v_route_div,
      resolved_route_count = public.internal_decision_metric_int(p_metrics,'routeCount',0,0,32),
      resolved_shared_bottlenecks = public.internal_decision_metric_int(p_metrics,'sharedBottlenecks',0,0,64),
      resolved_temporal_overlap = v_temporal,
      resolved_chronology_gaps = public.internal_decision_metric_int(p_metrics,'chronologyGaps',0,0,10000),
      resolved_open_incidents = public.internal_decision_metric_int(p_metrics,'openIncidents',0,0,10000),
      resolved_critical_incidents = public.internal_decision_metric_int(p_metrics,'criticalIncidents',0,0,10000),
      resolved_calibration_penalty = public.internal_decision_metric(p_metrics,'calibrationPenalty',0,0,0.45),
      resolved_at = now()
    where c.journal_id = v_entry.id and c.operator_id = auth.uid();
    if not found then raise exception 'Creation retrospective context must be recorded before resolution context'; end if;
  end if;

  return true;
end;
$$;
revoke all on function public.record_internal_operator_decision_context(uuid, text, text, jsonb) from public;
grant execute on function public.record_internal_operator_decision_context(uuid, text, text, jsonb) to authenticated;

create or replace function public.get_internal_operator_decision_retrospectives(
  p_event_id uuid default null,
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  return jsonb_build_object(
    'generatedAt', now(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'journalId', j.id,
        'decisionKind', j.decision_kind,
        'status', j.status,
        'admissionAuthority', j.admission_authority,
        'createdGraphVersion', c.created_graph_version,
        'createdHealthScore', c.created_health_score,
        'createdVerifiedRatio', c.created_verified_ratio,
        'createdAmbiguousRatio', c.created_ambiguous_ratio,
        'createdFreshRatio', c.created_fresh_ratio,
        'createdRepeatedRatio', c.created_repeated_ratio,
        'createdRouteDiversity', c.created_route_diversity,
        'createdRouteCount', c.created_route_count,
        'createdSharedBottlenecks', c.created_shared_bottlenecks,
        'createdTemporalOverlap', c.created_temporal_overlap,
        'createdChronologyGaps', c.created_chronology_gaps,
        'createdOpenIncidents', c.created_open_incidents,
        'createdCriticalIncidents', c.created_critical_incidents,
        'createdCalibrationPenalty', c.created_calibration_penalty,
        'resolvedGraphVersion', c.resolved_graph_version,
        'resolvedHealthScore', c.resolved_health_score,
        'resolvedVerifiedRatio', c.resolved_verified_ratio,
        'resolvedAmbiguousRatio', c.resolved_ambiguous_ratio,
        'resolvedFreshRatio', c.resolved_fresh_ratio,
        'resolvedRepeatedRatio', c.resolved_repeated_ratio,
        'resolvedRouteDiversity', c.resolved_route_diversity,
        'resolvedRouteCount', c.resolved_route_count,
        'resolvedSharedBottlenecks', c.resolved_shared_bottlenecks,
        'resolvedTemporalOverlap', c.resolved_temporal_overlap,
        'resolvedChronologyGaps', c.resolved_chronology_gaps,
        'resolvedOpenIncidents', c.resolved_open_incidents,
        'resolvedCriticalIncidents', c.resolved_critical_incidents,
        'resolvedCalibrationPenalty', c.resolved_calibration_penalty,
        'createdAt', c.created_at,
        'resolvedAt', c.resolved_at
      ) order by coalesce(c.resolved_at, c.created_at) desc)
      from public.internal_operator_decision_context c
      join public.internal_operator_decision_journal j on j.id = c.journal_id
      where c.operator_id = auth.uid()
        and (p_event_id is null or c.event_id = p_event_id)
      limit least(250, greatest(1, coalesce(p_limit,120)))
    ), '[]'::jsonb),
    'operatingRule', 'Retrospectives store bounded analytical-state metrics only. They do not retain graph payloads, target queries, person ids, or infer causation from later outcomes.'
  );
end;
$$;
revoke all on function public.get_internal_operator_decision_retrospectives(uuid, integer) from public;
grant execute on function public.get_internal_operator_decision_retrospectives(uuid, integer) to authenticated;

comment on table public.internal_operator_decision_context is
  'Metrics-only retrospective context for falsifiable operator decisions. No graph payload, person target, contact data, target query, or movement history is retained.';
