import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueControlAdmissionResult } from './VenueControlAdmission';
import type { VenueLayoutVersion } from './VenueLayoutVersioning';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';

export interface VenueCommandLease {
  id: string;
  commandId: string;
  venueId: string;
  layoutVersion: string;
  geometryHash: string;
  issuedAt: number;
  expiresAt: number;
  minimumTelemetryScore: number;
  admissionDecision: VenueControlAdmissionResult['decision'];
  admissionScore: number;
}

export interface VenueCommandLeaseValidation {
  valid: boolean;
  reasons: string[];
  remainingMs: number;
}

/**
 * Binds an action-ready recommendation to the venue state that justified it.
 * The lease expires quickly because a correct recommendation can become wrong as
 * the room changes. Expiry is shorter for review-only recommendations and for
 * lower-confidence telemetry. This prevents stale UI from retaining operational
 * authority after its evidence has moved on.
 */
export function issueVenueCommandLease(
  command: OrganizerCommand,
  admission: VenueControlAdmissionResult,
  telemetry: VenueTelemetryIntegrity,
  layout: VenueLayoutVersion,
  now = Date.now(),
): VenueCommandLease {
  const baseTtlMs = admission.decision === 'allow' ? 45_000 : 20_000;
  const telemetryFactor = Math.max(0.4, Math.min(1, telemetry.score));
  const ttlMs = Math.max(8_000, Math.round(baseTtlMs * telemetryFactor));
  const minimumTelemetryScore = Math.max(0.45, Math.min(0.82, telemetry.score - 0.12));

  return {
    id: `${command.id}:${layout.version}:${now}`,
    commandId: command.id,
    venueId: layout.venueId,
    layoutVersion: layout.version,
    geometryHash: layout.geometryHash,
    issuedAt: now,
    expiresAt: now + ttlMs,
    minimumTelemetryScore,
    admissionDecision: admission.decision,
    admissionScore: admission.score,
  };
}

export function validateVenueCommandLease(
  lease: VenueCommandLease,
  command: OrganizerCommand,
  telemetry: VenueTelemetryIntegrity,
  layout: VenueLayoutVersion,
  now = Date.now(),
): VenueCommandLeaseValidation {
  const reasons: string[] = [];
  const remainingMs = Math.max(0, lease.expiresAt - now);

  if (lease.commandId !== command.id) reasons.push('lease does not belong to this command');
  if (lease.venueId !== layout.venueId) reasons.push('venue identity changed after command admission');
  if (lease.layoutVersion !== layout.version) reasons.push('venue layout version changed after command admission');
  if (lease.geometryHash !== layout.geometryHash) reasons.push('venue geometry changed after command admission');
  if (now >= lease.expiresAt) reasons.push('command lease expired and must be re-evaluated against current venue state');
  if (telemetry.level === 'unsafe') reasons.push('telemetry became unsafe after command admission');
  if (telemetry.score < lease.minimumTelemetryScore) reasons.push('telemetry quality fell below the lease floor');
  if (lease.admissionDecision === 'block') reasons.push('blocked recommendations cannot acquire executable authority');

  return {
    valid: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : ['command lease remains bound to current venue geometry and telemetry quality'],
    remainingMs,
  };
}
