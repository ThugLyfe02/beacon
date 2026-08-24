import type { VenueConfigurationImpactState } from './VenueConfigurationImpact';
import type { VenueModelCredibilityState } from './VenueModelCredibility';
import type { RecommendationReliability } from './VenueRecommendationReliability';
import type { VenueRecommendationCalibrationState } from './VenueRecommendationCalibration';
import type { VenueServiceObjectiveState } from './VenueServiceObjective';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';

export type VenueDeploymentStage = 'shadow' | 'advisory' | 'limited' | 'operational';

export interface VenueDeploymentPolicyInput {
  credibility: VenueModelCredibilityState;
  quorum: VenueSourceQuorumState;
  serviceObjective: VenueServiceObjectiveState;
  recommendationReliability: RecommendationReliability[];
  recommendationCalibration?: VenueRecommendationCalibrationState;
  configurationImpact?: VenueConfigurationImpactState;
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
  calibrationBand: VenueRecommendationCalibrationState['band'] | 'not-supplied';
  configurationImpactLevel: VenueConfigurationImpactState['level'] | 'not-supplied';
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
 *
 * Recommendation calibration is intentionally separate from ranking quality. A
 * command class can rank useful actions correctly and still be unsafe to label
 * "80% confidence" if measured outcomes show that label is systematically
 * overconfident. When calibration evidence is supplied, operational promotion
 * requires it to be mature and calibrated.
 *
 * Venue configuration changes are also treated as a deployment event. Material
 * geometry, topology, accessibility, capacity, or operating-envelope changes can
 * invalidate the baseline that earned recommendation authority. Breaking change
 * impact forces shadow revalidation instead of silently inheriting trust from a
 * physically different venue configuration.
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
  const calibrationBand = input.recommendationCalibration?.band ?? 'not-supplied';
  const configurationImpactLevel = input.configurationImpact?.level ?? 'not-supplied';
  const configurationRequiresShadow = input.configurationImpact?.requiresShadowRevalidation === true;
  const configurationRequiresBaseline = input.configurationImpact?.requiresNewBaseline === true;
  const calibrationBlocksLimited = calibrationBand === 'miscalibrated';
  const calibrationAllowsOperational = calibrationBand === 'calibrated';
  const calibrationAllowsLimited = calibrationBand === 'calibrated' || calibrationBand === 'watch' || calibrationBand === 'not-supplied';
  const reasons: string[] = [];

  let stage: VenueDeploymentStage = 'shadow';
  if (!configurationRequiresShadow) {
    if (
      input.credibility.band === 'validated'
      && input.quorum.state === 'healthy'
      && input.serviceObjective.objectiveScore >= 0.82
      && measuredSupport >= minimumOperationalSamples
      && reliableCommands.length >= 2
      && revertRate <= 0.15
      && calibrationAllowsOperational
      && !configurationRequiresBaseline
    ) {
      stage = 'operational';
    } else if (
      (input.credibility.band === 'validated' || input.credibility.band === 'decision-support')
      && input.quorum.state !== 'lost'
      && input.serviceObjective.objectiveScore >= 0.7
      && measuredSupport >= 6
      && reliableCommands.length >= 1
      && revertRate <= 0.3
      && calibrationAllowsLimited
      && !calibrationBlocksLimited
      && !configurationRequiresBaseline
    ) {
      stage = 'limited';
    } else if (
      input.credibility.band !== 'insufficient'
      && input.quorum.state !== 'lost'
      && input.serviceObjective.objectiveScore >= 0.5
      && !calibrationBlocksLimited
    ) {
      stage = 'advisory';
    }
  }

  if (input.credibility.band === 'insufficient') reasons.push('model credibility is insufficient for operator-facing recommendations');
  if (input.quorum.state === 'lost') reasons.push('independent sensing quorum is lost');
  if (input.serviceObjective.objectiveScore < 0.5) reasons.push('venue operations service objectives are below the advisory floor');
  if (measuredSupport < 6) reasons.push('measured intervention support is still immature');
  if (revertRate > 0.3) reasons.push('operator reversion rate is too high for expanded recommendation authority');
  if (weakCommands.length > 0) reasons.push(`${weakCommands.length} command class${weakCommands.length === 1 ? ' has' : 'es have'} weak measured reliability`);
  if (calibrationBand === 'miscalibrated') reasons.push('measured recommendation confidence is materially miscalibrated; action-ready promotion is blocked');
  if (calibrationBand === 'immature') reasons.push('recommendation confidence calibration is still immature; operational promotion remains unavailable');
  if (calibrationBand === 'watch') reasons.push('recommendation confidence calibration requires continued observation before operational promotion');
  if (calibrationBand === 'not-supplied' && stage === 'limited') reasons.push('limited deployment is allowed for backward compatibility, but operational promotion requires explicit measured confidence calibration');
  if (configurationRequiresShadow) reasons.push('venue configuration blast radius requires shadow revalidation before recommendation authority can return');
  else if (configurationRequiresBaseline) reasons.push('venue configuration changed materially enough that a new operational baseline is required before action-ready promotion');
  if (configurationImpactLevel === 'breaking') reasons.push('breaking venue configuration change invalidates prior command leases and measurement comparability');
  if (stage === 'operational' && reasons.length === 0) reasons.push('model credibility, sensing quorum, service objectives, measured support, command reliability, confidence calibration, and venue configuration continuity satisfy the normal deployment policy');
  if (stage === 'limited' && reasons.length === 0) reasons.push('only measured reliable command classes may enter the action-ready operator surface');
  if (stage === 'advisory' && reasons.length === 0) reasons.push('recommendations may be shown for review, but measured support or venue continuity is not mature enough for action-ready status');
  if (stage === 'shadow' && reasons.length === 0) reasons.push('recommendations remain shadow-only until evidence supports operator exposure');

  const overconfidentCommandIds = new Set(
    (input.recommendationCalibration?.commands ?? [])
      .filter((command) => command.meanConfidence - command.positiveRate > 0.2 || command.calibrationGap > 0.22)
      .map((command) => command.commandId),
  );
  const eligibleCommandIds = stage === 'operational'
    ? input.recommendationReliability
      .filter((item) => (item.status === 'reliable' || item.status === 'mixed') && !overconfidentCommandIds.has(item.commandId))
      .map((item) => item.commandId)
      .sort()
    : stage === 'limited'
      ? reliableCommands.filter((item) => !overconfidentCommandIds.has(item.commandId)).map((item) => item.commandId).sort()
      : [];
  const blockedCommandIds = [...new Set([
    ...weakCommands.map((item) => item.commandId),
    ...(stage === 'limited' ? mixedCommands.map((item) => item.commandId) : []),
    ...overconfidentCommandIds,
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
    calibrationBand,
    configurationImpactLevel,
    reasons,
  };
}
