import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';
import type { SpatialContractBoard } from './SpatialContractEngine';
import type { SpatialDirectorState } from './SpatialDirectorEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';
import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export interface SpatialWorldOrchestratorInput {
  runtime: RuntimeReliabilitySnapshot;
  director: SpatialDirectorState;
  intelligence: SpatialWorldIntelligence;
  temporal: TemporalArchitectureState;
  progression: SpatialProgressionState;
  contracts: SpatialContractBoard;
  vaultOpenItems?: number;
}

export interface SpatialWorldOrchestration {
  worldCoherence: number;
  routeEnergy: number;
  districtEnergy: number;
  contractSalience: number;
  progressionVisibility: number;
  vaultGravity: number;
  interactionGain: number;
  ambientMotion: number;
  systemNarrative: string;
  causalChain: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Couples the major systems into one causal world model. This is intentionally
 * one-way and explainable: runtime confidence constrains the Director; the
 * Director and temporal phase shape the district and routes; verified contracts
 * feed progression; unresolved follow-through increases Vault gravity.
 */
export function buildSpatialWorldOrchestration(
  input: SpatialWorldOrchestratorInput,
): SpatialWorldOrchestration {
  const reliability = input.runtime.health === 'healthy'
    ? 1
    : input.runtime.health === 'degraded'
      ? 0.68
      : input.runtime.health === 'paused'
        ? 0.46
        : 0.28;
  const trust = input.intelligence.trust.confidence;
  const temporalIntensity = input.temporal.environmentIntensity;
  const contractCompletion = input.contracts.queue.length === 0
    ? 0
    : input.contracts.completedCount / input.contracts.queue.length;
  const progression = clamp01(input.progression.progress);
  const openVaultItems = Math.max(0, input.vaultOpenItems ?? 0);

  const worldCoherence = clamp01(reliability * 0.34 + trust * 0.26 + input.director.worldIntensity * 0.2 + temporalIntensity * 0.2);
  const routeEnergy = clamp01(
    input.director.worldIntensity * 0.3
    + input.temporal.routeWeightMultiplier / 1.5 * 0.3
    + input.intelligence.story.pathEnergy * 0.25
    + trust * 0.15,
  );
  const districtEnergy = clamp01(
    temporalIntensity * 0.35
    + input.intelligence.story.skylineActivity * 0.3
    + input.intelligence.story.lightActivation * 0.2
    + progression * 0.15,
  );
  const contractSalience = clamp01(
    input.temporal.contractWeightMultiplier / 1.5 * 0.5
    + (1 - contractCompletion) * 0.28
    + routeEnergy * 0.22,
  );
  const progressionVisibility = clamp01(0.25 + contractCompletion * 0.32 + progression * 0.28 + input.progression.momentumChain / 10 * 0.15);
  const vaultGravity = clamp01(
    (input.temporal.phase === 'reflection' ? 0.52 : input.temporal.phase === 'closing' ? 0.3 : 0.08)
    + Math.min(0.32, openVaultItems * 0.08)
    + contractCompletion * 0.16,
  );
  const interactionGain = clamp01(0.35 + routeEnergy * 0.35 + worldCoherence * 0.3);
  const ambientMotion = clamp01(
    input.temporal.avatarMotionMultiplier * 0.42
    + input.intelligence.trust.motionCalm * 0.28
    + input.intelligence.story.ambientCalm * 0.3,
  );

  const causalChain = [
    `runtime:${input.runtime.health}`,
    `director:${input.director.act}`,
    `temporal:${input.temporal.phase}`,
    `district:${districtEnergy.toFixed(2)}`,
    `routes:${routeEnergy.toFixed(2)}`,
    `contracts:${contractSalience.toFixed(2)}`,
    `progression:${progressionVisibility.toFixed(2)}`,
    `vault:${vaultGravity.toFixed(2)}`,
  ];

  const systemNarrative = vaultGravity >= 0.65
    ? 'The live world is handing unfinished value into the Vault.'
    : contractSalience >= 0.72
      ? 'The environment is narrowing around the next verified objective.'
      : routeEnergy >= 0.7
        ? 'The district and routes are amplifying the same live opportunity window.'
        : worldCoherence < 0.5
          ? 'Beacon is simplifying the world until its live systems agree again.'
          : 'Every visible layer is responding to the same verified event state.';

  return {
    worldCoherence,
    routeEnergy,
    districtEnergy,
    contractSalience,
    progressionVisibility,
    vaultGravity,
    interactionGain,
    ambientMotion,
    systemNarrative,
    causalChain,
  };
}
