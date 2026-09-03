import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export interface VenueLayoutVersion {
  venueId: string;
  version: string;
  effectiveFrom: number;
  effectiveTo?: number;
  geometryHash: string;
  zoneIds: string[];
  source: 'manual' | 'geojson' | 'bim';
}

export interface VenueLayoutCompatibility {
  compatible: boolean;
  reasons: string[];
}

/**
 * Prevents before/after measurement windows from silently spanning different
 * venue geometries. Digital-twin learning is only meaningful when the semantic
 * zone model used for the baseline still describes the physical venue being
 * measured afterwards.
 */
export function validateLayoutCompatibility(
  baseline: VenueLayoutVersion,
  current: VenueLayoutVersion,
  baselineSnapshot: VenueTwinSnapshot,
  currentSnapshot: VenueTwinSnapshot,
): VenueLayoutCompatibility {
  const reasons: string[] = [];
  if (baseline.venueId !== current.venueId) reasons.push('Venue identity changed between baseline and measurement.');
  if (baseline.geometryHash !== current.geometryHash) reasons.push('Venue geometry changed during the measurement window.');
  if (baseline.version !== current.version) reasons.push('Venue layout version changed during the measurement window.');

  const baselineZones = [...baseline.zoneIds].sort().join('|');
  const currentZones = [...current.zoneIds].sort().join('|');
  if (baselineZones !== currentZones) reasons.push('Semantic zone membership changed during the measurement window.');

  const baselineSnapshotZones = [...baselineSnapshot.zones.map((zone) => zone.id)].sort().join('|');
  const currentSnapshotZones = [...currentSnapshot.zones.map((zone) => zone.id)].sort().join('|');
  if (baselineSnapshotZones !== currentSnapshotZones) reasons.push('Observed snapshot zone sets are not comparable.');

  return {
    compatible: reasons.length === 0,
    reasons: reasons.length === 0 ? ['Baseline and current venue layouts are compatible.'] : reasons,
  };
}
