-- =============================================================================
-- 061_internal_graph_canonical_persistence.sql
-- Canonicalization must participate in durable graph truth, not only UI analysis.
--
-- 1. Epoch metadata is derived from the post-alias topology server-side.
-- 2. Casebook non-person pins are normalized to an approved canonical entity.
-- 3. Machine manifest version validation only appends the alias-map version when
--    at least one approved mapping actually applies to the selected graph scope.
-- =============================================================================

alter table public.internal_graph_epochs
  drop constraint if exists internal_graph_epochs_graph_version_check;
alter table public.internal_graph_epochs
  add constraint internal_graph_epochs_graph_version_check
  check (char_length(graph_version) between 1 and 160);

alter table public.internal_graph_epochs
  add column if not exists canonicalization_version text;

create or replace function public.internal_graph_canonical_summary(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_graph jsonb;
  v_alias_version text;
  v_applicable_count integer := 0;
  v_node_count integer := 0;
  v_edge_count integer := 0;
  v_node_digest_input text := '';
  v_edge_digest_input text := '';
  v_graph_version text;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_alias_version := public.internal_graph_entity_alias_version();

  with graph_nodes as (
    select
      node->>'id' as node_id,
      node->>'kind' as kind
    from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
  ), applicable as (
    select alias.alias_node_key, alias.canonical_node_key, alias.entity_kind
    from public.internal_graph_entity_aliases alias
    join graph_nodes source_node on source_node.node_id = alias.alias_node_key
    join graph_nodes canonical_node on canonical_node.node_id = alias.canonical_node_key
    where alias.expires_at > now()
      and source_node.kind <> 'person'
      and canonical_node.kind <> 'person'
      and source_node.kind = canonical_node.kind
      and source_node.kind = alias.entity_kind
  )
  select count(*)::integer into v_applicable_count from applicable;

  with graph_nodes as (
    select node->>'id' as node_id
    from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
  ), applicable as (
    select alias.alias_node_key, alias.canonical_node_key
    from public.internal_graph_entity_aliases alias
    join jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) source_node
      on source_node->>'id' = alias.alias_node_key
    join jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) canonical_node
      on canonical_node->>'id' = alias.canonical_node_key
    where alias.expires_at > now()
      and source_node->>'kind' <> 'person'
      and canonical_node->>'kind' <> 'person'
      and source_node->>'kind' = canonical_node->>'kind'
      and source_node->>'kind' = alias.entity_kind
  ), canonical_nodes as (
    select distinct coalesce(applicable.canonical_node_key, graph_nodes.node_id) as node_id
    from graph_nodes
    left join applicable on applicable.alias_node_key = graph_nodes.node_id
  )
  select
    count(*)::integer,
    coalesce(string_agg(node_id, '|' order by node_id), '')
  into v_node_count, v_node_digest_input
  from canonical_nodes;

  with graph_nodes as (
    select node->>'id' as node_id, node->>'kind' as kind
    from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
  ), applicable as (
    select alias.alias_node_key, alias.canonical_node_key
    from public.internal_graph_entity_aliases alias
    join graph_nodes source_node on source_node.node_id = alias.alias_node_key
    join graph_nodes canonical_node on canonical_node.node_id = alias.canonical_node_key
    where alias.expires_at > now()
      and source_node.kind <> 'person'
      and canonical_node.kind <> 'person'
      and source_node.kind = canonical_node.kind
      and source_node.kind = alias.entity_kind
  ), mapped_edges as (
    select
      edge->>'scopeKey' as scope_key,
      coalesce(source_alias.canonical_node_key, edge->>'source') as mapped_source,
      coalesce(target_alias.canonical_node_key, edge->>'target') as mapped_target,
      edge->>'relation' as relation,
      coalesce((edge->>'directed')::boolean, false) as directed,
      edge->>'sensitivity' as sensitivity
    from jsonb_array_elements(coalesce(v_graph->'edges', '[]'::jsonb)) edge
    left join applicable source_alias on source_alias.alias_node_key = edge->>'source'
    left join applicable target_alias on target_alias.alias_node_key = edge->>'target'
  ), normalized_edges as (
    select distinct
      scope_key,
      case when not directed and mapped_source > mapped_target then mapped_target else mapped_source end as source_key,
      case when not directed and mapped_source > mapped_target then mapped_source else mapped_target end as target_key,
      relation,
      directed,
      sensitivity
    from mapped_edges
    where mapped_source <> mapped_target
  ), edge_keys as (
    select
      scope_key || '|' || source_key || '|' || relation || '|' || target_key || '|'
      || case when directed then 'd' else 'u' end || '|' || coalesce(sensitivity, 'standard') as edge_key
    from normalized_edges
  )
  select
    count(*)::integer,
    coalesce(string_agg(edge_key, E'\n' order by edge_key), '')
  into v_edge_count, v_edge_digest_input
  from edge_keys;

  v_graph_version := coalesce(nullif(v_graph->>'graphVersion', ''), 'unknown');
  if v_applicable_count > 0 then
    v_graph_version := v_graph_version || ':canon:' || left(v_alias_version, 12);
  end if;

  return jsonb_build_object(
    'eventId', p_event_id,
    'graphVersion', v_graph_version,
    'canonicalizationVersion', case when v_applicable_count > 0 then v_alias_version else null end,
    'applicableAliasCount', v_applicable_count,
    'nodeCount', v_node_count,
    'edgeCount', v_edge_count,
    'topologyDigest', encode(digest(v_node_digest_input || E'\n--EDGES--\n' || v_edge_digest_input, 'sha256'), 'hex'),
    'rawNodeCount', coalesce((v_graph->>'nodeCount')::integer, 0),
    'rawEdgeCount', coalesce((v_graph->>'edgeCount')::integer, 0)
  );
