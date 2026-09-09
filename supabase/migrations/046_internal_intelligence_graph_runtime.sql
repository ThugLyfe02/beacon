-- =============================================================================
-- 046_internal_intelligence_graph_runtime.sql
-- Derives the operator graph from Beacon's authoritative first-party tables.
--
-- The graph is a materialized evidence memory, not a source of business truth.
-- Re-running refresh is idempotent: evidence counts reflect source rows rather
-- than the number of refresh calls. Person labels resolve live through erasable
-- aliases, so account erasure removes identity-linked graph state.
-- =============================================================================

create or replace function public.refresh_internal_intelligence_graph(
  p_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_alias uuid;
  v_alias_b uuid;
  v_source text;
  v_target text;
  v_scope text;
  v_nodes_before bigint;
  v_edges_before bigint;
  v_nodes_after bigint;
  v_edges_after bigint;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  if p_event_id is not null and not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Unknown event scope';
  end if;

  select count(*) into v_nodes_before from public.internal_graph_node_memory;
  select count(*) into v_edges_before from public.internal_graph_edge_memory;

  -- -------------------------------------------------------------------------
  -- Person aliases and current person nodes. Event-scoped refresh only touches
  -- people involved in that event; global refresh covers all current users.
  -- -------------------------------------------------------------------------
  if p_event_id is null then
    insert into public.internal_graph_subject_aliases (user_id)
    select u.id from public.users u
    on conflict (user_id) do nothing;
  else
    insert into public.internal_graph_subject_aliases (user_id)
    select distinct ep.user_id
    from public.event_participants ep
    where ep.event_id = p_event_id
    on conflict (user_id) do nothing;
  end if;

  for r in
    select u.id, u.created_at, a.alias
    from public.users u
    join public.internal_graph_subject_aliases a on a.user_id = u.id
    where p_event_id is null
       or exists (
         select 1 from public.event_participants ep
         where ep.event_id = p_event_id and ep.user_id = u.id
       )
  loop
    perform public.upsert_internal_graph_node(
      'person:' || r.alias::text,
      'person',
      'standard',
      r.created_at,
      '{}'::jsonb,
      now() + interval '730 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Event, venue and room nodes.
  -- -------------------------------------------------------------------------
  for r in
    select e.*
    from public.events e
    where p_event_id is null or e.id = p_event_id
  loop
    v_scope := 'event:' || r.id::text;

    perform public.upsert_internal_graph_node(
      v_scope,
      'event',
      'standard',
      r.created_at,
      jsonb_build_object(
        'label', r.name,
        'eventId', r.id,
        'finalized', r.finalized_at is not null,
        'startsAt', r.starts_at,
        'endsAt', r.ends_at
      ),
      now() + interval '1095 days'
    );

    if r.latitude is not null or r.longitude is not null or nullif(trim(r.address), '') is not null then
      v_target := 'venue:' || public.compute_world_memory_venue_key(
        r.address, r.latitude, r.longitude, r.id
      );
      perform public.upsert_internal_graph_node(
        v_target,
        'venue',
        'standard',
        r.created_at,
        jsonb_build_object(
          'label', coalesce(nullif(trim(r.address), ''), 'Venue cluster'),
          'venueKey', replace(v_target, 'venue:', '')
        ),
        now() + interval '1095 days'
      );
      perform public.upsert_internal_graph_edge(
        v_scope,
        v_scope,
        v_target,
        'at_venue',
        true,
        'VERIFIED',
        'standard',
        1.3,
        r.created_at,
        coalesce(r.finalized_at, r.created_at),
        1,
        jsonb_build_object('source', 'events', 'eventId', r.id),
        now() + interval '1095 days'
      );
    end if;
  end loop;

  for r in
    select room.id, room.event_id, room.label, room.capacity, room.created_at
    from public.venue_rooms room
    where p_event_id is null or room.event_id = p_event_id
  loop
    v_scope := 'event:' || r.event_id::text;
    v_target := 'room:' || r.id::text;
    perform public.upsert_internal_graph_node(
      v_target,
      'room',
      'standard',
      r.created_at,
      jsonb_build_object('label', r.label, 'capacity', r.capacity, 'roomId', r.id),
      now() + interval '730 days'
    );
    perform public.upsert_internal_graph_edge(
      v_scope,
      v_scope,
      v_target,
      'has_room',
      true,
      'VERIFIED',
      'standard',
      0.8,
      r.created_at,
      r.created_at,
      1,
      jsonb_build_object('source', 'venue_rooms', 'roomId', r.id, 'eventId', r.event_id),
      now() + interval '730 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Host + participant relationships.
  -- -------------------------------------------------------------------------
  for r in
    select e.id event_id, e.host_id, e.created_at
    from public.events e
    where e.host_id is not null and (p_event_id is null or e.id = p_event_id)
  loop
    v_alias := public.ensure_internal_graph_alias(r.host_id);
    v_source := 'person:' || v_alias::text;
    v_target := 'event:' || r.event_id::text;
    perform public.upsert_internal_graph_edge(
      v_target, v_source, v_target, 'hosted', true, 'VERIFIED', 'standard',
      1.8, r.created_at, r.created_at, 1,
      jsonb_build_object('source', 'events', 'eventId', r.event_id),
      now() + interval '1095 days'
    );
  end loop;

  for r in
    select ep.event_id, ep.user_id, ep.status, ep.joined_at
    from public.event_participants ep
    where p_event_id is null or ep.event_id = p_event_id
  loop
    v_alias := public.ensure_internal_graph_alias(r.user_id);
    v_source := 'person:' || v_alias::text;
    v_target := 'event:' || r.event_id::text;
    perform public.upsert_internal_graph_edge(
      v_target,
      v_source,
      v_target,
      case r.status
        when 'approved' then 'attended'
        when 'pending' then 'join_requested'
        else 'join_rejected'
      end,
      true,
      'VERIFIED',
      case when r.status = 'approved' then 'standard'::public.internal_graph_sensitivity else 'restricted'::public.internal_graph_sensitivity end,
      case when r.status = 'approved' then 1.2 else 0.45 end,
      r.joined_at,
      r.joined_at,
      1,
      jsonb_build_object('source', 'event_participants', 'eventId', r.event_id, 'status', r.status),
      now() + case when r.status = 'approved' then interval '730 days' else interval '180 days' end
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Current role strings become explicit entity nodes instead of O(n^2)
  -- same-role person edges. That keeps the graph sparse and makes two-hop role
  -- bridges explainable.
  -- -------------------------------------------------------------------------
  for r in
    select u.id user_id, u.role, u.updated_at, a.alias
    from public.users u
    join public.internal_graph_subject_aliases a on a.user_id = u.id
    where nullif(trim(u.role), '') is not null
      and (
        p_event_id is null
        or exists (
          select 1 from public.event_participants ep
          where ep.event_id = p_event_id and ep.user_id = u.id
        )
      )
  loop
    v_source := 'person:' || r.alias::text;
    v_target := 'role:' || encode(digest(lower(trim(r.role)), 'sha256'), 'hex');
    perform public.upsert_internal_graph_node(
      v_target,
      'role',
      'standard',
      r.updated_at,
      jsonb_build_object('label', trim(r.role)),
      now() + interval '365 days'
    );
    perform public.upsert_internal_graph_edge(
      'global', v_source, v_target, 'has_role', true, 'DERIVED', 'standard',
      0.75, r.updated_at, r.updated_at, 1,
      jsonb_build_object('source', 'users.role'),
      now() + interval '365 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Explicit social follow edges. In event refresh, only keep follows where
  -- both people participate in the event so the local graph does not explode.
  -- -------------------------------------------------------------------------
  for r in
    select f.follower_id, f.followed_id, f.created_at
    from public.follows f
    where p_event_id is null
       or (
         exists (select 1 from public.event_participants ep where ep.event_id = p_event_id and ep.user_id = f.follower_id)
         and exists (select 1 from public.event_participants ep where ep.event_id = p_event_id and ep.user_id = f.followed_id)
       )
  loop
    v_alias := public.ensure_internal_graph_alias(r.follower_id);
    v_alias_b := public.ensure_internal_graph_alias(r.followed_id);
    perform public.upsert_internal_graph_edge(
      'global',
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      'follows', true, 'VERIFIED', 'standard', 0.45,
      r.created_at, r.created_at, 1,
      jsonb_build_object('source', 'follows'),
      now() + interval '730 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- High-intent connection signals, aggregated by event + directed pair.
  -- -------------------------------------------------------------------------
  for r in
    select cr.event_id, cr.requester_id, cr.recipient_id,
           min(cr.created_at) first_seen,
           max(cr.created_at) last_seen,
           count(*)::integer evidence_count,
           count(*) filter (where cr.status = 'withdrawn')::integer withdrawn_count
    from public.connection_requests cr
    where p_event_id is null or cr.event_id = p_event_id
    group by cr.event_id, cr.requester_id, cr.recipient_id
  loop
    v_alias := public.ensure_internal_graph_alias(r.requester_id);
    v_alias_b := public.ensure_internal_graph_alias(r.recipient_id);
    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      'signaled', true, 'VERIFIED', 'standard',
      least(2.0, 0.65 + (r.evidence_count * 0.15)),
      r.first_seen, r.last_seen, r.evidence_count,
      jsonb_build_object(
        'source', 'connection_requests',
        'eventId', r.event_id,
        'withdrawnCount', r.withdrawn_count
      ),
      r.last_seen + interval '730 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Mutuals: canonical undirected relationship.
  -- -------------------------------------------------------------------------
  for r in
    select m.event_id, m.user_a_id, m.user_b_id,
           min(m.created_at) first_seen,
           max(m.created_at) last_seen,
           count(*)::integer evidence_count
    from public.matches m
    where p_event_id is null or m.event_id = p_event_id
    group by m.event_id, m.user_a_id, m.user_b_id
  loop
    v_alias := public.ensure_internal_graph_alias(r.user_a_id);
    v_alias_b := public.ensure_internal_graph_alias(r.user_b_id);
    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      'mutual_with', false, 'VERIFIED', 'standard', 1.6,
      r.first_seen, r.last_seen, r.evidence_count,
      jsonb_build_object('source', 'matches', 'eventId', r.event_id),
      r.last_seen + interval '1095 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Office Hours: one edge whose strength reflects the strongest verified state.
  -- -------------------------------------------------------------------------
  for r in
    select o.event_id,
           least(o.requester_id::text, o.recipient_id::text) left_id,
           greatest(o.requester_id::text, o.recipient_id::text) right_id,
           min(o.created_at) first_seen,
           max(coalesce(o.responded_at, o.created_at)) last_seen,
           count(*)::integer evidence_count,
           count(*) filter (where o.status = 'completed')::integer completed_count,
           count(*) filter (where o.status = 'awaiting_escort')::integer escorted_count,
           count(*) filter (where o.status = 'accepted')::integer accepted_count
    from public.office_hours_requests o
    where p_event_id is null or o.event_id = p_event_id
    group by o.event_id,
             least(o.requester_id::text, o.recipient_id::text),
             greatest(o.requester_id::text, o.recipient_id::text)
  loop
    v_alias := public.ensure_internal_graph_alias(r.left_id::uuid);
    v_alias_b := public.ensure_internal_graph_alias(r.right_id::uuid);
    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      'office_hours_with', false, 'VERIFIED', 'standard',
      case
        when r.completed_count > 0 then 2.9
        when r.escorted_count > 0 then 2.3
        when r.accepted_count > 0 then 1.8
        else 0.9
      end,
      r.first_seen, r.last_seen, r.evidence_count,
      jsonb_build_object(
        'source', 'office_hours_requests',
        'eventId', r.event_id,
        'completedCount', r.completed_count,
        'escortedCount', r.escorted_count,
        'acceptedCount', r.accepted_count
      ),
      r.last_seen + interval '1095 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Private outcome alignment. Only aligned/completed shared state becomes an
  -- edge; unaligned private intents are intentionally excluded.
  -- -------------------------------------------------------------------------
  for r in
    select h.id, h.event_id, h.user_a_id, h.user_b_id, h.status,
           h.activation_type, h.created_at, h.aligned_at, h.completed_at
    from public.outcome_handshakes h
    where h.status in ('aligned', 'completed')
      and (p_event_id is null or h.event_id = p_event_id)
  loop
    v_alias := public.ensure_internal_graph_alias(r.user_a_id);
    v_alias_b := public.ensure_internal_graph_alias(r.user_b_id);

    v_target := 'outcome:' || coalesce(r.activation_type, 'shared_intent');
    perform public.upsert_internal_graph_node(
      v_target,
      'outcome',
      'standard',
      coalesce(r.aligned_at, r.created_at),
      jsonb_build_object('label', replace(coalesce(r.activation_type, 'shared_intent'), '_', ' ')),
      now() + interval '1095 days'
    );

    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      case when r.status = 'completed' then 'outcome_completed' else 'outcome_aligned' end,
      false,
      'VERIFIED',
      'standard',
      case when r.status = 'completed' then 3.6 else 2.5 end,
      coalesce(r.aligned_at, r.created_at),
      coalesce(r.completed_at, r.aligned_at, r.created_at),
      1,
      jsonb_build_object(
        'source', 'outcome_handshakes',
        'handshakeId', r.id,
        'eventId', r.event_id,
        'activationType', r.activation_type,
        'status', r.status
      ),
      coalesce(r.completed_at, r.aligned_at, r.created_at) + interval '1095 days'
    );

    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias::text,
      v_target,
      'aligned_to_outcome',
      true,
      'VERIFIED',
      'standard',
      1.4,
      coalesce(r.aligned_at, r.created_at),
      coalesce(r.completed_at, r.aligned_at, r.created_at),
      1,
      jsonb_build_object('source', 'outcome_handshakes', 'handshakeId', r.id),
      coalesce(r.completed_at, r.aligned_at, r.created_at) + interval '1095 days'
    );
    perform public.upsert_internal_graph_edge(
      'event:' || r.event_id::text,
      'person:' || v_alias_b::text,
      v_target,
      'aligned_to_outcome',
      true,
      'VERIFIED',
      'standard',
      1.4,
      coalesce(r.aligned_at, r.created_at),
      coalesce(r.completed_at, r.aligned_at, r.created_at),
      1,
      jsonb_build_object('source', 'outcome_handshakes', 'handshakeId', r.id),
      coalesce(r.completed_at, r.aligned_at, r.created_at) + interval '1095 days'
    );
  end loop;

  -- -------------------------------------------------------------------------
  -- Restricted safety-forensics edges. Never returned without graph_restricted.
  -- Free-text report/block reasons are intentionally not copied into graph memory.
  -- -------------------------------------------------------------------------
  for r in
    select b.blocker_id, b.blocked_id, b.created_at
    from public.user_blocks b
    where p_event_id is null
       or (
         exists (select 1 from public.event_participants ep where ep.event_id = p_event_id and ep.user_id = b.blocker_id)
         and exists (select 1 from public.event_participants ep where ep.event_id = p_event_id and ep.user_id = b.blocked_id)
       )
  loop
    v_alias := public.ensure_internal_graph_alias(r.blocker_id);
    v_alias_b := public.ensure_internal_graph_alias(r.blocked_id);
    perform public.upsert_internal_graph_edge(
      'global', 'person:' || v_alias::text, 'person:' || v_alias_b::text,
      'blocked', true, 'VERIFIED', 'restricted', 1.0,
      r.created_at, r.created_at, 1,
      jsonb_build_object('source', 'user_blocks'),
      r.created_at + interval '180 days'
    );
  end loop;

  for r in
    select ar.event_id, ar.reporter_id, ar.target_id,
           min(ar.created_at) first_seen,
           max(ar.created_at) last_seen,
           count(*)::integer evidence_count
    from public.abuse_reports ar
    where p_event_id is null or ar.event_id = p_event_id
    group by ar.event_id, ar.reporter_id, ar.target_id
  loop
    v_alias := public.ensure_internal_graph_alias(r.reporter_id);
    v_alias_b := public.ensure_internal_graph_alias(r.target_id);
    perform public.upsert_internal_graph_edge(
      coalesce('event:' || r.event_id::text, 'global'),
      'person:' || v_alias::text,
      'person:' || v_alias_b::text,
      'reported', true, 'VERIFIED', 'restricted',
      least(3.0, 1.2 + (r.evidence_count * 0.3)),
      r.first_seen, r.last_seen, r.evidence_count,
      jsonb_build_object('source', 'abuse_reports', 'eventId', r.event_id),
      r.last_seen + interval '180 days'
    );
  end loop;

  select count(*) into v_nodes_after from public.internal_graph_node_memory;
  select count(*) into v_edges_after from public.internal_graph_edge_memory;

  insert into public.internal_graph_audit_log (actor_id, action, event_id, metadata)
  values (
    auth.uid(),
    'graph_refresh',
    p_event_id,
    jsonb_build_object(
      'nodesBefore', v_nodes_before,
      'nodesAfter', v_nodes_after,
      'edgesBefore', v_edges_before,
      'edgesAfter', v_edges_after
    )
  );

  return jsonb_build_object(
    'refreshedAt', now(),
    'eventId', p_event_id,
    'nodeCount', v_nodes_after,
    'edgeCount', v_edges_after
  );
end;
$$;
revoke all on function public.refresh_internal_intelligence_graph(uuid) from public;
grant execute on function public.refresh_internal_intelligence_graph(uuid) to authenticated;

create or replace function public.get_internal_intelligence_graph(
  p_event_id uuid default null,
  p_include_restricted boolean default false,
  p_limit integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edges jsonb := '[]'::jsonb;
  v_nodes jsonb := '[]'::jsonb;
  v_node_keys text[] := array[]::text[];
  v_edge_count integer := 0;
  v_node_count integer := 0;
  v_limit integer := least(2000, greatest(20, coalesce(p_limit, 900)));
  v_event_scope text := case when p_event_id is null then null else 'event:' || p_event_id::text end;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;
  if p_include_restricted and not public.has_internal_operator_capability('graph_restricted') then
    raise exception 'Restricted graph capability required';
  end if;

  perform public.refresh_internal_intelligence_graph(p_event_id);

  with event_people as (
    select 'person:' || a.alias::text as node_key
    from public.event_participants ep
    join public.internal_graph_subject_aliases a on a.user_id = ep.user_id
    where p_event_id is not null and ep.event_id = p_event_id
  ), eligible as (
    select e.*
    from public.internal_graph_edge_memory e
    where e.expires_at > now()
      and (p_include_restricted or e.sensitivity = 'standard')
      and (
        p_event_id is null
        or e.scope_key = v_event_scope
        or (
          exists (select 1 from event_people p where p.node_key = e.source_key)
          and (
            e.target_key not like 'person:%'
            or exists (select 1 from event_people p where p.node_key = e.target_key)
          )
        )
        or (
          exists (select 1 from event_people p where p.node_key = e.target_key)
          and e.source_key not like 'person:%'
        )
      )
    order by e.strength desc, e.last_seen_at desc, e.relation, e.source_key, e.target_key
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', encode(digest(scope_key || '|' || source_key || '|' || relation || '|' || target_key || '|' || sensitivity::text, 'sha256'), 'hex'),
      'scopeKey', scope_key,
      'source', source_key,
      'target', target_key,
      'relation', relation,
      'directed', directed,
      'confidence', confidence,
      'sensitivity', sensitivity,
      'strength', strength,
      'firstSeenAt', first_seen_at,
      'lastSeenAt', last_seen_at,
      'evidenceCount', evidence_count,
      'evidence', latest_evidence
    )), '[]'::jsonb),
    coalesce(array_agg(distinct source_key) || array_agg(distinct target_key), array[]::text[]),
    count(*)::integer
  into v_edges, v_node_keys, v_edge_count
  from eligible;

  select coalesce(jsonb_agg(node_payload order by node_payload->>'kind', node_payload->>'label'), '[]'::jsonb),
         count(*)::integer
  into v_nodes, v_node_count
  from (
    select jsonb_build_object(
      'id', n.node_key,
      'kind', n.kind,
      'label', case
        when n.kind = 'person' then coalesce(nullif(trim(u.name), ''), 'Anonymous')
        else coalesce(nullif(n.attributes->>'label', ''), n.kind)
      end,
      'sensitivity', n.sensitivity,
      'firstSeenAt', n.first_seen_at,
      'lastSeenAt', n.last_seen_at,
      'attributes', case
        when n.kind = 'person' then jsonb_build_object(
          'subjectUserId', u.id,
          'role', u.role,
          'isPremium', coalesce(u.is_premium, false)
        )
        else n.attributes
      end
    ) as node_payload
    from public.internal_graph_node_memory n
    left join public.internal_graph_subject_aliases a
      on n.node_key = 'person:' || a.alias::text
    left join public.users u on u.id = a.user_id
    where n.node_key = any(v_node_keys)
      and n.expires_at > now()
      and (p_include_restricted or n.sensitivity = 'standard')
  ) nodes;

  insert into public.internal_graph_audit_log (actor_id, action, event_id, metadata)
  values (
    auth.uid(),
    'graph_read',
    p_event_id,
    jsonb_build_object(
      'restricted', p_include_restricted,
      'nodeCount', v_node_count,
      'edgeCount', v_edge_count,
      'limit', v_limit
    )
  );

  return jsonb_build_object(
    'generatedAt', now(),
    'eventId', p_event_id,
    'graphVersion', 'beacon-internal-graph-v1',
    'nodeCount', v_node_count,
    'edgeCount', v_edge_count,
    'nodes', v_nodes,
    'edges', v_edges
  );
end;
$$;
revoke all on function public.get_internal_intelligence_graph(uuid, boolean, integer) from public;
grant execute on function public.get_internal_intelligence_graph(uuid, boolean, integer) to authenticated;

create or replace function public.prune_internal_graph_memory()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assertions integer;
  v_edges integer;
  v_nodes integer;
  v_audit integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  delete from public.internal_graph_assertions where expires_at <= now();
  get diagnostics v_assertions = row_count;

  delete from public.internal_graph_edge_memory where expires_at <= now();
  get diagnostics v_edges = row_count;

  delete from public.internal_graph_node_memory n
  where n.expires_at <= now()
     or not exists (
       select 1 from public.internal_graph_edge_memory e
       where e.source_key = n.node_key or e.target_key = n.node_key
     );
  get diagnostics v_nodes = row_count;

  delete from public.internal_graph_audit_log
  where created_at < now() - interval '365 days';
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'assertionsDeleted', v_assertions,
    'edgesDeleted', v_edges,
    'nodesDeleted', v_nodes,
    'auditRowsDeleted', v_audit,
    'prunedAt', now()
  );
end;
$$;
revoke all on function public.prune_internal_graph_memory() from public;
grant execute on function public.prune_internal_graph_memory() to service_role;

comment on function public.get_internal_intelligence_graph(uuid, boolean, integer) is
  'Operator-only evidence graph. Standard edges are first-party/authorized context; restricted safety edges require an additional capability.';
