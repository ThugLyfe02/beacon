import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';

export interface VenueServiceObjectiveInput {
  telemetry: VenueTelemetryIntegrity;
  quorum: VenueSourceQuorumState;
  activeRecommendations: number;
  recommendationLatencyMs: number;
  snapshotAgeMs: number;
  now?: number;
}

export interface VenueServiceObjectiveState {
  availability: number;
  freshness: number;
  recommendationLatency: number;
  controlHeadroom: number;
  objectiveScore: number;
  breaches: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Treats the organizer layer like an operational service with measurable SLOs.
 * A digital twin is not production-grade if it cannot say when it is too stale,
 * too slow, or too saturated to provide useful guidance.
 */
export function evaluateVenueServiceObjective(input: VenueServiceObjectiveInput): VenueServiceObjectiveState {
  const availability = input.telemetry.level === 'good' && input.quorum.state === 'healthy'
    ? 1
    : input.telemetry.level === 'unsafe' || input.quorum.state === 'lost'
      ? 0.25
      : 0.65;
  const freshness = clamp01(1 - input.snapshotAgeMs / 30_000);
  const recommendationLatency = clamp01(1 - input.recommendationLatencyMs / 2_000);
  const controlHeadroom = clamp01(1 - input.activeRecommendations / 6);
  const objectiveScore = clamp01(
    availability * 0.35 + freshness * 0.3 + recommendationLatency * 0.2 + controlHeadroom * 0.15,
  );

  const breaches: string[] = [];
  if (availability < 0.8) breaches.push('venue operations availability below target');
  if (freshness < 0.65) breaches.push('venue snapshot freshness below target');
  if (recommendationLatency < 0.6) breaches.push('operator recommendation latency above target');
  if (controlHeadroom < 0.35) breaches.push('too many concurrent recommendations for a stable control surface');

  return { availability, freshness, recommendationLatency, controlHeadroom, objectiveScore, breaches };
}
