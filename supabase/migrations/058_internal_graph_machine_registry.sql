-- =============================================================================
-- 058_internal_graph_machine_registry.sql
-- Private, operator-only Constellation Machine recipes + bounded run manifests.
--
-- A recipe is intentionally NOT arbitrary code. It is an ordered sequence of
-- already-audited built-in Machine ids. No URLs, scripts, commands, raw targets,
-- person ids, contact fields, or external enrichment endpoints are persisted.
--
-- Run manifests retain graph/version/digest/count metadata only. Seed entities
-- and target-ecosystem text are accepted transiently for server validation and
-- immediately reduced to SHA-256 digests before persistence.
-- =============================================================================

create table if not exists public.internal_graph_machine_recipes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  machine_ids text[] not null,
  recipe_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  check (cardinality(machine_ids) between 1 and 6),
  unique (created_by, recipe_hash)
);

create index if not exists internal_graph_machine_recipes_creator_idx
  on public.internal_graph_machine_recipes (created_by, updated_at desc);

alter table public.internal_graph_machine_recipes enable row level security;
revoke all on table public.internal_graph_machine_recipes from anon, authenticated;

create table if not exists public.internal_graph_machine_run_manifests (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.users(id) on delete cascade,
  recipe_id uuid references public.internal_graph_machine_recipes(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  graph_version text not null check (char_length(graph_version) between 1 and 160),
  definition_hash text not null check (char_length(definition_hash) = 64),
  seed_digest text check (seed_digest is null or char_length(seed_digest) = 64),
  objective_digest text check (objective_digest is null or char_length(objective_digest) = 64),
  result_digest text not null check (char_length(result_digest) = 64),
  stage_count integer not null check (stage_count between 1 and 6),
  trace_step_count integer not null check (trace_step_count between 0 and 80),
  final_node_count integer not null check (final_node_count between 0 and 5000),
  final_edge_count integer not null check (final_edge_count between 0 and 10000),
  question_count integer not null check (question_count between 0 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);

create index if not exists internal_graph_machine_runs_operator_idx
  on public.internal_graph_machine_run_manifests (operator_id, created_at desc);
create index if not exists internal_graph_machine_runs_recipe_idx
  on public.internal_graph_machine_run_manifests (recipe_id, created_at desc);

alter table public.internal_graph_machine_run_manifests enable row level security;
revoke all on table public.internal_graph_machine_run_manifests from anon, authenticated;

create or replace function public.internal_graph_machine_ids_are_safe(p_machine_ids text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_machine_ids is not null
     and cardinality(p_machine_ids) between 1 and 6
     and not exists (
       select 1
       from unnest(p_machine_ids) machine_id
       where machine_id not in (
         'broker-xray',
         'ecosystem-entry',
         'bridge-emergence',
         'community-drift',
         'outcome-ladder'
       )
     );
$$;
revoke all on function public.internal_graph_machine_ids_are_safe(text[]) from public;

alter table public.internal_graph_machine_recipes
  drop constraint if exists internal_graph_machine_recipes_safe_machines;
alter table public.internal_graph_machine_recipes
  add constraint internal_graph_machine_recipes_safe_machines
  check (public.internal_graph_machine_ids_are_safe(machine_ids));

create or replace function public.save_internal_graph_machine_recipe(
  p_title text,
  p_description text,
  p_machine_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.internal_graph_machine_recipes;
  v_hash text;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 120 then
    raise exception 'Invalid Machine recipe title';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'Machine recipe description exceeds 500 characters';
  end if;
  if not public.internal_graph_machine_ids_are_safe(p_machine_ids) then
    raise exception 'Machine recipe contains an unsupported or oversized pipeline';
  end if;

  v_hash := encode(digest(array_to_string(p_machine_ids, E'\n'), 'sha256'), 'hex');

  insert into public.internal_graph_machine_recipes (
    created_by, title, description, machine_ids, recipe_hash, expires_at
  ) values (
    auth.uid(), trim(p_title), nullif(trim(p_description), ''), p_machine_ids,
    v_hash, now() + interval '365 days'
  )
  on conflict (created_by, recipe_hash) do update set
    title = excluded.title,
    description = excluded.description,
    enabled = true,
    updated_at = now(),
    expires_at = greatest(public.internal_graph_machine_recipes.expires_at, excluded.expires_at)
  returning * into v_recipe;

  insert into public.internal_graph_audit_log(actor_id, action, metadata)
  values (
    auth.uid(),
    'machine_recipe_saved',
    jsonb_build_object(
      'recipeId', v_recipe.id,
      'recipeHash', v_recipe.recipe_hash,
      'stageCount', cardinality(v_recipe.machine_ids)
    )
  );

  return jsonb_build_object(
    'id', v_recipe.id,
    'title', v_recipe.title,
    'description', v_recipe.description,
    'machineIds', to_jsonb(v_recipe.machine_ids),
    'recipeHash', v_recipe.recipe_hash,
    'enabled', v_recipe.enabled,
    'createdAt', v_recipe.created_at,
    'updatedAt', v_recipe.updated_at,
    'expiresAt', v_recipe.expires_at
  );
end;
$$;
revoke all on function public.save_internal_graph_machine_recipe(text, text, text[]) from public;
grant execute on function public.save_internal_graph_machine_recipe(text, text, text[]) to authenticated;

create or replace function public.get_internal_graph_machine_recipes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', recipe.id,
    'title', recipe.title,
    'description', recipe.description,
    'machineIds', to_jsonb(recipe.machine_ids),
    'recipeHash', recipe.recipe_hash,
    'enabled', recipe.enabled,
    'createdAt', recipe.created_at,
    'updatedAt', recipe.updated_at,
    'expiresAt', recipe.expires_at
  ) order by recipe.updated_at desc), '[]'::jsonb)
  into v_rows
  from public.internal_graph_machine_recipes recipe
  where recipe.created_by = auth.uid()
    and recipe.expires_at > now();

  return jsonb_build_object('generatedAt', now(), 'recipes', v_rows);
end;
$$;
revoke all on function public.get_internal_graph_machine_recipes() from public;
grant execute on function public.get_internal_graph_machine_recipes() to authenticated;

create or replace function public.set_internal_graph_machine_recipe_enabled(
  p_recipe_id uuid,
  p_enabled boolean
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

  update public.internal_graph_machine_recipes
  set enabled = p_enabled, updated_at = now()
  where id = p_recipe_id
    and created_by = auth.uid()
    and expires_at > now();

  if not found then raise exception 'Machine recipe not found'; end if;
  return true;
end;
$$;
revoke all on function public.set_internal_graph_machine_recipe_enabled(uuid, boolean) from public;
grant execute on function public.set_internal_graph_machine_recipe_enabled(uuid, boolean) to authenticated;

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
  if coalesce(v_graph->>'graphVersion', '') <> p_graph_version then
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

create or replace function public.get_internal_graph_machine_run_manifests(
  p_recipe_id uuid default null,
  p_limit integer default 80
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', run.id,
    'recipeId', run.recipe_id,
    'eventId', run.event_id,
    'graphVersion', run.graph_version,
    'definitionHash', run.definition_hash,
    'seedDigest', run.seed_digest,
    'objectiveDigest', run.objective_digest,
    'resultDigest', run.result_digest,
    'stageCount', run.stage_count,
    'traceStepCount', run.trace_step_count,
    'finalNodeCount', run.final_node_count,
    'finalEdgeCount', run.final_edge_count,
    'questionCount', run.question_count,
    'createdAt', run.created_at,
    'expiresAt', run.expires_at
  ) order by run.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select manifest.*
    from public.internal_graph_machine_run_manifests manifest
    where manifest.operator_id = auth.uid()
      and manifest.expires_at > now()
      and (p_recipe_id is null or manifest.recipe_id = p_recipe_id)
    order by manifest.created_at desc
    limit greatest(1, least(coalesce(p_limit, 80), 250))
  ) run;

  return jsonb_build_object('generatedAt', now(), 'manifests', v_rows);
end;
$$;
revoke all on function public.get_internal_graph_machine_run_manifests(uuid, integer) from public;
grant execute on function public.get_internal_graph_machine_run_manifests(uuid, integer) to authenticated;

create or replace function public.prune_internal_graph_machine_registry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_runs integer;
  v_recipes integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  delete from public.internal_graph_machine_run_manifests
  where expires_at <= now();
  get diagnostics v_runs = row_count;

  delete from public.internal_graph_machine_recipes
  where expires_at <= now();
  get diagnostics v_recipes = row_count;

  return jsonb_build_object('prunedRuns', v_runs, 'prunedRecipes', v_recipes, 'prunedAt', now());
end;
$$;
revoke all on function public.prune_internal_graph_machine_registry() from public;
grant execute on function public.prune_internal_graph_machine_registry() to service_role;

comment on table public.internal_graph_machine_recipes is
  'Private operator Machine recipes: constrained ordered built-in analysis stages only. No arbitrary code or external enrichment endpoints.';
comment on table public.internal_graph_machine_run_manifests is
  'Bounded reproducibility ledger storing only graph/version/digest/count metadata; raw seeds, objectives, and person-level traces are not retained.';
