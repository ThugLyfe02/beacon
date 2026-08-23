import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { InterventionRecord } from './VenueInterventionLedger';
import type { VenueDecisionRecord } from './VenueDecisionJournal';

export type VenueReplayEventKind = 'snapshot' | 'decision' | 'intervention-applied' | 'intervention-measured' | 'intervention-reverted';

export interface VenueReplayEvent {
  id: string;
  at: number;
  kind: VenueReplayEventKind;
  label: string;
  detail: string;
}

export interface VenueReplayState {
  events: VenueReplayEvent[];
  firstAt: number | null;
  lastAt: number | null;
  durationMs: number;
}

/**
 * Builds an operator-facing chronology from aggregate snapshots and intervention
 * records. It is intended for incident review, event debriefs, and measurement
 * audits. It contains no attendee-level movement history.
 */
export function buildVenueReplay(
  snapshots: VenueTwinSnapshot[],
  interventions: InterventionRecord[],
  decisions: VenueDecisionRecord[],
): VenueReplayState {
  const events: VenueReplayEvent[] = [];

  for (const snapshot of snapshots) {
    events.push({
      id: `snapshot:${snapshot.generatedAt}`,
      at: snapshot.generatedAt,
      kind: 'snapshot',
      label: `${snapshot.activeZoneCount} active / ${snapshot.saturatedZoneCount} saturated`,
      detail: snapshot.operationalNarrative,
    });
  }

  for (const decision of decisions) {
    events.push({
      id: `decision:${decision.id}`,
      at: decision.createdAt,
      kind: 'decision',
      label: `${decision.disposition} ${decision.commandId}`,
      detail: decision.note ?? decision.operatorReasonCode,
    });
  }

  for (const record of interventions) {
    if (record.appliedAt) {
      events.push({
        id: `applied:${record.id}`,
        at: record.appliedAt,
        kind: 'intervention-applied',
        label: `Applied ${record.commandId}`,
        detail: record.rationale,
      });
    }
    if (record.status === 'measured' && record.measuredAt && record.outcome) {
      events.push({
        id: `measured:${record.id}`,
        at: record.measuredAt,
        kind: 'intervention-measured',
        label: `Measured ${record.commandId}`,
        detail: `Bottleneck delta ${record.outcome.bottleneckDelta}; occupancy-pressure delta ${record.outcome.occupancyPressureDelta.toFixed(3)}.`,
      });
    }
    if (record.status === 'reverted' && record.measuredAt) {
      events.push({
        id: `reverted:${record.id}`,
        at: record.measuredAt,
        kind: 'intervention-reverted',
        label: `Reverted ${record.commandId}`,
        detail: record.operatorNote ?? 'Operator reverted the intervention.',
      });
    }
  }

  events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const firstAt = events[0]?.at ?? null;
  const lastAt = events[events.length - 1]?.at ?? null;

  return {
    events,
    firstAt,
    lastAt,
    durationMs: firstAt === null || lastAt === null ? 0 : Math.max(0, lastAt - firstAt),
  };
}
