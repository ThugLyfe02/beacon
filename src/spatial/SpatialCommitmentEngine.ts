import type { SpatialContractBoard } from './SpatialContractEngine';
import type { SpatialOutcomeBridge } from './SpatialOutcomeBridgeEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export type CommitmentKind = 'follow-up' | 'office-hours' | 'introduction' | 'decision' | 'recap';
export type CommitmentStatus = 'candidate' | 'selected' | 'ready' | 'complete';

export interface SpatialCommitmentCandidate {
  id: string;
  kind: CommitmentKind;
  title: string;
  detail: string;
  confidence: number;
  evidence: string[];
  status: CommitmentStatus;
  destination: 'Matches' | 'OfficeHoursRequest' | 'VaultRecap' | 'SpatialField';
}

export interface SpatialCommitmentState {
  candidates: SpatialCommitmentCandidate[];
  primary: SpatialCommitmentCandidate | null;
  remainingCount: number;
  completionRatio: number;
  narrative: string;
}

interface Input {
  bridge: SpatialOutcomeBridge;
  temporal: TemporalArchitectureState;
  contracts: SpatialContractBoard;
  progression: SpatialProgressionState;
  mutualMatches: number;
  signalsSent: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts verified event evidence into a small commitment queue. This is not a
 * hidden recommendation model: every candidate is explainable, reversible and
 * grounded in actions Beacon can prove happened during the current event.
 */
export function buildSpatialCommitments(input: Input): SpatialCommitmentState {
  const evidence = input.bridge.completionEvidence;
  const candidates: SpatialCommitmentCandidate[] = [];

  if (input.mutualMatches > 0) {
    candidates.push({
      id: 'mutual-follow-up',
      kind: 'follow-up',
      title: 'Turn one mutual into a dated next step',
      detail: 'Open the mutual surface and attach one concrete follow-through action while context is still fresh.',
      confidence: clamp01(0.72 + Math.min(0.24, input.mutualMatches * 0.08)),
      evidence: evidence.filter((item) => item.includes('mutual') || item.includes('signal')),
      status: input.temporal.phase === 'reflection' ? 'ready' : 'selected',
      destination: 'Matches',
    });
  }

  const activeContract = input.contracts.active;
  if (activeContract.state !== 'complete') {
    candidates.push({
      id: `contract-${activeContract.id}`,
      kind: activeContract.kind === 'close' ? 'decision' : 'recap',
      title: activeContract.title,
      detail: activeContract.detail,
      confidence: clamp01(0.5 + activeContract.progress * 0.35 + input.bridge.handoffWeight * 0.15),
      evidence: [`${activeContract.current}/${activeContract.target} verified progress`],
      status: activeContract.progress >= 0.75 ? 'ready' : 'candidate',
      destination: input.temporal.phase === 'reflection' ? 'VaultRecap' : 'SpatialField',
    });
  }

  if (input.signalsSent > 0 && input.mutualMatches === 0) {
    candidates.push({
      id: 'signal-recap',
      kind: 'recap',
      title: 'Preserve the strongest outbound path',
      detail: 'Review the field recap so an intentional signal does not disappear when the live session ends.',
      confidence: clamp01(0.48 + Math.min(0.3, input.signalsSent * 0.06) + input.bridge.handoffWeight * 0.22),
      evidence: evidence.filter((item) => item.includes('signal')),
      status: input.temporal.phase === 'closing' || input.temporal.phase === 'reflection' ? 'ready' : 'candidate',
      destination: 'VaultRecap',
    });
  }

  if (input.progression.momentumChain >= 3 && input.mutualMatches === 0) {
    candidates.push({
      id: 'momentum-conversion',
      kind: 'introduction',
      title: 'Convert momentum into one deliberate introduction',
      detail: 'The event has enough verified momentum to justify narrowing from broad discovery to one specific path.',
      confidence: clamp01(0.44 + Math.min(0.32, input.progression.momentumChain * 0.04)),
      evidence: [`momentum chain ${input.progression.momentumChain}`],
      status: 'candidate',
      destination: 'SpatialField',
    });
  }

  candidates.sort((left, right) => {
    const statusWeight: Record<CommitmentStatus, number> = { complete: 4, ready: 3, selected: 2, candidate: 1 };
    const statusDelta = statusWeight[right.status] - statusWeight[left.status];
    if (statusDelta !== 0) return statusDelta;
    if (left.confidence !== right.confidence) return right.confidence - left.confidence;
    return left.id.localeCompare(right.id);
  });

  const completedContracts = input.contracts.completedCount;
  const totalVerified = Math.max(1, input.contracts.queue.length + input.mutualMatches + input.signalsSent);
  const completionRatio = clamp01((completedContracts + input.mutualMatches) / totalVerified);
  const primary = candidates[0] ?? null;

  return {
    candidates,
    primary,
    remainingCount: candidates.filter((item) => item.status !== 'complete').length,
    completionRatio,
    narrative: primary
      ? `Beacon has reduced the event to ${candidates.length} evidence-backed commitment${candidates.length === 1 ? '' : 's'}; ${primary.title.toLowerCase()} is currently the strongest next move.`
      : 'The event has no unresolved verified commitment to carry forward.',
  };
}
