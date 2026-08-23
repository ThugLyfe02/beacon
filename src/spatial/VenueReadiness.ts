import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';

export type VenueReadinessLevel = 'not-ready' | 'monitor' | 'operational';

export interface VenueReadinessState {
  level: VenueReadinessLevel;
  score: number;
  reasons: string[];
}

/**
 * Explicit readiness gate for the venue twin. The system should not enter an
 * operator-guidance posture simply because data exists; it needs enough zones,
 * confidence and telemetry coherence to support a trustworthy control loop.
 */
export function assessVenueReadiness(
  snapshot: VenueTwinSnapshot,
  telemetry: VenueTelemetryIntegrity,
): VenueReadinessState {
  const zoneCoverage = Math.min(1, snapshot.zones.length / 4);
  const confidence = Math.max(0, Math.min(1, snapshot.overallConfidence));
  const telemetryScore = telemetry.score;
  const score = Math.max(0, Math.min(1, zoneCoverage * 0.25 + confidence * 0.4 + telemetryScore * 0.35));

  const reasons: string[] = [];
  if (snapshot.zones.length < 2) reasons.push('Venue model does not yet cover enough semantic zones.');
  if (snapshot.overallConfidence < 0.6) reasons.push('Venue confidence is below the operational threshold.');
  if (telemetry.level !== 'good') reasons.push(...telemetry.reasons);

  if (score >= 0.82 && telemetry.level === 'good' && snapshot.zones.length >= 2) {
    return { level: 'operational', score, reasons: ['Venue model and telemetry are ready for operator guidance.'] };
  }
  if (score >= 0.55) {
    return { level: 'monitor', score, reasons: reasons.length > 0 ? reasons : ['Continue observation before enabling operator guidance.'] };
  }
  return { level: 'not-ready', score, reasons: reasons.length > 0 ? reasons : ['Insufficient evidence for venue operations.'] };
}
