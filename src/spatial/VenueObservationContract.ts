import type { VenueSourceVote } from './VenueSourceQuorum';

export const VENUE_OBSERVATION_SCHEMA_VERSION = '1.0' as const;

export type VenueObservationKind = 'occupancy' | 'transition' | 'service-point' | 'manual-confirmation';

interface VenueObservationBase {
  schemaVersion: typeof VENUE_OBSERVATION_SCHEMA_VERSION;
  kind: VenueObservationKind;
  venueId: string;
  layoutVersion: string;
  sourceId: string;
  sourceKind: VenueSourceVote['sourceKind'];
  observedAt: number;
  receivedAt: number;
  sequence: number;
  confidence: number;
}

export interface VenueOccupancyObservation extends VenueObservationBase {
  kind: 'occupancy';
  payload: {
    zoneId: string;
    occupancy: number;
    sampleSupport: number;
  };
}

export interface VenueTransitionObservation extends VenueObservationBase {
  kind: 'transition';
  payload: {
    fromZoneId: string;
    toZoneId: string;
    support: number;
    sampleSupport: number;
  };
}

export interface VenueServicePointObservation extends VenueObservationBase {
  kind: 'service-point';
  payload: {
    servicePointId: string;
    zoneId: string;
    queueLength: number;
    arrivals: number;
    completions: number;
    windowMinutes: number;
    sampleSupport: number;
  };
}

export interface VenueManualConfirmationObservation extends VenueObservationBase {
  kind: 'manual-confirmation';
  payload: {
    zoneId: string;
    assertion: 'open' | 'closed' | 'constrained' | 'normal';
    operatorRole: 'organizer' | 'venue-ops' | 'security' | 'staff';
  };
}

export type VenueObservation =
  | VenueOccupancyObservation
  | VenueTransitionObservation
  | VenueServicePointObservation
  | VenueManualConfirmationObservation;

export interface VenueObservationValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  observationKey: string;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function safeToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 96);
}

export function venueObservationKey(observation: VenueObservation): string {
  return [
    safeToken(observation.venueId),
    safeToken(observation.layoutVersion),
    safeToken(observation.sourceId),
    observation.kind,
    String(observation.sequence),
    String(observation.observedAt),
  ].join(':');
}

/**
 * Validates the transport and semantic envelope before observations enter the
 * venue twin. This contract is deliberately boring: schema version, source,
 * time, sequence, confidence, layout identity, and aggregate payload are kept
 * explicit so BLE/Wi-Fi/camera/edge adapters can evolve without silently
 * changing the meaning of venue state.
 */
export function validateVenueObservation(
  observation: VenueObservation,
  knownZoneIds: ReadonlySet<string>,
  expectedVenueId: string,
  expectedLayoutVersion: string,
  now = Date.now(),
): VenueObservationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (observation.schemaVersion !== VENUE_OBSERVATION_SCHEMA_VERSION) errors.push('unsupported venue observation schema version');
  if (observation.venueId !== expectedVenueId) errors.push('observation venue identity does not match the active venue');
  if (observation.layoutVersion !== expectedLayoutVersion) errors.push('observation layout version does not match the active venue layout');
  if (!observation.sourceId.trim()) errors.push('source id is required');
  if (!Number.isInteger(observation.sequence) || observation.sequence < 0) errors.push('sequence must be a non-negative integer');
  if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) errors.push('confidence must be in [0, 1]');
  if (!Number.isFinite(observation.observedAt) || !Number.isFinite(observation.receivedAt)) errors.push('observation timestamps must be finite');
  if (observation.receivedAt < observation.observedAt) warnings.push('receivedAt precedes observedAt; source clock alignment should be reviewed');
  if (observation.observedAt > now + 5_000) errors.push('observation timestamp is materially in the future');
  if (now - observation.observedAt > 120_000) warnings.push('observation is older than the normal live-operations window');

  switch (observation.kind) {
    case 'occupancy':
      if (!knownZoneIds.has(observation.payload.zoneId)) errors.push('occupancy observation references an unknown zone');
      if (!finiteNonNegative(observation.payload.occupancy)) errors.push('occupancy must be non-negative');
      if (!finiteNonNegative(observation.payload.sampleSupport)) errors.push('occupancy sample support must be non-negative');
      break;
    case 'transition':
      if (!knownZoneIds.has(observation.payload.fromZoneId) || !knownZoneIds.has(observation.payload.toZoneId)) {
        errors.push('transition observation references an unknown zone');
      }
      if (observation.payload.fromZoneId === observation.payload.toZoneId) errors.push('transition endpoints must be different zones');
      if (!finiteNonNegative(observation.payload.support)) errors.push('transition support must be non-negative');
      if (!finiteNonNegative(observation.payload.sampleSupport)) errors.push('transition sample support must be non-negative');
      break;
    case 'service-point':
      if (!knownZoneIds.has(observation.payload.zoneId)) errors.push('service-point observation references an unknown zone');
      if (!observation.payload.servicePointId.trim()) errors.push('service point id is required');
      if (!finiteNonNegative(observation.payload.queueLength)) errors.push('queue length must be non-negative');
      if (!finiteNonNegative(observation.payload.arrivals)) errors.push('arrival count must be non-negative');
      if (!finiteNonNegative(observation.payload.completions)) errors.push('completion count must be non-negative');
      if (!Number.isFinite(observation.payload.windowMinutes) || observation.payload.windowMinutes <= 0) errors.push('service-point observation window must be positive');
      if (!finiteNonNegative(observation.payload.sampleSupport)) errors.push('service-point sample support must be non-negative');
      break;
    case 'manual-confirmation':
      if (!knownZoneIds.has(observation.payload.zoneId)) errors.push('manual confirmation references an unknown zone');
      break;
    default: {
      const exhaustive: never = observation;
      void exhaustive;
    }
  }

  if (observation.confidence < 0.55) warnings.push('observation confidence is below the preferred operating floor');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    observationKey: venueObservationKey(observation),
  };
}
