import type { ReciprocityPath, SpatialReciprocityState } from './SpatialReciprocityEngine';
import type { SpatialCommitmentState } from './SpatialCommitmentEngine';
import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export type NetworkEffectLane = 'introduction' | 'follow-through' | 'cluster-bridge' | 'repeat-loop';

export interface NetworkEffectOpportunity {
  id: string;
  lane: NetworkEffectLane;
  title: string;
  detail: string;
  confidence: number;
  leverage: number;
  evidence: string[];
  destination: 'Matches' | 'VaultRecap' | 'SpatialField';
}

export interface SpatialNetworkEffectState {
  opportunities: NetworkEffectOpportunity[];
  primary: NetworkEffectOpportunity | null;
  compoundingScore: number;
  repeatLoopReady: boolean;
  narrative: string;
}

interface Input {
  reciprocity: SpatialReciprocityState;
  commitments: SpatialCommitmentState;
  intelligence: SpatialWorldIntelligence;
  temporal: TemporalArchitectureState;
  mutualMatches: number;
  signalsSent: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scorePath(path: ReciprocityPath): number {
  const stateWeight = path.state === 'reciprocal' ? 1 : path.state === 'scheduled' ? 0.9 : path.state === 'credible' ? 0.72 : path.state === 'fulfilled' ? 0.55 : 0.25;
  return clamp01(path.readiness * 0.62 + path.confidence * 0.23 + stateWeight * 0.15);
}

/**
 * Converts explicit, evidence-backed event value into compounding network loops.
 *
 * The engine never manufactures invitations, referrals, demand, or social proof.
 * It only surfaces a growth loop when Beacon can point to reciprocal paths,
 * completed event work, aggregate activity, or repeatable follow-through evidence.
 */
export function buildSpatialNetworkEffects(input: Input): SpatialNetworkEffectState {
  const opportunities: NetworkEffectOpportunity[] = [];
  const bestPath = input.reciprocity.primary;

  if (bestPath && (bestPath.state === 'reciprocal' || bestPath.state === 'scheduled')) {
    opportunities.push({
      id: `follow-through-${bestPath.commitmentId}`,
      lane: 'follow-through',
      title: 'Convert reciprocal value into a durable relationship loop',
      detail: 'A verified reciprocal path exists. Beacon can now prioritize concrete follow-through instead of returning the user to broad discovery.',
      confidence: scorePath(bestPath),
      leverage: clamp01(0.58 + bestPath.readiness * 0.34),
      evidence: bestPath.evidence.slice(0, 3).map((item) => item.label),
      destination: 'Matches',
    });
  }

  const strongClusters = input.intelligence.clusters.filter((cluster) => cluster.confidence >= 0.68 && cluster.momentum >= 0.55);
  if (strongClusters.length >= 2 && input.mutualMatches > 0) {
    const averageMomentum = strongClusters.reduce((sum, cluster) => sum + cluster.momentum, 0) / strongClusters.length;
    opportunities.push({
      id: 'cluster-bridge',
      lane: 'cluster-bridge',
      title: 'Bridge two verified activity zones',
      detail: 'Multiple aggregate activity zones are strong enough to justify a deliberate bridge while preserving privacy and avoiding hidden-person recommendations.',
      confidence: clamp01(0.56 + averageMomentum * 0.28 + Math.min(0.12, input.mutualMatches * 0.04)),
      leverage: clamp01(0.5 + strongClusters.length * 0.08 + averageMomentum * 0.22),
      evidence: [
        `${strongClusters.length} high-confidence activity zones`,
        `${input.mutualMatches} verified mutual${input.mutualMatches === 1 ? '' : 's'}`,
      ],
      destination: 'SpatialField',
    });
  }

  if (input.signalsSent >= 2 && input.commitments.completionRatio >= 0.35) {
    opportunities.push({
      id: 'introduction-loop',
      lane: 'introduction',
      title: 'Turn event momentum into one high-context introduction',
      detail: 'Enough verified outbound activity and follow-through exists to justify narrowing to one context-rich introduction rather than increasing message volume.',
      confidence: clamp01(0.5 + Math.min(0.18, input.signalsSent * 0.04) + input.commitments.completionRatio * 0.26),
      leverage: clamp01(0.48 + input.commitments.completionRatio * 0.32 + Math.min(0.16, input.signalsSent * 0.03)),
      evidence: [
        `${input.signalsSent} verified signals sent`,
        `${Math.round(input.commitments.completionRatio * 100)}% commitment completion`,
      ],
      destination: 'SpatialField',
    });
  }

  const repeatLoopReady = input.temporal.phase === 'reflection'
    && input.reciprocity.paths.some((path) => path.state === 'fulfilled' || path.state === 'scheduled')
    && input.commitments.completionRatio >= 0.45;

  if (repeatLoopReady) {
    opportunities.push({
      id: 'repeat-loop',
      lane: 'repeat-loop',
      title: 'Preserve what worked for the next event',
      detail: 'This event produced enough verified follow-through to preserve the winning pattern for future event planning and attendee guidance.',
      confidence: clamp01(0.64 + input.commitments.completionRatio * 0.24),
      leverage: clamp01(0.62 + input.commitments.completionRatio * 0.28),
      evidence: [
        `${input.reciprocity.fulfilledCount} fulfilled reciprocity path${input.reciprocity.fulfilledCount === 1 ? '' : 's'}`,
        `${input.reciprocity.reciprocalCount} reciprocal or scheduled path${input.reciprocity.reciprocalCount === 1 ? '' : 's'}`,
      ],
      destination: 'VaultRecap',
    });
  }

  opportunities.sort((left, right) => {
    const leftScore = left.leverage * 0.58 + left.confidence * 0.42;
    const rightScore = right.leverage * 0.58 + right.confidence * 0.42;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.id.localeCompare(right.id);
  });

  const primary = opportunities[0] ?? null;
  const compoundingScore = opportunities.length === 0
    ? 0
    : clamp01(opportunities.reduce((sum, item) => sum + item.leverage * item.confidence, 0) / Math.max(1, opportunities.length));

  return {
    opportunities,
    primary,
    compoundingScore,
    repeatLoopReady,
    narrative: primary
      ? `Beacon found ${opportunities.length} evidence-backed compounding loop${opportunities.length === 1 ? '' : 's'}; ${primary.title.toLowerCase()} currently has the strongest verified leverage.`
      : 'No compounding network loop is strong enough yet. Beacon will not manufacture social proof or growth pressure.',
  };
}
