import type { SpatialContractBoard } from './SpatialContractEngine';
import type { SpatialLandmarkState } from './SpatialLandmarkEngine';
import type { SpatialProgressionState } from './SpatialProgressionEngine';
import type { SpatialTourStatus } from './SpatialTourEngine';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

export type OutcomeBridgeState = 'live' | 'commit' | 'closing' | 'handoff' | 'complete';

export interface SpatialOutcomeBridgeInput {
  temporal: TemporalArchitectureState;
  contracts: SpatialContractBoard;
  progression: SpatialProgressionState;
  landmarks: SpatialLandmarkState;
  tourStatus: SpatialTourStatus;
  mutualMatches: number;
  signalsSent: number;
}

export interface SpatialOutcomeBridge {
  state: OutcomeBridgeState;
  urgency: number;
  headline: string;
  detail: string;
  primaryAction: 'keep-scouting' | 'open-mutual' | 'finish-contract' | 'review-vault';
  completionEvidence: string[];
  unresolvedValueCount: number;
  handoffWeight: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Translates live-world activity into a concrete real-world handoff. This engine
 * does not invent outcomes or urgency. It only makes verified progress, mutuals,
 * contracts and unfinished value legible at the right moment in the event.
 */
export function buildSpatialOutcomeBridge(input: SpatialOutcomeBridgeInput): SpatialOutcomeBridge {
  const unfinishedContracts = input.contracts.queue.filter((contract) => contract.state !== 'complete').length;
  const unresolvedLandmarks = input.landmarks.landmarks.length;
  const unresolvedValueCount = unfinishedContracts + (input.mutualMatches > 0 ? 1 : 0) + Math.min(3, unresolvedLandmarks);
  const completionEvidence = [
    input.signalsSent > 0 ? `${input.signalsSent} verified signal${input.signalsSent === 1 ? '' : 's'} sent` : null,
    input.mutualMatches > 0 ? `${input.mutualMatches} mutual${input.mutualMatches === 1 ? '' : 's'} active` : null,
    input.contracts.completedCount > 0 ? `${input.contracts.completedCount} field contract${input.contracts.completedCount === 1 ? '' : 's'} completed` : null,
    input.progression.momentumChain > 0 ? `momentum chain ${input.progression.momentumChain}` : null,
  ].filter((item): item is string => Boolean(item));

  const latePhase = input.temporal.phase === 'closing' || input.temporal.phase === 'reflection';
  const handoffWeight = clamp01(
    (latePhase ? 0.45 : 0.08)
      + Math.min(0.25, input.mutualMatches * 0.12)
      + Math.min(0.16, unfinishedContracts * 0.05)
      + (input.tourStatus === 'complete' ? 0.12 : 0),
  );

  if (input.temporal.phase === 'reflection') {
    return {
      state: completionEvidence.length > 0 ? 'handoff' : 'complete',
      urgency: 0.35,
      headline: completionEvidence.length > 0 ? 'Carry the event forward' : 'The live field is complete',
      detail: completionEvidence.length > 0
        ? 'Beacon has converted the live experience into a small set of verified follow-through items instead of letting the event disappear.'
        : 'No verified actions require follow-through from this field.',
      primaryAction: completionEvidence.length > 0 ? 'review-vault' : 'keep-scouting',
      completionEvidence,
      unresolvedValueCount,
      handoffWeight,
    };
  }

  if (input.temporal.phase === 'closing') {
    return {
      state: 'closing',
      urgency: clamp01(0.58 + unresolvedValueCount * 0.05),
      headline: 'The field is closing around unfinished value',
      detail: input.mutualMatches > 0
        ? 'Convert one verified mutual into a concrete next step before the live context disappears.'
        : 'Choose one credible path to preserve before the room resets.',
      primaryAction: input.mutualMatches > 0 ? 'open-mutual' : unfinishedContracts > 0 ? 'finish-contract' : 'keep-scouting',
      completionEvidence,
      unresolvedValueCount,
      handoffWeight,
    };
  }

  if (input.mutualMatches > 0 || input.temporal.phase === 'commitment') {
    return {
      state: 'commit',
      urgency: clamp01(0.42 + input.mutualMatches * 0.12),
      headline: 'A real next step is available',
      detail: 'Beacon is shifting from discovery toward follow-through because verified reciprocal value now exists.',
      primaryAction: input.mutualMatches > 0 ? 'open-mutual' : 'finish-contract',
      completionEvidence,
      unresolvedValueCount,
      handoffWeight,
    };
  }

  return {
    state: 'live',
    urgency: 0.18,
    headline: 'The field is still creating options',
    detail: 'Keep scouting explainable landmarks until a credible path is worth turning into a real next step.',
    primaryAction: 'keep-scouting',
    completionEvidence,
    unresolvedValueCount,
    handoffWeight,
  };
}
