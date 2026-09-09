-- =============================================================================
-- 060_internal_graph_canonical_version.sql
-- Makes approved non-person canonicalization part of graph-version truth.
-- =============================================================================

create or replace function public.internal_graph_entity_alias_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(digest(coalesce(string_agg(
    alias_node_key || '->' || canonical_node_key || ':' || entity_kind || ':' || confidence::text,
    '|' order by alias_node_key, canonical_node_key
  ), ''), 'sha256'), 'hex')
  from public.internal_graph_entity_aliases
  where expires_at > now();
$$;
revoke all on function public.internal_graph_entity_alias_version() from public;

create or replace function public.get_internal_graph_entity_aliases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_version text;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph read capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', alias.id,
    'aliasNodeId', alias.alias_node_key,
    'canonicalNodeId', alias.canonical_node_key,
    'kind', alias.entity_kind,
    'confidence', alias.confidence,
    'reason', alias.reason,
    'updatedAt', alias.updated_at,
    'expiresAt', alias.expires_at
  ) order by alias.updated_at desc), '[]'::jsonb)
  into v_rows
  from public.internal_graph_entity_aliases alias
  where alias.expires_at > now();

  v_version := public.internal_graph_entity_alias_version();

  return jsonb_build_object(
    'generatedAt', now(),
    'canonicalizationVersion', v_version,
    'aliases', v_rows
  );
end;
$$;
revoke all on function public.get_internal_graph_entity_aliases() from public;
grant execute on function public.get_internal_graph_entity_aliases() to authenticated;

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
  v_raw_graph_version text;
  v_expected_graph_version text;
  v_canonicalization_version text;
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
  v_raw_graph_version := coalesce(v_graph->>'graphVersion', '');
  v_canonicalization_version := public.internal_graph_entity_alias_version();

  if exists (
    select 1 from public.internal_graph_entity_aliases where expires_at > now()
  ) then
    v_expected_graph_version := v_raw_graph_version || ':canon:' || left(v_canonicalization_version, 12);
  else
    v_expected_graph_version := v_raw_graph_version;
  end if;

  if p_graph_version <> v_expected_graph_version then
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
      'canonicalizationVersion', case
        when v_expected_graph_version = v_raw_graph_version then null
        else left(v_canonicalization_version, 12)
      end,
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

comment on function public.internal_graph_entity_alias_version() is
  'SHA-256 version of the active approved non-person canonicalization map. Used to bind graph analysis/manifests to canonical topology.';
