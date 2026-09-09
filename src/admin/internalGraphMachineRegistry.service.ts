import { supabase } from '../lib/supabase';
import {
  internalGraphMachineRecipeSummary,
  type InternalGraphMachineRecipeDefinition,
  type InternalGraphMachineRecipeRun,
} from './InternalGraphMachineRecipeEngine';

export interface InternalGraphMachineRunManifest {
  id: string;
  recipeId: string | null;
  eventId: string | null;
  graphVersion: string;
  definitionHash: string;
  seedDigest: string | null;
  objectiveDigest: string | null;
  resultDigest: string;
  stageCount: number;
  traceStepCount: number;
  finalNodeCount: number;
  finalEdgeCount: number;
  questionCount: number;
  createdAt: string;
  expiresAt: string;
}

function parseRecipe(value: unknown): InternalGraphMachineRecipeDefinition | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.recipeHash !== 'string') return null;
  const machineIds = Array.isArray(row.machineIds)
    ? row.machineIds.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: row.id,
    title: row.title,
    description: typeof row.description === 'string' ? row.description : null,
    machineIds,
    recipeHash: row.recipeHash,
    enabled: row.enabled !== false,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : new Date().toISOString(),
  };
}

function parseManifest(value: unknown): InternalGraphMachineRunManifest | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.graphVersion !== 'string' || typeof row.definitionHash !== 'string' || typeof row.resultDigest !== 'string') return null;
  const numeric = (key: string) => {
    const parsed = Number(row[key] ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    id: row.id,
    recipeId: typeof row.recipeId === 'string' ? row.recipeId : null,
    eventId: typeof row.eventId === 'string' ? row.eventId : null,
    graphVersion: row.graphVersion,
    definitionHash: row.definitionHash,
    seedDigest: typeof row.seedDigest === 'string' ? row.seedDigest : null,
    objectiveDigest: typeof row.objectiveDigest === 'string' ? row.objectiveDigest : null,
    resultDigest: row.resultDigest,
    stageCount: numeric('stageCount'),
    traceStepCount: numeric('traceStepCount'),
    finalNodeCount: numeric('finalNodeCount'),
    finalEdgeCount: numeric('finalEdgeCount'),
    questionCount: numeric('questionCount'),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : new Date().toISOString(),
  };
}

export async function saveInternalGraphMachineRecipe(input: {
  title: string;
  description?: string | null;
  machineIds: string[];
}): Promise<InternalGraphMachineRecipeDefinition> {
  const { data, error } = await supabase.rpc('save_internal_graph_machine_recipe', {
    p_title: input.title.trim(),
    p_description: input.description?.trim() || null,
    p_machine_ids: input.machineIds,
  });
  if (error) throw new Error(error.message ?? 'Unable to save private Machine recipe.');
  const parsed = parseRecipe(data);
  if (!parsed) throw new Error('Machine recipe response was invalid.');
  return parsed;
}

export async function loadInternalGraphMachineRecipes(): Promise<InternalGraphMachineRecipeDefinition[]> {
  const { data, error } = await supabase.rpc('get_internal_graph_machine_recipes');
  if (error || !data || typeof data !== 'object') throw new Error(error?.message ?? 'Unable to load private Machine recipes.');
  const rows = Array.isArray((data as Record<string, unknown>).recipes)
    ? (data as Record<string, unknown>).recipes as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseRecipe(row);
    return parsed ? [parsed] : [];
  });
}

export async function setInternalGraphMachineRecipeEnabled(recipeId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_internal_graph_machine_recipe_enabled', {
    p_recipe_id: recipeId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message ?? 'Unable to update Machine recipe state.');
}

export async function recordInternalGraphMachineRun(input: {
  recipe: InternalGraphMachineRecipeDefinition;
  run: InternalGraphMachineRecipeRun;
  eventId?: string | null;
  seedNodeId?: string | null;
  targetQuery?: string | null;
}): Promise<InternalGraphMachineRunManifest> {
  const summary = internalGraphMachineRecipeSummary(input.run);
  const { data, error } = await supabase.rpc('record_internal_graph_machine_run', {
    p_recipe_id: input.recipe.id,
    p_event_id: input.eventId ?? null,
    p_graph_version: input.run.graphVersion,
    p_seed_node_id: input.seedNodeId ?? null,
    p_target_query: input.targetQuery?.trim() || null,
    p_trace_step_count: input.run.traceStepCount,
    p_final_node_count: input.run.finalNodeIds.length,
    p_final_edge_count: input.run.finalEdgeIds.length,
    p_question_count: input.run.questions.length,
    p_result_summary: summary,
  });
  if (error) throw new Error(error.message ?? 'Unable to seal Machine run manifest.');
  const parsed = parseManifest(data);
  if (!parsed) throw new Error('Machine manifest response was invalid.');
  return parsed;
}

export async function loadInternalGraphMachineRunManifests(
  recipeId?: string | null,
  limit = 80,
): Promise<InternalGraphMachineRunManifest[]> {
  const { data, error } = await supabase.rpc('get_internal_graph_machine_run_manifests', {
    p_recipe_id: recipeId ?? null,
    p_limit: Math.max(1, Math.min(limit, 250)),
  });
  if (error || !data || typeof data !== 'object') throw new Error(error?.message ?? 'Unable to load Machine run manifests.');
  const rows = Array.isArray((data as Record<string, unknown>).manifests)
    ? (data as Record<string, unknown>).manifests as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseManifest(row);
    return parsed ? [parsed] : [];
  });
}
