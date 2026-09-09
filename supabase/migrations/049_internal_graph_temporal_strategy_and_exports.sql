-- =============================================================================
-- 049_internal_graph_temporal_strategy_and_exports.sql
-- Adds event-to-event strategy surfaces, bridge-pattern calibration, and an
-- explicit export capability boundary for Constellation.
-- =============================================================================

-- graph_manage is intentionally powerful for curation, but it must not silently
-- unlock restricted safety topology or bulk export. Those remain independent
-- capabilities so operator provisioning can follow least privilege.
create or replace function public.has_internal_operator_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.internal_operator_access access
    where access.user_id = auth.uid()
      and (access.expires_at is null or access.expires_at > now())
      and case p_capability
        when 'graph_read' then access.capabilities && array[
          'graph_read', 'graph_manage', 'graph_restricted', 'graph_export'
        ]::text[]
        when 'graph_manage' then 'graph_manage' = any(access.capabilities)
        when 'graph_restricted' then 'graph_restricted' = any(access.capabilities)
        when 'graph_export' then 'graph_export' = any(access.capabilities)
        else false
      end
  );
$$;
revoke all on function public.has_internal_operator_capability(text) from public;
grant execute on function public.has_internal_operator_capability(text) to authenticated;

-- Ordered event catalog for graph drift. This intentionally returns aggregate
-- event/network evidence only; it does not expose join/access secrets or precise
-- venue coordinates.
create or replace function public.get_internal_graph_event_sequence(p_limit integer default 36)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(120, greatest(2, coalesce(p_limit, 36)));
  v_events jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from (
    select
      e.id as event_id,
      coalesce(e.ends_at, e.starts_at, e.created_at) as sort_at,
      jsonb_build_object(
        'eventId', e.id,
        'name', e.name,
        'startsAt', e.starts_at,
        'endsAt', e.ends_at,
        'finalizedAt', e.finalized_at,
        'venueKey', case
          when e.latitude is not null or e.longitude is not null or nullif(trim(e.address), '') is not null
            then public.compute_world_memory_venue_key(e.address, e.latitude, e.longitude, e.id)
          else null
        end,
        'participantCount', (
          select count(*) from public.event_participants ep
          where ep.event_id = e.id and ep.status = 'approved'
        ),
        'mutualCount', (
          select count(*) from public.matches m where m.event_id = e.id
        ),
        'officeHoursCompleted', (
          select count(*) from public.office_hours_requests o
          where o.event_id = e.id and o.status = 'completed'
        ),
        'outcomeCompleted', (
          select count(*) from public.outcome_handshakes h
          where h.event_id = e.id and h.status = 'completed'
        )
      ) as row_payload
    from public.events e
    where exists (
      select 1 from public.event_participants ep where ep.event_id = e.id
    )
    order by coalesce(e.ends_at, e.starts_at, e.created_at) desc, e.id desc
    limit v_limit
  ) ranked;

  insert into public.internal_graph_audit_log(actor_id, action, metadata)
  values (auth.uid(), 'graph_event_sequence_read', jsonb_build_object('limit', v_limit));

  return jsonb_build_object('generatedAt', now(), 'events', v_events);
end;
$$;
revoke all on function public.get_internal_graph_event_sequence(integer) from public;
grant execute on function public.get_internal_graph_event_sequence(integer) to authenticated;

