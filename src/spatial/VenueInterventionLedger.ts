import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type InterventionStatus = 'proposed' | 'accepted' | 'applied' | 'observing' | 'reverted' | 'measured';

export interface InterventionRecord {
  id: string;
  commandId: string;
  createdAt: number;
  acceptedAt?: number;
  appliedAt?: number;
  observingAt?: number;
  measuredAt?: number;
  revertedAt?: number;
  status: InterventionStatus;
  targetZoneIds: string[];
  baseline: {
    saturatedZoneCount: number;
    activeZoneCount: number;
    overallConfidence: number;
    meanOccupancyRatio: number;
  };
  outcome?: {
    saturatedZoneCount: number;
    activeZoneCount: number;
    overallConfidence: number;
    meanOccupancyRatio: number;
    bottleneckDelta: number;
    occupancyPressureDelta: number;
  };
  rationale: string;
  rollbackCondition?: string;
  operatorNote?: string;
}

function meanOccupancy(snapshot: VenueTwinSnapshot): number {
  if (snapshot.zones.length === 0) return 0;
  return snapshot.zones.reduce((sum, zone) => sum + zone.occupancyRatio, 0) / snapshot.zones.length;
}

export function createInterventionRecord(
  command: OrganizerCommand,
  baseline: VenueTwinSnapshot,
  now = Date.now(),
): InterventionRecord {
  return {
    id: `${command.id}:${now}`,
    commandId: command.id,
    createdAt: now,
    status: 'proposed',
    targetZoneIds: command.targetZoneIds,
    baseline: {
      saturatedZoneCount: baseline.saturatedZoneCount,
      activeZoneCount: baseline.activeZoneCount,
      overallConfidence: baseline.overallConfidence,
      meanOccupancyRatio: meanOccupancy(baseline),
    },
    rationale: command.rationale,
    rollbackCondition: 'Revert if target-zone pressure worsens materially or measurement confidence falls below the declared threshold.',
  };
}

export function acceptIntervention(
  record: InterventionRecord,
  now = Date.now(),
  operatorNote?: string,
): InterventionRecord {
  if (record.status !== 'proposed') return record;
  return { ...record, status: 'accepted', acceptedAt: now, operatorNote: operatorNote ?? record.operatorNote };
}

export function markInterventionApplied(
  record: InterventionRecord,
  now = Date.now(),
): InterventionRecord {
  if (record.status !== 'accepted' && record.status !== 'proposed') return record;
  return { ...record, status: 'applied', appliedAt: now };
}

export function markInterventionObserving(
  record: InterventionRecord,
  now = Date.now(),
): InterventionRecord {
  if (record.status !== 'applied') return record;
  return { ...record, status: 'observing', observingAt: now };
}

export function revertIntervention(
  record: InterventionRecord,
  now = Date.now(),
  operatorNote?: string,
): InterventionRecord {
  if (record.status === 'measured' || record.status === 'reverted') return record;
  return {
    ...record,
    status: 'reverted',
    revertedAt: now,
    operatorNote: operatorNote ?? record.operatorNote,
  };
}

export function measureIntervention(
  record: InterventionRecord,
  after: VenueTwinSnapshot,
  now = Date.now(),
): InterventionRecord {
  if (record.status !== 'applied' && record.status !== 'observing') return record;
  const afterMean = meanOccupancy(after);
  return {
    ...record,
    status: 'measured',
    measuredAt: now,
    outcome: {
      saturatedZoneCount: after.saturatedZoneCount,
      activeZoneCount: after.activeZoneCount,
      overallConfidence: after.overallConfidence,
      meanOccupancyRatio: afterMean,
      bottleneckDelta: after.saturatedZoneCount - record.baseline.saturatedZoneCount,
      occupancyPressureDelta: afterMean - record.baseline.meanOccupancyRatio,
    },
  };
}

/**
 * The ledger exists so Beacon can learn from what operators actually did, not
 * merely what the software suggested. Records are aggregate, reversible and
 * auditable; they never contain attendee-level trajectories.
 */
export function interventionEffectScore(record: InterventionRecord): number | null {
  if (!record.outcome) return null;
  const bottleneckImprovement = Math.max(-1, Math.min(1, -record.outcome.bottleneckDelta / 3));
  const pressureImprovement = Math.max(-1, Math.min(1, -record.outcome.occupancyPressureDelta * 2));
  return Math.max(-1, Math.min(1, bottleneckImprovement * 0.65 + pressureImprovement * 0.35));
}
