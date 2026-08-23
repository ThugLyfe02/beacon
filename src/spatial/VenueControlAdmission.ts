import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';
import type { VenueLayoutCompatibility } from './VenueLayoutVersioning';

export type ControlAdmission = 'allow' | 'review' | 'block';

export interface VenueControlAdmissionResult {
  decision: ControlAdmission;
  score: number;
  reasons: string[];
}

/**
 * Final admission boundary for organizer actions. Recommendation generation is
 * intentionally separated from permission to act. A command can be analytically
 * plausible and still be blocked because the underlying venue state is stale,
 * temporally incoherent, or no longer comparable to the baseline geometry.
 */
export function admitVenueControl(
  command: OrganizerCommand,
  telemetry: VenueTelemetryIntegrity,
  layout: VenueLayoutCompatibility,
): VenueControlAdmissionResult {
  const reasons: string[] = [];
  if (!layout.compatible) reasons.push(...layout.reasons);
  if (telemetry.level === 'unsafe') reasons.push(...telemetry.reasons);
  if (command.confidence < 0.55) reasons.push('Command confidence is below the operational floor.');

  const score = Math.max(0, Math.min(1, command.confidence * 0.55 + telemetry.score * 0.45));
  if (!layout.compatible || telemetry.level === 'unsafe' || command.confidence < 0.45) {
    return { decision: 'block', score, reasons };
  }
  if (telemetry.level === 'degraded' || command.confidence < 0.7 || score < 0.72) {
    return {
      decision: 'review',
      score,
      reasons: reasons.length > 0 ? reasons : ['Evidence is usable, but operator review is required before action.'],
    };
  }
  return {
    decision: 'allow',
    score,
    reasons: ['Telemetry, layout compatibility, and command confidence satisfy the control admission policy.'],
  };
}