end;
$$;
revoke all on function public.internal_graph_canonical_summary(uuid) from public;

-- Normalize existing Casebook entity pins whenever a non-person alias is
-- approved or revised. If a case already pins the canonical entity, retain that
-- row and backfill its note from the alias pin only when the canonical note is
-- empty. Person pins are stored separately by erasable subject_alias and never
-- pass through this trigger.
create or replace function public.rekey_internal_casebook_pins_for_entity_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  select left(coalesce(nullif(node.attributes->>'label', ''), node.kind), 160)
  into v_label
  from public.internal_graph_node_memory node
  where node.node_key = new.canonical_node_key;

  update public.internal_graph_case_pins canonical_pin
  set
    note = coalesce(canonical_pin.note, alias_pin.note),
    label_snapshot = coalesce(v_label, canonical_pin.label_snapshot),
    kind_snapshot = new.entity_kind
  from public.internal_graph_case_pins alias_pin
  where alias_pin.case_id = canonical_pin.case_id
    and alias_pin.entity_node_key = new.alias_node_key
    and canonical_pin.entity_node_key = new.canonical_node_key;

  delete from public.internal_graph_case_pins alias_pin
  where alias_pin.entity_node_key = new.alias_node_key
    and exists (
      select 1 from public.internal_graph_case_pins canonical_pin
      where canonical_pin.case_id = alias_pin.case_id
        and canonical_pin.entity_node_key = new.canonical_node_key
    );

  update public.internal_graph_case_pins
  set
    entity_node_key = new.canonical_node_key,
    label_snapshot = coalesce(v_label, label_snapshot),
    kind_snapshot = new.entity_kind
  where entity_node_key = new.alias_node_key;

  return new;
end;
$$;
revoke all on function public.rekey_internal_casebook_pins_for_entity_alias() from public;

drop trigger if exists internal_graph_entity_alias_rekey_casebook
  on public.internal_graph_entity_aliases;
create trigger internal_graph_entity_alias_rekey_casebook
after insert or update of canonical_node_key on public.internal_graph_entity_aliases
for each row execute function public.rekey_internal_casebook_pins_for_entity_alias();

