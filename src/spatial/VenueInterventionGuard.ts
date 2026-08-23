import type { InterventionRecord } from './VenueInterventionLedger';
import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export interface InterventionGuardPolicy {
  minimumMinutesBetweenZoneChanges: number;
  minimumMeasurementMinutes: number;
  minimumConfidence: number;
  minimumPriorityDeltaToOverride: number;
}

export interface InterventionGuardDecision {
  allowed: boolean;
  reasons: string[];
  blockedByRecordIds: string[];
}

function minutesSince(timestamp: number | undefined, now: number): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - timestamp) / 60_000;
}

export function evaluateInterventionGuard(
  command: OrganizerCommand,
  records: InterventionRecord[],
  snapshot: VenueTwinSnapshot,
  policy: InterventionGuardPolicy,
  now = Date.now(),
): InterventionGuardDecision {
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (command.confidence < policy.minimumConfidence) reasons.push('Command confidence is below the intervention threshold.');
  if (snapshot.overallConfidence < policy.minimumConfidence) reasons.push('Venue confidence is below the intervention threshold.');

  const targetSet = new Set(command.targetZoneIds);
  const recent = records.filter((record) =>
    record.status === 'applied'
      && record.targetZoneIds.some((zoneId) => targetSet.has(zoneId)),
  );

  for (const record of recent) {
    const age = minutesSince(record.appliedAt, now);
    if (age < policy.minimumMinutesBetweenZoneChanges) {
      blockers.push(record.id);
      reasons.push(`Zone intervention cooldown is active for ${Math.ceil(policy.minimumMinutesBetweenZoneChanges - age)} more minute(s).`);
    }
    if (age < policy.minimumMeasurementMinutes) {
      blockers.push(record.id);
      reasons.push('A prior intervention is still inside its minimum observation window.');
    }
  }

  const competing = records
    .filter((record) => record.status === 'proposed' || record.status === 'accepted')
    .filter((record) => record.targetZoneIds.some((zoneId) => targetSet.has(zoneId)));

  for (const record of competing) {
    if (record.commandId === command.id) continue;
    blockers.push(record.id);
    reasons.push('Another unresolved command is already targeting one or more of the same zones.');
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    blockedByRecordIds: [...new Set(blockers)],
  };
}
