import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { InterventionRecord } from './VenueInterventionLedger';

export interface SponsorEvidenceItem {
  id: string;
  zoneId: string;
  label: string;
  evidenceType: 'activation' | 'flow' | 'intervention';
  value: number;
  confidence: number;
  sampleSupport: number;
}

export interface SponsorEvidenceReport {
  venueId: string;
  generatedAt: number;
  items: SponsorEvidenceItem[];
  reportable: boolean;
  minimumConfidence: number;
  narrative: string;
}

const MIN_CONFIDENCE = 0.65;
const MIN_SUPPORT = 5;

/**
 * Produces sponsor-facing evidence only from aggregate venue state and measured
 * interventions. The ledger deliberately refuses to convert thin data into a
 * marketing claim: unsupported zones stay out of the report.
 */
export function buildSponsorEvidenceReport(
  snapshot: VenueTwinSnapshot,
  interventions: InterventionRecord[],
): SponsorEvidenceReport {
  const items: SponsorEvidenceItem[] = [];

  for (const zone of snapshot.zones) {
    if (zone.confidence < MIN_CONFIDENCE || zone.visibleOccupancy < MIN_SUPPORT) continue;
    items.push({
      id: `activation:${zone.id}`,
      zoneId: zone.id,
      label: `${zone.label} activation`,
      evidenceType: 'activation',
      value: zone.occupancyRatio,
      confidence: zone.confidence,
      sampleSupport: zone.visibleOccupancy,
    });
  }

  for (const transition of snapshot.transitions) {
    if (transition.confidence < MIN_CONFIDENCE || transition.support < MIN_SUPPORT) continue;
    items.push({
      id: `flow:${transition.id}`,
      zoneId: transition.toZoneId,
      label: `Aggregate flow ${transition.fromZoneId} → ${transition.toZoneId}`,
      evidenceType: 'flow',
      value: transition.support,
      confidence: transition.confidence,
      sampleSupport: transition.support,
    });
  }

  for (const record of interventions) {
    if (record.status !== 'measured' || !record.outcome) continue;
    const effect = Math.max(-1, Math.min(1, -record.outcome.bottleneckDelta * 0.5 - record.outcome.occupancyPressureDelta));
    for (const zoneId of record.targetZoneIds) {
      items.push({
        id: `intervention:${record.id}:${zoneId}`,
        zoneId,
        label: 'Measured operator intervention effect',
        evidenceType: 'intervention',
        value: effect,
        confidence: record.outcome.overallConfidence,
        sampleSupport: Math.max(MIN_SUPPORT, record.baseline.activeZoneCount + record.baseline.saturatedZoneCount),
      });
    }
  }

  items.sort((a, b) => b.confidence - a.confidence || b.sampleSupport - a.sampleSupport || a.id.localeCompare(b.id));
  const reportable = items.some((item) => item.confidence >= MIN_CONFIDENCE && item.sampleSupport >= MIN_SUPPORT);

  return {
    venueId: snapshot.venueId,
    generatedAt: snapshot.generatedAt,
    items,
    reportable,
    minimumConfidence: MIN_CONFIDENCE,
    narrative: reportable
      ? `${items.length} aggregate evidence item${items.length === 1 ? '' : 's'} meet Beacon's sponsor-reporting threshold.`
      : 'Beacon does not yet have enough aggregate evidence to produce a sponsor claim for this venue state.',
  };
}