-- Replace Epoch recording so durable metadata describes the same canonical graph
-- the operator analyzed. Submitted memberships are still validated against the
-- raw server graph; canonical node ids are necessarily retained raw nodes because
-- aliases collapse into an existing canonical target.
create or replace function public.record_internal_graph_epoch(
  p_event_id uuid,
  p_analysis jsonb,
  p_motifs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_graph jsonb;
  v_summary jsonb;
  v_epoch_id uuid;
  v_community jsonb;
  v_broker jsonb;
  v_motif jsonb;
  v_node_id text;
  v_alias uuid;
  v_person_count integer;
  v_rank integer := 0;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'Unknown event'; end if;
  if v_event.finalized_at is null then
    raise exception 'Durable graph epochs require a finalized event';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' then
    raise exception 'Analysis payload must be an object';
  end if;
  if jsonb_typeof(coalesce(p_analysis->'communities', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_analysis->'brokers', '[]'::jsonb)) <> 'array' then
    raise exception 'Analysis communities and brokers must be arrays';
  end if;
  if jsonb_typeof(coalesce(p_motifs, '[]'::jsonb)) <> 'array' then
    raise exception 'Motifs must be an array';
  end if;

  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_summary := public.internal_graph_canonical_summary(p_event_id);

  insert into public.internal_graph_epochs (
    event_id,
    graph_version,
    canonicalization_version,
    topology_digest,
    node_count,
    edge_count,
    community_count,
    articulation_count,
    critical_bridge_count,
    structural_dependence,
    summary,
    captured_by,
    expires_at
  ) values (
    p_event_id,
    v_summary->>'graphVersion',
    v_summary->>'canonicalizationVersion',
    v_summary->>'topologyDigest',
    coalesce((v_summary->>'nodeCount')::integer, 0),
    coalesce((v_summary->>'edgeCount')::integer, 0),
    jsonb_array_length(coalesce(p_analysis->'communities', '[]'::jsonb)),
    greatest(0, coalesce((p_analysis->>'articulationCount')::integer, 0)),
    greatest(0, coalesce((p_analysis->>'criticalBridgeCount')::integer, 0)),
    least(1::numeric, greatest(0::numeric, coalesce((p_analysis->>'structuralDependence')::numeric, 0))),
    jsonb_build_object(
      'analysisVersion', coalesce(p_analysis->>'analysisVersion', 'forensics-v1'),
      'capturedFrom', 'server-validated-canonical-event-graph',
      'applicableAliasCount', coalesce((v_summary->>'applicableAliasCount')::integer, 0),
      'rawNodeCount', coalesce((v_summary->>'rawNodeCount')::integer, 0),
      'rawEdgeCount', coalesce((v_summary->>'rawEdgeCount')::integer, 0)
    ),
    auth.uid(),
    now() + interval '730 days'
  )
  on conflict (event_id, topology_digest) do update
    set captured_at = now(),
        graph_version = excluded.graph_version,
        canonicalization_version = excluded.canonicalization_version,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count,
        expires_at = greatest(public.internal_graph_epochs.expires_at, excluded.expires_at),
        community_count = excluded.community_count,
        articulation_count = excluded.articulation_count,
        critical_bridge_count = excluded.critical_bridge_count,
        structural_dependence = excluded.structural_dependence,
        summary = excluded.summary,
        captured_by = auth.uid()
  returning id into v_epoch_id;

  delete from public.internal_graph_epoch_motifs where epoch_id = v_epoch_id;
  delete from public.internal_graph_epoch_brokers where epoch_id = v_epoch_id;
  delete from public.internal_graph_epoch_communities where epoch_id = v_epoch_id;

  for v_community in select value from jsonb_array_elements(p_analysis->'communities')
  loop
    if jsonb_typeof(coalesce(v_community->'nodeIds', '[]'::jsonb)) <> 'array' then
      raise exception 'Community nodeIds must be an array';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_community->'nodeIds') submitted(node_id)
      where not exists (
        select 1 from jsonb_array_elements(v_graph->'nodes') graph_node
        where graph_node->>'id' = submitted.node_id
      )
    ) then
      raise exception 'Community contains node outside the current event graph';
    end if;

    select count(*)::integer into v_person_count
    from jsonb_array_elements_text(v_community->'nodeIds') submitted(node_id)
    where submitted.node_id like 'person:%';

    insert into public.internal_graph_epoch_communities (
      epoch_id, local_community_id, label, total_size, person_count, cohesion
    ) values (
      v_epoch_id,
      coalesce((v_community->>'id')::integer, 0),
      left(coalesce(nullif(v_community->>'label', ''), 'Community'), 160),
      jsonb_array_length(v_community->'nodeIds'),
      v_person_count,
      least(1::numeric, greatest(0::numeric, coalesce((v_community->>'cohesion')::numeric, 0)))
    );

    for v_node_id in select value from jsonb_array_elements_text(v_community->'nodeIds')
    loop
      if v_node_id like 'person:%' then
        begin
          v_alias := substring(v_node_id from 8)::uuid;
        exception when invalid_text_representation then
          raise exception 'Malformed person graph alias';
        end;
        if not exists (select 1 from public.internal_graph_subject_aliases a where a.alias = v_alias) then
          raise exception 'Unknown person graph alias';
        end if;
        insert into public.internal_graph_epoch_members(epoch_id, local_community_id, subject_alias)
        values (v_epoch_id, coalesce((v_community->>'id')::integer, 0), v_alias)
        on conflict do nothing;
      end if;
    end loop;
  end loop;

  v_rank := 0;
  for v_broker in select value from jsonb_array_elements(p_analysis->'brokers')
  loop
    v_node_id := v_broker->>'nodeId';
    if v_node_id is null or v_node_id not like 'person:%' then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_graph->'nodes') graph_node
      where graph_node->>'id' = v_node_id
    ) then
      raise exception 'Broker outside the current event graph';
    end if;
    begin
      v_alias := substring(v_node_id from 8)::uuid;
    exception when invalid_text_representation then
      raise exception 'Malformed broker alias';
    end;
    if not exists (select 1 from public.internal_graph_subject_aliases a where a.alias = v_alias) then
      raise exception 'Unknown broker alias';
    end if;
    v_rank := v_rank + 1;
    if v_rank > 100 then exit; end if;
    insert into public.internal_graph_epoch_brokers (
      epoch_id, subject_alias, rank, forensic_score, broker_score,
      participation_coefficient, effective_size, redundancy_ratio,
      articulation, cross_community_count
    ) values (
      v_epoch_id,
      v_alias,
      v_rank,
      coalesce((v_broker->>'forensicScore')::numeric, 0),
      coalesce((v_broker->>'brokerScore')::numeric, 0),
      least(1::numeric, greatest(0::numeric, coalesce((v_broker->>'participationCoefficient')::numeric, 0))),
      greatest(0::numeric, coalesce((v_broker->>'effectiveSize')::numeric, 0)),
      least(1::numeric, greatest(0::numeric, coalesce((v_broker->>'redundancyRatio')::numeric, 0))),
      coalesce((v_broker->>'articulation')::boolean, false),
      greatest(0, coalesce((v_broker->>'crossCommunityCount')::integer, 0))
    ) on conflict (epoch_id, subject_alias) do update set
      rank = excluded.rank,
      forensic_score = excluded.forensic_score,
      broker_score = excluded.broker_score,
      participation_coefficient = excluded.participation_coefficient,
      effective_size = excluded.effective_size,
      redundancy_ratio = excluded.redundancy_ratio,
      articulation = excluded.articulation,
      cross_community_count = excluded.cross_community_count;
  end loop;

  for v_motif in select value from jsonb_array_elements(coalesce(p_motifs, '[]'::jsonb))
  loop
    if nullif(v_motif->>'key', '') is null then continue; end if;
    insert into public.internal_graph_epoch_motifs (
      epoch_id, motif_key, observed_count, strength, metadata
    ) values (
      v_epoch_id,
      left(v_motif->>'key', 80),
      greatest(0, coalesce((v_motif->>'count')::integer, 0)),
      greatest(0::numeric, coalesce((v_motif->>'strength')::numeric, 0)),
      jsonb_build_object('class', left(coalesce(v_motif->>'class', 'structural'), 60))
    ) on conflict (epoch_id, motif_key) do update set
      observed_count = excluded.observed_count,
      strength = excluded.strength,
      metadata = excluded.metadata;
  end loop;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_epoch_recorded', p_event_id,
    jsonb_build_object(
      'epochId', v_epoch_id,
      'topologyDigest', v_summary->>'topologyDigest',
      'graphVersion', v_summary->>'graphVersion',
      'canonicalizationVersion', v_summary->>'canonicalizationVersion'
    )
  );

  return v_epoch_id;
