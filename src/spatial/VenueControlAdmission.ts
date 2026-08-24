import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueDeploymentPolicyState } from './VenueDeploymentPolicy';
import type { VenueFallbackState } from './VenueFallbackMode';
import type { VenueLayoutCompatibility } from './VenueLayoutVersioning';
import type { VenueLoadSheddingState } from './VenueLoadShedding';
import type { VenueModelCredibilityState } from './VenueModelCredibility';
import type { VenueReadinessState } from './VenueReadiness';
import type { VenueSensorHealthState } from './VenueSensorHealth';
import type { VenueServiceObjectiveState } from './VenueServiceObjective';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';

export type ControlAdmission = 'allow' | 'review' | 'block';

export interface VenueControlContext {
  quorum?: VenueSourceQuorumState;
  credibility?: VenueModelCredibilityState;
  readiness?: VenueReadinessState;
  fallback?: VenueFallbackState;
  loadShedding?: VenueLoadSheddingState;
  serviceObjective?: VenueServiceObjectiveState;
  sensorHealth?: VenueSensorHealthState;
  deployment?: VenueDeploymentPolicyState;
}

export interface VenueControlAdmissionResult {
  decision: ControlAdmission;
  score: number;
  reasons: string[];
  blockingReasons: string[];
  reviewReasons: string[];
  evidenceScores: {
    command: number;
    telemetry: number;
    quorum: number | null;
    credibility: number | null;
    readiness: number | null;
    serviceObjective: number | null;
    sensorAuthority: number | null;
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Final admission boundary for organizer actions. Recommendation generation is
 * intentionally separated from permission to act. An analytically plausible
 * command can still be blocked by stale telemetry, incompatible geometry,
 * insufficient sensing support, weak model credibility, defensive fallback,
 * deployment maturity, or service degradation.
 *
 * The context argument is optional to preserve compatibility with earlier
 * callers, but production organizer surfaces should provide the full context.
 */
export function admitVenueControl(
  command: OrganizerCommand,
  telemetry: VenueTelemetryIntegrity,
  layout: VenueLayoutCompatibility,
  context: VenueControlContext = {},
): VenueControlAdmissionResult {
  const blockingReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (!layout.compatible) blockingReasons.push(...layout.reasons);
  if (telemetry.level === 'unsafe') blockingReasons.push(...telemetry.reasons);
  else if (telemetry.level === 'degraded') reviewReasons.push(...telemetry.reasons);

  if (command.confidence < 0.45) blockingReasons.push('Command confidence is below the minimum admission floor.');
  else if (command.confidence < 0.7) reviewReasons.push('Command confidence requires explicit operator review.');

  if (context.quorum?.state === 'lost') blockingReasons.push('Independent sensing quorum is lost.');
  else if (context.quorum?.state === 'degraded') reviewReasons.push('Independent sensing quorum is degraded.');

  if (context.credibility?.band === 'insufficient') blockingReasons.push('Venue model credibility is insufficient for operational decision support.');
  else if (context.credibility?.band === 'provisional') reviewReasons.push('Venue model credibility is provisional.');

  if (context.readiness?.level === 'not-ready') blockingReasons.push(...context.readiness.reasons);
  else if (context.readiness?.level === 'monitor') reviewReasons.push(...context.readiness.reasons);

  if (context.fallback?.mode === 'telemetry-hold' || context.fallback?.mode === 'manual-confirmation') {
    blockingReasons.push(context.fallback.explanation);
  } else if (context.fallback?.mode === 'advisory-only') {
    reviewReasons.push(context.fallback.explanation);
  }

  if (context.loadShedding?.tier === 'freeze') blockingReasons.push(...context.loadShedding.reasons);
  else if (context.loadShedding?.tier === 'protective' || context.loadShedding?.tier === 'constrained') {
    reviewReasons.push(...context.loadShedding.reasons);
  }

  if (context.serviceObjective && context.serviceObjective.objectiveScore < 0.45) {
    blockingReasons.push('Venue operations service objectives are below the control floor.');
  } else if (context.serviceObjective && context.serviceObjective.objectiveScore < 0.7) {
    reviewReasons.push(...context.serviceObjective.breaches);
  }

  if (context.sensorHealth) {
    if (context.sensorHealth.effectiveSourceWeight < 0.55) {
      blockingReasons.push('Effective sensing authority is below one-half healthy source equivalent.');
    } else if (context.sensorHealth.quarantinedSourceIds.length > 0 || context.sensorHealth.effectiveSourceWeight < 1) {
      reviewReasons.push(...context.sensorHealth.reasons);
    }
  }

  if (context.deployment) {
    if (!context.deployment.allowOperatorSurface) {
      blockingReasons.push('Venue recommendation logic is still in shadow deployment and is not eligible for the operator surface.');
    } else if (!context.deployment.allowActionReadyRecommendations) {
      reviewReasons.push('Current deployment stage permits advisory review but not action-ready recommendations.');
    } else if (
      context.deployment.eligibleCommandIds.length > 0
      && !context.deployment.eligibleCommandIds.includes(command.id)
    ) {
      reviewReasons.push('This command has not yet earned action-ready status from measured recommendation reliability.');
    }
    if (context.deployment.blockedCommandIds.includes(command.id)) {
      blockingReasons.push('Measured recommendation reliability explicitly blocks this command class from expanded authority.');
    }
  }

  const quorumScore = context.quorum?.confidence ?? null;
  const credibilityScore = context.credibility?.score ?? null;
  const readinessScore = context.readiness?.score ?? null;
  const serviceScore = context.serviceObjective?.objectiveScore ?? null;
  const sensorAuthority = context.sensorHealth === undefined
    ? null
    : clamp01(context.sensorHealth.effectiveSourceWeight / 2);

  const optionalScores = [quorumScore, credibilityScore, readinessScore, serviceScore, sensorAuthority]
    .filter((value): value is number => value !== null);
  const optionalMean = optionalScores.length === 0
    ? 1
    : optionalScores.reduce((sum, value) => sum + value, 0) / optionalScores.length;
  const score = clamp01(
    command.confidence * 0.34
    + telemetry.score * 0.28
    + optionalMean * 0.3
    + (layout.compatible ? 0.08 : 0),
  );

  let decision: ControlAdmission = 'allow';
  if (blockingReasons.length > 0 || score < 0.5) decision = 'block';
  else if (reviewReasons.length > 0 || score < 0.76) decision = 'review';

  const reasons = decision === 'block'
    ? [...new Set(blockingReasons)]
    : decision === 'review'
      ? [...new Set(reviewReasons.length > 0 ? reviewReasons : ['Evidence is usable, but operator review is required before action.'])]
      : ['Telemetry, layout compatibility, command evidence, and available operational guardrails satisfy control admission.'];

  return {
    decision,
    score,
    reasons,
    blockingReasons: [...new Set(blockingReasons)],
    reviewReasons: [...new Set(reviewReasons)],
    evidenceScores: {
      command: clamp01(command.confidence),
      telemetry: clamp01(telemetry.score),
      quorum: quorumScore === null ? null : clamp01(quorumScore),
      credibility: credibilityScore === null ? null : clamp01(credibilityScore),
      readiness: readinessScore === null ? null : clamp01(readinessScore),
      serviceObjective: serviceScore === null ? null : clamp01(serviceScore),
      sensorAuthority,
    },
  };
}
