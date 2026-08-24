import type { VenueModelCredibilityState } from './VenueModelCredibility';
import type { RecommendationReliability } from './VenueRecommendationReliability';
import type { VenueServiceObjectiveState } from './VenueServiceObjective';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';

export type VenueDeploymentStage = 'shadow' | 'advisory' | 'limited' | 'operational';

export interface VenueDeploymentPolicyInput {
  credibility: VenueModelCredibilityState;
  quorum: VenueSourceQuorumState;
  serviceObjective: VenueServiceObjectiveState;
  recommendationReliability: RecommendationReliability[];
  totalMeasuredInterventions: number;
  totalRevertedInterventions: number;
  minimumOperationalSamples?: number;
}

export interface VenueDeploymentPolicyState {
  stage: VenueDeploymentStage;
  allowOperatorSurface: boolean;
  allowActionReadyRecommendations: boolean;
  requireExplicitConfirmation: boolean;
  eligibleCommandIds: string[];
  blockedCommandIds: string[];
  measuredSupport: number;
  revertRate: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Graduates venue recommendations through evidence-backed deployment stages.
 * New decision logic begins in shadow mode, then earns advisory and limited
 * authority from measured outcomes before it can participate in the normal
 * operator workflow. Even `operational` remains human-in-the-loop; this policy
 * does not authorize automatic physical-world intervention.
 */
export function evaluateVenueDeploymentPolicy(
  input: VenueDeploymentPolicyInput,
): VenueDeploymentPolicyState {
  const minimumOperationalSamples = Math.max(6, input.minimumOperationalSamples ?? 12);
  const measuredSupport = Math.max(0, input.totalMeasuredInterventions);
  const revertRate = measuredSupport + input.totalRevertedInterventions === 0
    ? 0
    : input.totalRevertedInterventions / (measuredSupport + input.totalRevertedInterventions);
  const reliableCommands = input.recommendationReliability.filter((item) => item.status === 'reliable');
  const mixedCommands = input.recommendationReliability.filter((item) => item.status === 'mixed');
  const weakCommands = input.recommendationReliability.filter((item) => item.status === 'weak');
  const reasons: string[] = [];

  let stage: VenueDeploymentStage = 'shadow';
  if (
    input.credibility.band === 'validated'
    && input.quorum.state === 'healthy'
    && input.serviceObjective.objectiveScore >= 0.82
    && measuredSupport >= minimumOperationalSamples
    && reliableCommands.length >= 2
    && revertRate <= 0.15
  ) {
    stage = 'operational';
  } else if (
    (input.credibility.band === 'validated' || input.credibility.band === 'decision-support')
    && input.quorum.state !== 'lost'
    && input.serviceObjective.objectiveScore >= 0.7
    && measuredSupport >= 6
    && reliableCommands.length >= 1
    && revertRate <= 0.3
  ) {
    stage = 'limited';
  } else if (
    input.credibility.band !== 'insufficient'
    && input.quorum.state !== 'lost'
    && input.serviceObjective.objectiveScore >= 0.5
  ) {
    stage = 'advisory';
  }

  if (input.credibility.band === 'insufficient') reasons.push('model credibility is insufficient for operator-facing recommendations');
  if (input.quorum.state === 'lost') reasons.push('independent sensing quorum is lost');
  if (input.serviceObjective.objectiveScore < 0.5) reasons.push('venue operations service objectives are below the advisory floor');
  if (measuredSupport < 6) reasons.push('measured intervention support is still immature');
  if (revertRate > 0.3) reasons.push('operator reversion rate is too high for expanded recommendation authority');
  if (weakCommands.length > 0) reasons.push(`${weakCommands.length} command class${weakCommands.length === 1 ? ' has' : 'es have'} weak measured reliability`);
  if (stage === 'operational' && reasons.length === 0) reasons.push('model credibility, sensing quorum, service objectives, measured support, and command reliability satisfy the normal deployment policy');
  if (stage === 'limited' && reasons.length === 0) reasons.push('only measured reliable command classes may enter the action-ready operator surface');
  if (stage === 'advisory' && reasons.length === 0) reasons.push('recommendations may be shown for review, but measured support is not mature enough for action-ready status');
  if (stage === 'shadow' && reasons.length === 0) reasons.push('recommendations remain shadow-only until evidence supports operator exposure');

  const eligibleCommandIds = stage === 'operational'
    ? input.recommendationReliability.filter((item) => item.status === 'reliable' || item.status === 'mixed').map((item) => item.commandId).sort()
    : stage === 'limited'
      ? reliableCommands.map((item) => item.commandId).sort()
      : [];
  const blockedCommandIds = [...new Set([
    ...weakCommands.map((item) => item.commandId),
    ...(stage === 'limited' ? mixedCommands.map((item) => item.commandId) : []),
  ])].sort();

  return {
    stage,
    allowOperatorSurface: stage !== 'shadow',
    allowActionReadyRecommendations: stage === 'limited' || stage === 'operational',
    requireExplicitConfirmation: true,
    eligibleCommandIds,
    blockedCommandIds,
    measuredSupport,
    revertRate: clamp01(revertRate),
    reasons,
  };
}