-- Historical bridge archetypes. We calibrate on connector KIND rather than a
-- specific person's identity so the result can generalize while remaining
-- honest about sample size and correlation-not-causation.
create or replace function public.get_internal_bridge_pattern_calibration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_patterns jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select coalesce(jsonb_agg(pattern_payload order by outcome_rate desc, sample_size desc, connector_kind), '[]'::jsonb)
  into v_patterns
  from (
    select
      coalesce(n.kind, 'unknown') as connector_kind,
      count(*)::integer as sample_size,
      public.safe_ratio(count(*) filter (where w.disposition = 'introduced'), count(*)) as introduced_rate,
      public.safe_ratio(count(*) filter (where w.observed_stage <> 'none'), count(*)) as mutual_rate,
      public.safe_ratio(
        count(*) filter (where w.observed_stage in ('office_hours', 'outcome_aligned', 'outcome_completed')),
        count(*)
      ) as office_hours_rate,
      public.safe_ratio(
        count(*) filter (where w.observed_stage in ('outcome_aligned', 'outcome_completed')),
        count(*)
      ) as outcome_rate,
      public.safe_ratio(count(*) filter (where w.observed_stage = 'outcome_completed'), count(*)) as completed_rate,
      avg(w.initial_score)::numeric(8,4) as average_initial_score,
      max(w.updated_at) as last_observed_at,
      jsonb_build_object(
        'connectorKind', coalesce(n.kind, 'unknown'),
        'sampleSize', count(*)::integer,
        'introducedRate', public.safe_ratio(count(*) filter (where w.disposition = 'introduced'), count(*)),
        'mutualRate', public.safe_ratio(count(*) filter (where w.observed_stage <> 'none'), count(*)),
        'officeHoursRate', public.safe_ratio(
          count(*) filter (where w.observed_stage in ('office_hours', 'outcome_aligned', 'outcome_completed')),
          count(*)
        ),
        'outcomeRate', public.safe_ratio(
          count(*) filter (where w.observed_stage in ('outcome_aligned', 'outcome_completed')),
          count(*)
        ),
        'completedRate', public.safe_ratio(count(*) filter (where w.observed_stage = 'outcome_completed'), count(*)),
        'averageInitialScore', coalesce(avg(w.initial_score), 0),
        'confidence', least(1::numeric, count(*)::numeric / 20::numeric),
        'lastObservedAt', max(w.updated_at)
      ) as pattern_payload
    from public.internal_graph_bridge_watches w
    left join public.internal_graph_node_memory n on n.node_key = w.via_node_key
    where w.expires_at > now()
      and w.disposition <> 'dismissed'
    group by coalesce(n.kind, 'unknown')
  ) patterns;

  return jsonb_build_object(
    'generatedAt', now(),
    'patterns', v_patterns,
    'attributionNote', 'Pattern rates describe observed chronology after operator watches/introduction marks. They are not causal estimates.'
  );
end;
$$;
revoke all on function public.get_internal_bridge_pattern_calibration() from public;
grant execute on function public.get_internal_bridge_pattern_calibration() to authenticated;

-- Bulk graph export is a separate privilege. The returned payload keeps the same
-- evidence schema as the interactive graph; serialization to GraphML/Cypher is
-- deterministic in the client and strips direct subject UUID attributes.
create or replace function public.get_internal_graph_export_payload(
  p_event_id uuid default null,
  p_include_restricted boolean default false,
  p_limit integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if not public.has_internal_operator_capability('graph_export') then
    raise exception 'Internal graph export capability required';
  end if;
  if p_include_restricted and not public.has_internal_operator_capability('graph_restricted') then
    raise exception 'Restricted graph capability required';
  end if;

  v_payload := public.get_internal_intelligence_graph(
    p_event_id,
    p_include_restricted,
    least(2000, greatest(20, coalesce(p_limit, 1800)))
  );

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(),
    'graph_export_payload',
    p_event_id,
    jsonb_build_object(
      'restricted', p_include_restricted,
      'nodeCount', coalesce((v_payload->>'nodeCount')::integer, 0),
      'edgeCount', coalesce((v_payload->>'edgeCount')::integer, 0)
    )
  );

  return v_payload;
end;
$$;
revoke all on function public.get_internal_graph_export_payload(uuid, boolean, integer) from public;
grant execute on function public.get_internal_graph_export_payload(uuid, boolean, integer) to authenticated;

comment on function public.get_internal_bridge_pattern_calibration() is
  'Operator-only connector-kind calibration from bounded bridge-watch chronology; explicitly non-causal.';
comment on function public.get_internal_graph_export_payload(uuid, boolean, integer) is
  'Graph-export-capability-gated payload for deterministic GraphML/Neo4j serialization.';
