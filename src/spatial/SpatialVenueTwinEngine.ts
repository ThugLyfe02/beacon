import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';
import type { SpatialLandmarkState } from './SpatialLandmarkEngine';
import type { SpatialQualityState } from './SpatialQualityGovernor';
import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';

export type VenueTwinZoneKind = 'entry' | 'stage' | 'lounge' | 'booth' | 'corridor' | 'open';
export type VenueTwinZoneState = 'cold' | 'forming' | 'active' | 'saturated' | 'recovering';

export interface VenueTwinZone {
  id: string;
  label: string;
  kind: VenueTwinZoneKind;
  polygon: Array<[number, number]>;
  capacity: number;
  visibleOccupancy: number;
  occupancyRatio: number;
  state: VenueTwinZoneState;
  confidence: number;
  dwellPressure: number;
  ingressPressure: number;
  egressPressure: number;
}

export interface VenueTwinTransition {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  support: number;
  confidence: number;
  direction: 'rising' | 'stable' | 'falling';
}

export interface VenueTwinSnapshot {
  venueId: string;
  generatedAt: number;
  zones: VenueTwinZone[];
  transitions: VenueTwinTransition[];
  activeZoneCount: number;
  saturatedZoneCount: number;
  overallConfidence: number;
  operationalNarrative: string;
}

export interface VenueTwinInput {
  venueId: string;
  zoneDefinitions: Array<{
    id: string;
    label: string;
    kind: VenueTwinZoneKind;
    polygon: Array<[number, number]>;
    capacity: number;
    visibleOccupancy: number;
    previousVisibleOccupancy?: number;
  }>;
  transitionObservations?: Array<{
    fromZoneId: string;
    toZoneId: string;
    support: number;
    previousSupport?: number;
  }>;
  runtime: RuntimeReliabilitySnapshot;
  intelligence: SpatialWorldIntelligence;
  landmarks: SpatialLandmarkState;
  quality: SpatialQualityState;
  now?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function zoneState(ratio: number, delta: number, runtimeHealthy: boolean): VenueTwinZoneState {
  if (!runtimeHealthy) return 'recovering';
  if (ratio >= 0.92) return 'saturated';
  if (ratio >= 0.58) return 'active';
  if (ratio >= 0.24 || delta > 0) return 'forming';
  return 'cold';
}

/**
 * Builds an aggregate venue digital twin from explicit zone definitions and
 * privacy-preserving occupancy counts. It never stores identity-linked paths or
 * person-level trajectories; downstream systems consume zone aggregates only.
 */
export function buildSpatialVenueTwin(input: VenueTwinInput): VenueTwinSnapshot {
  const runtimeHealthy = input.runtime.health === 'healthy';
  const trust = clamp01(input.intelligence.trust.confidence);
  const qualityConfidence = input.quality.tier === 'recovery' ? 0.55 : input.quality.tier === 'efficient' ? 0.76 : 1;
  const landmarkConfidence = input.landmarks.landmarks.length === 0
    ? 0.6
    : input.landmarks.landmarks.reduce((sum, landmark) => sum + landmark.confidence, 0) / input.landmarks.landmarks.length;

  const zones = input.zoneDefinitions.map<VenueTwinZone>((zone) => {
    const capacity = Math.max(1, zone.capacity);
    const occupancy = Math.max(0, zone.visibleOccupancy);
    const previous = Math.max(0, zone.previousVisibleOccupancy ?? occupancy);
    const delta = occupancy - previous;
    const occupancyRatio = clamp01(occupancy / capacity);
    const confidence = clamp01((trust * 0.5 + landmarkConfidence * 0.25 + qualityConfidence * 0.25));

    return {
      id: zone.id,
      label: zone.label,
      kind: zone.kind,
      polygon: zone.polygon,
      capacity,
      visibleOccupancy: occupancy,
      occupancyRatio,
      state: zoneState(occupancyRatio, delta, runtimeHealthy),
      confidence,
      dwellPressure: clamp01(occupancyRatio * (delta <= 0 ? 1 : 0.76)),
      ingressPressure: clamp01(Math.max(0, delta) / Math.max(1, capacity * 0.2)),
      egressPressure: clamp01(Math.max(0, -delta) / Math.max(1, capacity * 0.2)),
    };
  });

  const transitions = (input.transitionObservations ?? []).map<VenueTwinTransition>((transition) => {
    const previous = Math.max(0, transition.previousSupport ?? transition.support);
    const delta = transition.support - previous;
    const confidence = clamp01(trust * 0.7 + qualityConfidence * 0.3);
    return {
      id: `${transition.fromZoneId}->${transition.toZoneId}`,
      fromZoneId: transition.fromZoneId,
      toZoneId: transition.toZoneId,
      support: Math.max(0, transition.support),
      confidence,
      direction: delta > 1 ? 'rising' : delta < -1 ? 'falling' : 'stable',
    };
  });

  const activeZoneCount = zones.filter((zone) => zone.state === 'active' || zone.state === 'saturated').length;
  const saturatedZoneCount = zones.filter((zone) => zone.state === 'saturated').length;
  const overallConfidence = zones.length === 0 ? 0 : zones.reduce((sum, zone) => sum + zone.confidence, 0) / zones.length;

  const operationalNarrative = saturatedZoneCount > 0
    ? `${saturatedZoneCount} venue zone${saturatedZoneCount === 1 ? '' : 's'} are at saturation pressure; Beacon should redistribute attention before adding more route energy.`
    : activeZoneCount > 0
      ? `${activeZoneCount} venue zone${activeZoneCount === 1 ? ' is' : 's are'} carrying sustained activity with enough confidence for aggregate operational guidance.`
      : 'The venue twin is still forming; Beacon should prefer observation over intervention.';

  return {
    venueId: input.venueId,
    generatedAt: input.now ?? Date.now(),
    zones,
    transitions,
    activeZoneCount,
    saturatedZoneCount,
    overallConfidence,
    operationalNarrative,
  };
}
