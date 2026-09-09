import {
  INTERNAL_GRAPH_MACHINES,
  runInternalGraphMachine,
  type InternalGraphMachineDefinition,
  type InternalGraphMachineRun,
} from './InternalGraphMachineEngine';
import type { InternalGraphPayload } from './InternalGraphEngine';

export interface InternalGraphMachineRecipeDefinition {
  id: string;
  title: string;
  description: string | null;
  machineIds: string[];
  recipeHash: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface InternalGraphMachineRecipeRequirements {
  requiresSeed: boolean;
  requiresTargetQuery: boolean;
  requiresPreviousGraph: boolean;
}

export interface InternalGraphMachineRecipeStage {
  machineId: string;
  title: string;
  run: InternalGraphMachineRun;
}

export interface InternalGraphMachineRecipeRun {
  recipeId: string;
  recipeHash: string;
  title: string;
  generatedAt: string;
  graphVersion: string;
  stageCount: number;
  traceStepCount: number;
  stages: InternalGraphMachineRecipeStage[];
  finalNodeIds: string[];
  finalEdgeIds: string[];
  questions: string[];
  operatingRule: string;
}

const MACHINE_BY_ID = new Map(
  INTERNAL_GRAPH_MACHINES.map((machine) => [machine.id, machine] as const),
);

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function validateInternalGraphMachineRecipe(
  machineIds: string[],
): InternalGraphMachineDefinition[] {
  if (!Array.isArray(machineIds) || machineIds.length < 1 || machineIds.length > 6) {
    throw new Error('A private Machine recipe must contain between one and six audited Machines.');
  }

  const machines = machineIds.map((machineId) => {
    const machine = MACHINE_BY_ID.get(machineId);
    if (!machine) throw new Error(`Unsupported Machine in private recipe: ${machineId}`);
    return machine;
  });

  return machines;
}

export function internalGraphMachineRecipeRequirements(
  machineIds: string[],
): InternalGraphMachineRecipeRequirements {
  const machines = validateInternalGraphMachineRecipe(machineIds);
  return {
    requiresSeed: machines.some((machine) => machine.requiresSeed),
    requiresTargetQuery: machines.some((machine) => machine.requiresTargetQuery),
    requiresPreviousGraph: machines.some((machine) => machine.requiresPreviousGraph),
  };
}

/**
 * Run an operator recipe as an ordered sequence of already-audited Machines.
 *
 * Stages intentionally share the same explicit seed/target/event scope instead
 * of silently chaining one stage's inferred frontier into the next stage's seed.
 * This keeps a saved recipe reproducible and prevents hidden target selection.
 */
export function runInternalGraphMachineRecipe(
  recipe: InternalGraphMachineRecipeDefinition,
  input: {
    current: InternalGraphPayload;
    previous?: InternalGraphPayload | null;
    seedNodeId?: string | null;
    targetQuery?: string | null;
  },
): InternalGraphMachineRecipeRun {
  if (!recipe.enabled) throw new Error('This private Machine recipe is archived.');
  const machines = validateInternalGraphMachineRecipe(recipe.machineIds);
  const requirements = internalGraphMachineRecipeRequirements(recipe.machineIds);
  const seedNodeId = input.seedNodeId ?? null;
  const targetQuery = input.targetQuery?.trim() || null;

  if (requirements.requiresSeed && (!seedNodeId || !input.current.nodes.some((node) => node.id === seedNodeId))) {
    throw new Error(`${recipe.title} requires a valid graph seed.`);
  }
  if (requirements.requiresTargetQuery && !targetQuery) {
    throw new Error(`${recipe.title} requires a target-ecosystem query for this run.`);
  }
  if (requirements.requiresPreviousGraph && !input.previous) {
    throw new Error(`${recipe.title} requires a previous event graph for drift analysis.`);
  }

  const stages = machines.map<InternalGraphMachineRecipeStage>((machine) => ({
    machineId: machine.id,
    title: machine.title,
    run: runInternalGraphMachine(machine.id, {
      current: input.current,
      previous: input.previous ?? null,
      seedNodeId,
      targetQuery,
    }),
  }));

  return {
    recipeId: recipe.id,
    recipeHash: recipe.recipeHash,
    title: recipe.title,
    generatedAt: new Date().toISOString(),
    graphVersion: input.current.graphVersion,
    stageCount: stages.length,
    traceStepCount: stages.reduce((total, stage) => total + stage.run.trace.length, 0),
    stages,
    finalNodeIds: stableUnique(stages.flatMap((stage) => stage.run.finalNodeIds)),
    finalEdgeIds: stableUnique(stages.flatMap((stage) => stage.run.finalEdgeIds)),
    questions: stableUnique(stages.flatMap((stage) => stage.run.questions)).slice(0, 24),
    operatingRule: 'Private recipes compose audited Constellation Machines only. Recipe execution is deterministic analysis over the explicitly selected graph scope; it cannot fetch external identity data, select hidden people, message users, create relationships, or persist hypothetical results as evidence.',
  };
}

export function internalGraphMachineRecipeSummary(run: InternalGraphMachineRecipeRun) {
  return {
    recipeHash: run.recipeHash,
    graphVersion: run.graphVersion,
    stageCount: run.stageCount,
    traceStepCount: run.traceStepCount,
    finalNodeCount: run.finalNodeIds.length,
    finalEdgeCount: run.finalEdgeIds.length,
    questionCount: run.questions.length,
    stages: run.stages.map((stage) => ({
      machineId: stage.machineId,
      traceStepCount: stage.run.trace.length,
      finalNodeCount: stage.run.finalNodeIds.length,
      finalEdgeCount: stage.run.finalEdgeIds.length,
      questionCount: stage.run.questions.length,
    })),
  };
}
