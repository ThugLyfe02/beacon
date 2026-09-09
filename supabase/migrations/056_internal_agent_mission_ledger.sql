-- =============================================================================
-- 056_internal_agent_mission_ledger.sql
-- Persistent, bounded memory for Constellation's analysis-only agent missions.
--
-- This ledger remembers strategic conditions, not social actions. It cannot send
-- messages, create introductions, bypass blocks, or manufacture graph evidence.
-- Objective text is not retained; only a SHA-256 digest scopes mission memory.
-- =============================================================================

create table if not exists public.internal_graph_agent_missions (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  objective_digest text not null,
  event_id uuid references public.events(id) on delete set null,
  mission_key text not null,
  graph_version text not null,
  agent text not null check (agent in ('Cartographer', 'Broker Scout', 'Historian', 'Pathfinder', 'Sentinel')),
  title text not null check (char_length(title) between 1 and 220),
  thesis text not null check (char_length(thesis) between 1 and 800),
  priority numeric(10,4) not null check (priority >= 0 and priority <= 1000),
  evidence text[] not null default '{}'::text[],
  node_keys text[] not null default '{}'::text[],
  recommended_action text not null check (char_length(recommended_action) between 1 and 700),
  autonomy text not null default 'analysis_only' check (autonomy = 'analysis_only'),
  requires_human_approval boolean not null default true check (requires_human_approval),
  evidence_fingerprint text not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'dismissed', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check (seen_count >= 1),
  revision_count integer not null default 0 check (revision_count >= 0),
  reopened_count integer not null default 0 check (reopened_count >= 0),
  miss_count integer not null default 0 check (miss_count >= 0),
  resolved_at timestamptz,
  last_actor_id uuid references public.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '180 days'),
  unique (scope_key, mission_key),
  check (char_length(scope_key) between 20 and 180),
  check (char_length(objective_digest) = 64),
  check (char_length(mission_key) between 1 and 260),
  check (char_length(graph_version) between 1 and 180),
  check (cardinality(evidence) <= 16),
  check (cardinality(node_keys) <= 24)
);

create index if not exists internal_agent_mission_event_seen_idx
  on public.internal_graph_agent_missions (event_id, last_seen_at desc);
create index if not exists internal_agent_mission_status_seen_idx
  on public.internal_graph_agent_missions (status, last_seen_at desc);
create index if not exists internal_agent_mission_agent_seen_idx
  on public.internal_graph_agent_missions (agent, last_seen_at desc);

alter table public.internal_graph_agent_missions enable row level security;
revoke all on table public.internal_graph_agent_missions from anon, authenticated;

