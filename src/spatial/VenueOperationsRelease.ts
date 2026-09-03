export type VenueOperationsReleaseState = 'current' | 'stale' | 'incompatible';

export interface VenueOperationsRelease {
  releaseId: string;
  eventId: string;
  venueId: string;
  venueKey: string;
  layoutVersion: string;
  geometryHash: string;
  observationSchemaVersion: string;
  policyVersion: string;
  modelVersion: string;
  activatedAt: number;
  expiresAt?: number;
  retiredAt?: number;
}

export interface VenueOperationsRuntimeIdentity {
  eventId: string;
  venueId: string;
  layoutVersion: string;
  geometryHash: string;
  observationSchemaVersion: string;
  policyVersion: string;
  modelVersion: string;
  eventOperational: boolean;
}

export interface VenueOperationsReleaseAssessment {
  state: VenueOperationsReleaseState;
  canAdmitCommands: boolean;
  requiresNewBaseline: boolean;
  requiresReadmission: boolean;
  releaseAgeMs: number;
  blockers: string[];
  reasons: string[];
}

function stableToken(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildVenueOperationsRelease(input: Omit<VenueOperationsRelease, 'releaseId'>): VenueOperationsRelease {
  const material = [
    input.eventId,
    input.venueId,
    input.layoutVersion,
    input.geometryHash,
    input.observationSchemaVersion,
    input.policyVersion,
    input.modelVersion,
    String(input.activatedAt),
  ].join('|');

  return {
    ...input,
    releaseId: `venue-release:${stableToken(material)}`,
  };
}

/**
 * Pins the control plane to one explicit release identity for the duration of a
 * live operating window. Model, policy, observation-schema, and layout changes
 * are not treated as harmless implementation details: they can invalidate the
 * evidence that made an existing recommendation admissible.
 *
 * A release mismatch never silently falls back to the newest code. Layout or
 * observation-schema changes require a fresh baseline; policy/model changes
 * require fresh admission. This prevents mid-event hot swaps from inheriting
 * authority earned by a materially different runtime.
 */
export function assessVenueOperationsRelease(
  release: VenueOperationsRelease,
  runtime: VenueOperationsRuntimeIdentity,
  now = Date.now(),
): VenueOperationsReleaseAssessment {
  const blockers: string[] = [];
  let requiresNewBaseline = false;
  let requiresReadmission = false;

  if (release.eventId !== runtime.eventId) blockers.push('release is bound to a different event');
  if (release.venueId !== runtime.venueId) blockers.push('release is bound to a different venue');
  if (!runtime.eventOperational) blockers.push('event is no longer operational');
  if (release.retiredAt !== undefined && release.retiredAt <= now) blockers.push('operations release has been retired');
  if (release.expiresAt !== undefined && release.expiresAt <= now) blockers.push('operations release has expired');

  if (release.layoutVersion !== runtime.layoutVersion) {
    blockers.push('venue layout version changed after release activation');
    requiresNewBaseline = true;
  }
  if (release.geometryHash !== runtime.geometryHash) {
    blockers.push('venue geometry changed after release activation');
    requiresNewBaseline = true;
  }
  if (release.observationSchemaVersion !== runtime.observationSchemaVersion) {
    blockers.push('observation schema changed after release activation');
    requiresNewBaseline = true;
  }
  if (release.policyVersion !== runtime.policyVersion) {
    blockers.push('control policy version changed after release activation');
    requiresReadmission = true;
  }
  if (release.modelVersion !== runtime.modelVersion) {
    blockers.push('venue model version changed after release activation');
    requiresReadmission = true;
  }

  const releaseAgeMs = Math.max(0, now - release.activatedAt);
  const state: VenueOperationsReleaseState = blockers.length === 0
    ? 'current'
    : requiresNewBaseline || requiresReadmission || blockers.some((reason) => reason.includes('different'))
      ? 'incompatible'
      : 'stale';

  return {
    state,
    canAdmitCommands: state === 'current',
    requiresNewBaseline,
    requiresReadmission,
    releaseAgeMs,
    blockers: [...new Set(blockers)],
    reasons: blockers.length === 0
      ? ['runtime identity matches the pinned venue operations release']
      : [...new Set(blockers)],
  };
}