end;
$$;
revoke all on function public.record_internal_graph_epoch(uuid, jsonb, jsonb) from public;
grant execute on function public.record_internal_graph_epoch(uuid, jsonb, jsonb) to authenticated;

-- Fix Machine-manifest version validation to match client canonicalization: the
-- global alias-map digest is appended only if a mapping applies to this event's
-- currently authorized raw graph.
create or replace function public.record_internal_graph_machine_run(
  p_recipe_id uuid,
  p_event_id uuid,
  p_graph_version text,
  p_seed_node_id text,
  p_target_query text,
  p_trace_step_count integer,
  p_final_node_count integer,
  p_final_edge_count integer,
  p_question_count integer,
  p_result_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.internal_graph_machine_recipes;
  v_graph jsonb;
  v_summary jsonb;
  v_seed_digest text;
  v_objective_digest text;
  v_result_digest text;
  v_manifest public.internal_graph_machine_run_manifests;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select * into v_recipe
  from public.internal_graph_machine_recipes recipe
  where recipe.id = p_recipe_id
    and recipe.created_by = auth.uid()
    and recipe.enabled
    and recipe.expires_at > now();
  if v_recipe.id is null then raise exception 'Active Machine recipe not found'; end if;

  if coalesce(p_trace_step_count, -1) < 0 or p_trace_step_count > 80
     or coalesce(p_final_node_count, -1) < 0 or p_final_node_count > 5000
     or coalesce(p_final_edge_count, -1) < 0 or p_final_edge_count > 10000
     or coalesce(p_question_count, -1) < 0 or p_question_count > 100 then
    raise exception 'Invalid Machine run summary bounds';
  end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary) <> 'object'
     or pg_column_size(p_result_summary) > 8192 then
    raise exception 'Machine result summary must be a bounded object';
  end if;

  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_summary := public.internal_graph_canonical_summary(p_event_id);
  if p_graph_version <> v_summary->>'graphVersion' then
    raise exception 'Machine run graph version is stale';
  end if;

  if nullif(trim(p_seed_node_id), '') is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
    where node->>'id' = p_seed_node_id
  ) then
    raise exception 'Machine seed is outside the current authorized graph';
  end if;

  v_seed_digest := case
    when nullif(trim(p_seed_node_id), '') is null then null
    else encode(digest(trim(p_seed_node_id), 'sha256'), 'hex')
  end;
  v_objective_digest := case
    when nullif(trim(p_target_query), '') is null then null
    else encode(digest(lower(trim(p_target_query)), 'sha256'), 'hex')
  end;
  v_result_digest := encode(digest(p_result_summary::text, 'sha256'), 'hex');

  insert into public.internal_graph_machine_run_manifests (
    operator_id, recipe_id, event_id, graph_version, definition_hash,
    seed_digest, objective_digest, result_digest, stage_count,
    trace_step_count, final_node_count, final_edge_count, question_count
  ) values (
    auth.uid(), v_recipe.id, p_event_id, p_graph_version, v_recipe.recipe_hash,
    v_seed_digest, v_objective_digest, v_result_digest, cardinality(v_recipe.machine_ids),
    p_trace_step_count, p_final_node_count, p_final_edge_count, p_question_count
  ) returning * into v_manifest;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'machine_run_manifest_recorded', p_event_id,
    jsonb_build_object(
      'manifestId', v_manifest.id,
      'recipeId', v_recipe.id,
      'definitionHash', v_recipe.recipe_hash,
      'canonicalizationVersion', v_summary->>'canonicalizationVersion',
      'resultDigest', v_manifest.result_digest,
      'stageCount', v_manifest.stage_count
    )
  );

  return jsonb_build_object(
    'id', v_manifest.id,
    'recipeId', v_manifest.recipe_id,
    'eventId', v_manifest.event_id,
    'graphVersion', v_manifest.graph_version,
    'definitionHash', v_manifest.definition_hash,
    'seedDigest', v_manifest.seed_digest,
    'objectiveDigest', v_manifest.objective_digest,
    'resultDigest', v_manifest.result_digest,
    'stageCount', v_manifest.stage_count,
    'traceStepCount', v_manifest.trace_step_count,
    'finalNodeCount', v_manifest.final_node_count,
    'finalEdgeCount', v_manifest.final_edge_count,
    'questionCount', v_manifest.question_count,
    'createdAt', v_manifest.created_at,
    'expiresAt', v_manifest.expires_at
  );
end;
$$;
revoke all on function public.record_internal_graph_machine_run(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) from public;
grant execute on function public.record_internal_graph_machine_run(uuid, uuid, text, text, text, integer, integer, integer, integer, jsonb) to authenticated;

comment on function public.internal_graph_canonical_summary(uuid) is
  'Server-derived post-alias graph version/count/digest used by Epoch and Machine reproducibility boundaries.';