create or replace function public.sync_internal_agent_missions(
  p_event_id uuid,
  p_objective text,
  p_graph_version text,
  p_missions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_graph jsonb;
  v_scope_key text;
  v_objective_digest text;
  v_mission jsonb;
  v_mission_key text;
  v_agent text;
  v_title text;
  v_thesis text;
  v_recommended_action text;
  v_priority numeric;
  v_evidence text[];
  v_node_keys text[];
  v_node_key text;
  v_fingerprint text;
  v_existing_status text;
  v_existing_fingerprint text;
  v_present_keys text[] := '{}'::text[];
  v_created integer := 0;
  v_reopened integer := 0;
  v_revised integer := 0;
  v_resolved integer := 0;
  v_active integer := 0;
  v_total integer := 0;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_missions is null or jsonb_typeof(p_missions) <> 'array' then
    raise exception 'Mission sync requires a JSON array';
  end if;
  if jsonb_array_length(p_missions) > 50 then
    raise exception 'Mission sync exceeds the 50-mission bound';
  end if;
  if nullif(trim(p_graph_version), '') is null or char_length(trim(p_graph_version)) > 180 then
    raise exception 'Invalid graph version';
  end if;
  if p_objective is not null and char_length(trim(p_objective)) > 240 then
    raise exception 'Objective exceeds the 240-character analysis bound';
  end if;

  -- Re-derive the graph server-side so a modified client cannot persist missions
  -- that point at entities outside its current evidence scope.
  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_objective_digest := encode(digest(lower(trim(coalesce(p_objective, ''))), 'sha256'), 'hex');
  v_scope_key := coalesce(p_event_id::text, 'global') || '|objective:' || v_objective_digest;

  for v_mission in select value from jsonb_array_elements(p_missions)
  loop
    if jsonb_typeof(v_mission) <> 'object' then
      raise exception 'Each mission must be an object';
    end if;

    v_mission_key := nullif(trim(v_mission->>'id'), '');
    v_agent := nullif(trim(v_mission->>'agent'), '');
    v_title := nullif(trim(v_mission->>'title'), '');
    v_thesis := nullif(trim(v_mission->>'thesis'), '');
    v_recommended_action := nullif(trim(v_mission->>'recommendedAction'), '');

    if v_mission_key is null or char_length(v_mission_key) > 260 then
      raise exception 'Invalid mission id';
    end if;
    if v_agent not in ('Cartographer', 'Broker Scout', 'Historian', 'Pathfinder', 'Sentinel') then
      raise exception 'Unsupported analysis agent';
    end if;
    if v_title is null or char_length(v_title) > 220 then raise exception 'Invalid mission title'; end if;
    if v_thesis is null or char_length(v_thesis) > 800 then raise exception 'Invalid mission thesis'; end if;
    if v_recommended_action is null or char_length(v_recommended_action) > 700 then
      raise exception 'Invalid mission recommendation';
    end if;
    if coalesce(v_mission->>'autonomy', '') <> 'analysis_only'
       or coalesce((v_mission->>'requiresHumanApproval')::boolean, false) is not true then
      raise exception 'Mission violates the analysis-only / human-approval contract';
    end if;
    if coalesce(v_mission->>'priority', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Invalid mission priority';
    end if;
    v_priority := (v_mission->>'priority')::numeric;
    if v_priority < 0 or v_priority > 1000 then raise exception 'Mission priority outside allowed range'; end if;

    if v_mission ? 'evidence' and jsonb_typeof(v_mission->'evidence') <> 'array' then
      raise exception 'Mission evidence must be an array';
    end if;
    if v_mission ? 'nodeIds' and jsonb_typeof(v_mission->'nodeIds') <> 'array' then
      raise exception 'Mission nodeIds must be an array';
    end if;

    select coalesce(array_agg(value #>> '{}'), '{}'::text[])
    into v_evidence
    from jsonb_array_elements(coalesce(v_mission->'evidence', '[]'::jsonb));

    select coalesce(array_agg(value #>> '{}'), '{}'::text[])
    into v_node_keys
    from jsonb_array_elements(coalesce(v_mission->'nodeIds', '[]'::jsonb));

    if cardinality(v_evidence) > 16 or exists (
      select 1 from unnest(v_evidence) item
      where item is null or char_length(item) > 320
    ) then raise exception 'Mission evidence exceeds bounded text limits'; end if;

    if cardinality(v_node_keys) > 24 or exists (
      select 1 from unnest(v_node_keys) item
      where item is null or char_length(item) > 220
    ) then raise exception 'Mission node references exceed bounded limits'; end if;

    foreach v_node_key in array v_node_keys
    loop
      if not exists (
        select 1
        from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
        where node->>'id' = v_node_key
      ) then
        raise exception 'Mission references node outside current server graph';
      end if;
    end loop;

    v_fingerprint := encode(digest(
      concat_ws('|',
        v_agent,
        v_title,
        v_thesis,
        v_priority::text,
        array_to_string(v_evidence, E'\n'),
        array_to_string(v_node_keys, ','),
        v_recommended_action
      ),
      'sha256'
    ), 'hex');

    select status, evidence_fingerprint
    into v_existing_status, v_existing_fingerprint
    from public.internal_graph_agent_missions
    where scope_key = v_scope_key and mission_key = v_mission_key;

    if not found then
      v_created := v_created + 1;
    elsif v_existing_status = 'resolved'
       or (v_existing_status = 'dismissed' and v_existing_fingerprint <> v_fingerprint) then
      v_reopened := v_reopened + 1;
    end if;
    if found and v_existing_fingerprint <> v_fingerprint then v_revised := v_revised + 1; end if;

    insert into public.internal_graph_agent_missions (
      scope_key, objective_digest, event_id, mission_key, graph_version, agent,
      title, thesis, priority, evidence, node_keys, recommended_action,
      autonomy, requires_human_approval, evidence_fingerprint, last_actor_id,
      expires_at
    ) values (
      v_scope_key, v_objective_digest, p_event_id, v_mission_key, trim(p_graph_version), v_agent,
      v_title, v_thesis, v_priority, v_evidence, v_node_keys, v_recommended_action,
      'analysis_only', true, v_fingerprint, auth.uid(), now() + interval '180 days'
    )
    on conflict (scope_key, mission_key) do update set
      graph_version = excluded.graph_version,
      agent = excluded.agent,
      title = excluded.title,
      thesis = excluded.thesis,
      priority = excluded.priority,
      evidence = excluded.evidence,
      node_keys = excluded.node_keys,
      recommended_action = excluded.recommended_action,
      evidence_fingerprint = excluded.evidence_fingerprint,
      status = case
        when internal_graph_agent_missions.status = 'resolved' then 'open'
        when internal_graph_agent_missions.status = 'dismissed'
             and internal_graph_agent_missions.evidence_fingerprint <> excluded.evidence_fingerprint then 'open'
        else internal_graph_agent_missions.status
      end,
      last_seen_at = now(),
      seen_count = internal_graph_agent_missions.seen_count + 1,
      revision_count = internal_graph_agent_missions.revision_count
        + case when internal_graph_agent_missions.evidence_fingerprint <> excluded.evidence_fingerprint then 1 else 0 end,
      reopened_count = internal_graph_agent_missions.reopened_count
        + case
            when internal_graph_agent_missions.status = 'resolved' then 1
            when internal_graph_agent_missions.status = 'dismissed'
                 and internal_graph_agent_missions.evidence_fingerprint <> excluded.evidence_fingerprint then 1
            else 0
          end,
      miss_count = 0,
      resolved_at = case
        when internal_graph_agent_missions.status = 'resolved'
          or (internal_graph_agent_missions.status = 'dismissed'
              and internal_graph_agent_missions.evidence_fingerprint <> excluded.evidence_fingerprint)
          then null
        else internal_graph_agent_missions.resolved_at
      end,
      last_actor_id = auth.uid(),
      expires_at = greatest(internal_graph_agent_missions.expires_at, excluded.expires_at);

    v_present_keys := array_append(v_present_keys, v_mission_key);
  end loop;

  -- A mission is considered structurally absent only after two consecutive syncs.
  -- This dampens temporary graph churn and target-query transitions.
  update public.internal_graph_agent_missions
  set
    miss_count = miss_count + 1,
    status = case
      when miss_count + 1 >= 2 and status in ('open', 'acknowledged') then 'resolved'
      else status
    end,
    resolved_at = case
      when miss_count + 1 >= 2 and status in ('open', 'acknowledged') then now()
      else resolved_at
    end,
    last_actor_id = auth.uid()
  where scope_key = v_scope_key
    and not (mission_key = any(v_present_keys))
    and status in ('open', 'acknowledged');
  get diagnostics v_resolved = row_count;

  select
    count(*) filter (where status in ('open', 'acknowledged')),
    count(*)
  into v_active, v_total
  from public.internal_graph_agent_missions
  where scope_key = v_scope_key and expires_at > now();

  if v_created + v_reopened + v_revised + v_resolved > 0 then
    insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
    values (
      auth.uid(),
      'agent_mission_sync',
      p_event_id,
      jsonb_build_object(
        'created', v_created,
        'reopened', v_reopened,
        'revised', v_revised,
        'resolvedCandidates', v_resolved,
        'active', v_active,
        'objectiveDigest', v_objective_digest
      )
    );
  end if;

  return jsonb_build_object(
    'syncedAt', now(),
    'objectiveDigest', v_objective_digest,
    'createdCount', v_created,
    'reopenedCount', v_reopened,
    'revisedCount', v_revised,
    'resolvedCandidateCount', v_resolved,
    'activeCount', v_active,
    'totalCount', v_total
  );
end;
$$;
revoke all on function public.sync_internal_agent_missions(uuid, text, text, jsonb) from public;
grant execute on function public.sync_internal_agent_missions(uuid, text, text, jsonb) to authenticated;

create or replace function public.get_internal_agent_mission_ledger(
  p_event_id uuid default null,
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(250, greatest(1, coalesce(p_limit, 120)));
  v_missions jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  select coalesce(jsonb_agg(payload order by priority desc, last_seen_at desc, mission_key), '[]'::jsonb)
  into v_missions
  from (
    select
      m.priority,
      m.last_seen_at,
      m.mission_key,
      jsonb_build_object(
        'id', m.id,
        'eventId', m.event_id,
        'missionKey', m.mission_key,
        'agent', m.agent,
        'title', m.title,
        'thesis', m.thesis,
        'priority', m.priority,
        'evidence', to_jsonb(m.evidence),
        'nodeKeys', to_jsonb(m.node_keys),
        'recommendedAction', m.recommended_action,
        'status', m.status,
        'firstSeenAt', m.first_seen_at,
        'lastSeenAt', m.last_seen_at,
        'seenCount', m.seen_count,
        'revisionCount', m.revision_count,
        'reopenedCount', m.reopened_count,
        'missCount', m.miss_count,
        'resolvedAt', m.resolved_at,
        'objectiveDigest', m.objective_digest
      ) as payload
    from public.internal_graph_agent_missions m
    where m.expires_at > now()
      and (p_event_id is null or m.event_id = p_event_id)
    order by m.priority desc, m.last_seen_at desc, m.mission_key
    limit v_limit
  ) ranked;

  return jsonb_build_object('generatedAt', now(), 'missions', v_missions);
end;
$$;
revoke all on function public.get_internal_agent_mission_ledger(uuid, integer) from public;
grant execute on function public.get_internal_agent_mission_ledger(uuid, integer) to authenticated;

create or replace function public.set_internal_agent_mission_status(
  p_mission_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('open', 'acknowledged', 'dismissed') then
    raise exception 'Unsupported mission disposition';
  end if;

  update public.internal_graph_agent_missions
  set
    status = p_status,
    resolved_at = case when p_status = 'open' then null else resolved_at end,
    miss_count = case when p_status = 'open' then 0 else miss_count end,
    last_actor_id = auth.uid()
  where id = p_mission_id and expires_at > now();

  if not found then raise exception 'Mission not found or expired'; end if;

  insert into public.internal_graph_audit_log(actor_id, action, metadata)
  values (auth.uid(), 'agent_mission_status', jsonb_build_object('missionId', p_mission_id, 'status', p_status));
  return true;
end;
$$;
revoke all on function public.set_internal_agent_mission_status(uuid, text) from public;
grant execute on function public.set_internal_agent_mission_status(uuid, text) to authenticated;

create or replace function public.prune_internal_agent_missions(p_retention_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := least(365, greatest(30, coalesce(p_retention_days, 180)));
  v_deleted integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_agent_missions
  where expires_at <= now() or last_seen_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_internal_agent_missions(integer) from public;
grant execute on function public.prune_internal_agent_missions(integer) to service_role;

-- Account erasure must also remove mission text that could mention the erased
-- person. The existing alias-delete trigger automatically picks up this replacement.
create or replace function public.purge_internal_graph_subject_on_alias_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'person:' || old.alias::text;
begin
  delete from public.internal_graph_agent_missions where v_key = any(node_keys);
  delete from public.internal_graph_edge_memory where source_key = v_key or target_key = v_key;
  delete from public.internal_graph_node_memory where node_key = v_key;
  return old;
end;
$$;

comment on table public.internal_graph_agent_missions is
  'Bounded operator-only memory of analysis missions. Missions are structural observations, never autonomous social actions; objective text is not retained.';
