import type { SpatialCommitmentState } from './SpatialCommitmentEngine';
import type { SpatialNetworkEffectState } from './SpatialNetworkEffectEngine';
import type { SpatialReciprocityState } from './SpatialReciprocityEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export interface CounterfactualScenario {
  id: string;
  title: string;
  detail: string;
  projectedImpact: number;
  confidence: number;
  evidence: string[];
  action: 'open-mutuals' | 'review-vault' | 'converge' | 'keep-scouting';
}

export interface SpatialCounterfactualState {
  scenarios: CounterfactualScenario[];
  primary: CounterfactualScenario | null;
  opportunityDelta: number;
  narrative: string;
}

interface Input {
  commitments: SpatialCommitmentState;
  reciprocity: SpatialReciprocityState;
  networkEffects: SpatialNetworkEffectState;
  temporal: TemporalArchitectureState;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Explains what Beacon can still change using only observed, verifiable state.
 * This is not a behavioral prediction engine and never claims what a person will do.
 * It models system-level opportunity deltas: what value becomes available if the
 * user completes an already-supported next action.
 */
export function buildSpatialCounterfactuals(input: Input): SpatialCounterfactualState {
  const scenarios: CounterfactualScenario[] = [];
  const primaryReciprocity = input.reciprocity.primary;

  if (primaryReciprocity && primaryReciprocity.state === 'reciprocal') {
    scenarios.push({
      id: `reciprocal-follow-through-${primaryReciprocity.commitmentId}`,
      title: 'If this reciprocal path is converted now',
      detail: 'Beacon can move this from reciprocal event value into durable follow-through without relying on another discovery cycle.',
      projectedImpact: clamp01(0.58 + primaryReciprocity.readiness * 0.34),
      confidence: clamp01(0.7 + primaryReciprocity.confidence * 0.24),
      evidence: primaryReciprocity.evidence.slice(0, 3).map((item) => item.label),
      action: 'open-mutuals',
    });
  }

  const readyCommitment = input.commitments.candidates.find((candidate) => candidate.status === 'ready');
  if (readyCommitment) {
    scenarios.push({
      id: `ready-${readyCommitment.id}`,
      title: 'If the strongest ready commitment is completed',
      detail: 'The event becomes less dependent on memory and more of its verified value is preserved as an explicit next step.',
      projectedImpact: clamp01(0.46 + readyCommitment.confidence * 0.38),
      confidence: readyCommitment.confidence,
      evidence: readyCommitment.evidence.slice(0, 3),
      action: readyCommitment.destination === 'VaultRecap' ? 'review-vault' : readyCommitment.destination === 'Matches' ? 'open-mutuals' : 'converge',
    });
  }

  if (input.networkEffects.primary) {
    scenarios.push({
      id: `network-${input.networkEffects.primary.id}`,
      title: 'If the strongest compounding loop is activated',
      detail: 'Beacon can preserve the current event’s verified leverage instead of resetting to zero at the next event.',
      projectedImpact: clamp01(input.networkEffects.primary.leverage * 0.62 + input.networkEffects.compoundingScore * 0.38),
      confidence: input.networkEffects.primary.confidence,
      evidence: input.networkEffects.primary.evidence.slice(0, 3),
      action: input.networkEffects.primary.destination === 'Matches' ? 'open-mutuals' : input.networkEffects.primary.destination === 'VaultRecap' ? 'review-vault' : 'converge',
    });
  }

  if (input.temporal.phase === 'discovery' && scenarios.length === 0) {
    scenarios.push({
      id: 'continue-discovery',
      title: 'If discovery continues before narrowing',
      detail: 'The field does not yet have enough reciprocal or commitment evidence to justify a stronger recommendation.',
      projectedImpact: 0.28,
      confidence: 0.82,
      evidence: ['No reciprocal or ready commitment currently meets the elevation threshold'],
      action: 'keep-scouting',
    });
  }

  scenarios.sort((left, right) => {
    const leftScore = left.projectedImpact * 0.58 + left.confidence * 0.42;
    const rightScore = right.projectedImpact * 0.58 + right.confidence * 0.42;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });

  const primary = scenarios[0] ?? null;
  const baseline = clamp01(input.commitments.completionRatio * 0.45 + input.networkEffects.compoundingScore * 0.35 + Math.min(0.2, input.reciprocity.reciprocalCount * 0.08));
  const opportunityDelta = primary ? clamp01(primary.projectedImpact - baseline) : 0;

  return {
    scenarios,
    primary,
    opportunityDelta,
    narrative: primary
      ? `${Math.round(opportunityDelta * 100)} points of additional system-level opportunity remain available if the strongest evidence-backed next action is completed.`
      : 'No evidence-backed counterfactual is strong enough to show. Beacon will not invent one.',
  };
}
