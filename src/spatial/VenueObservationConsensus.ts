import type {
  VenueObservation,
  VenueOccupancyObservation,
  VenueTransitionObservation,
} from './VenueObservationContract';
import type { VenueSensorHealthState } from './VenueSensorHealth';
import type { VenueTwinZoneKind } from './SpatialVenueTwinEngine';

export interface VenueConsensusZoneDefinition {
  id: string;
  label: string;
  kind: VenueTwinZoneKind;
  polygon: Array<[number, number]>;
  capacity: number;
  previousVisibleOccupancy?: number;
}

export interface VenueConsensusZone {
  id: string;
  visibleOccupancy: number;
  confidence: number;
  independentSources: number;
  disagreement: number;
  contested: boolean;
}

export interface VenueConsensusTransition {
  fromZoneId: string;
  toZoneId: string;
  support: number;
  confidence: number;
  independentSources: number;
  disagreement: number;
  contested: boolean;
}

export interface VenueObservationConsensusState {
  zoneDefinitions: Array<VenueConsensusZoneDefinition & { visibleOccupancy: number }>;
  zones: VenueConsensusZone[];
  transitions: VenueConsensusTransition[];
  transitionObservations: Array<{
    fromZoneId: string;
    toZoneId: string;
    support: number;
    previousSupport?: number;
  }>;
  acceptedObservationCount: number;
  droppedObservationCount: number;
  contestedZoneIds: string[];
  contestedTransitionIds: string[];
  confidence: number;
  reasons: string[];
}

interface VenueObservationConsensusInput {
  observations: VenueObservation[];
  sensorHealth: VenueSensorHealthState;
  zones: VenueConsensusZoneDefinition[];
  now?: number;
  maximumAgeMs?: number;
  minimumIndependentSources?: number;
}

interface WeightedValue {
  value: number;
  weight: number;
  sourceId: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function weightedMedian(values: WeightedValue[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a.value - b.value || a.sourceId.localeCompare(b.sourceId));
  const totalWeight = ordered.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (totalWeight <= 0) return ordered[Math.floor((ordered.length - 1) / 2)].value;
  const threshold = totalWeight / 2;
  let cumulative = 0;
  for (const item of ordered) {
    cumulative += Math.max(0, item.weight);
    if (cumulative >= threshold) return item.value;
  }
  return ordered[ordered.length - 1].value;
}

function weightedMean(values: WeightedValue[]): number {
  const weight = values.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (weight <= 0) return 0;
  return values.reduce((sum, item) => sum + item.value * Math.max(0, item.weight), 0) / weight;
}

function robustDisagreement(values: WeightedValue[], scale: number): number {
  if (values.length <= 1) return 0;
  const center = weightedMedian(values);
  const deviations = values.map((item) => ({ ...item, value: Math.abs(item.value - center) }));
  return clamp01(weightedMedian(deviations) / Math.max(1, scale));
}

function latestPerSource<T extends VenueObservation>(observations: T[]): T[] {
  const bySource = new Map<string, T>();
  for (const observation of observations) {
    const current = bySource.get(observation.sourceId);
    if (!current || observation.observedAt > current.observedAt || (
      observation.observedAt === current.observedAt && observation.sequence > current.sequence
    )) {
      bySource.set(observation.sourceId, observation);
    }
  }
  return [...bySource.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

/**
 * Produces robust aggregate venue state from independent sensing sources.
 * Independent occupancy estimates are combined with a weighted median instead
 * of being summed or blindly averaged. This limits the influence of one drifting
 * sensor and makes source disagreement visible to downstream control policy.
 *
 * Quarantined/offline sensors are diagnostic-only and cannot contribute to venue
 * truth. No attendee identifiers or movement trajectories are consumed.
 */
export function buildVenueObservationConsensus(
  input: VenueObservationConsensusInput,
): VenueObservationConsensusState {
  const now = input.now ?? Date.now();
  const maximumAgeMs = Math.max(5_000, input.maximumAgeMs ?? 45_000);
  const minimumIndependentSources = Math.max(1, input.minimumIndependentSources ?? 2);
  const zoneById = new Map(input.zones.map((zone) => [zone.id, zone]));
  const sensorById = new Map(input.sensorHealth.sensors.map((sensor) => [sensor.sourceId, sensor]));
  const accepted: VenueObservation[] = [];
  let droppedObservationCount = 0;

  for (const observation of input.observations) {
    const sensor = sensorById.get(observation.sourceId);
    const ageMs = Math.max(0, now - observation.observedAt);
    if (!sensor || sensor.state === 'quarantined' || sensor.state === 'offline' || ageMs > maximumAgeMs) {
      droppedObservationCount += 1;
      continue;
    }
    if (observation.kind === 'occupancy' && !zoneById.has(observation.payload.zoneId)) {
      droppedObservationCount += 1;
      continue;
    }
    if (observation.kind === 'transition' && (
      !zoneById.has(observation.payload.fromZoneId) || !zoneById.has(observation.payload.toZoneId)
    )) {
      droppedObservationCount += 1;
      continue;
    }
    accepted.push(observation);
  }

  const occupancyByZone = new Map<string, VenueOccupancyObservation[]>();
  const transitionsByPair = new Map<string, VenueTransitionObservation[]>();
  for (const observation of accepted) {
    if (observation.kind === 'occupancy') {
      occupancyByZone.set(observation.payload.zoneId, [
        ...(occupancyByZone.get(observation.payload.zoneId) ?? []),
        observation,
      ]);
    } else if (observation.kind === 'transition') {
      const key = `${observation.payload.fromZoneId}->${observation.payload.toZoneId}`;
      transitionsByPair.set(key, [...(transitionsByPair.get(key) ?? []), observation]);
    }
  }

  const zones = input.zones.map<VenueConsensusZone>((zone) => {
    const observations = latestPerSource(occupancyByZone.get(zone.id) ?? []);
    const values: WeightedValue[] = observations.map((observation) => {
      const sensor = sensorById.get(observation.sourceId);
      const ageFactor = clamp01(1 - Math.max(0, now - observation.observedAt) / maximumAgeMs);
      const sampleFactor = clamp01(observation.payload.sampleSupport / 12);
      return {
        sourceId: observation.sourceId,
        value: Math.max(0, observation.payload.occupancy),
        weight: clamp01(observation.confidence)
          * (sensor?.authorityWeight ?? 0)
          * (0.65 + sampleFactor * 0.2 + ageFactor * 0.15),
      };
    }).filter((item) => item.weight > 0);

    const independentSources = values.length;
    const occupancy = Math.round(Math.min(Math.max(0, zone.capacity), weightedMedian(values)));
    const disagreement = robustDisagreement(values, Math.max(4, zone.capacity * 0.18));
    const sourceMaturity = clamp01(independentSources / minimumIndependentSources);
    const meanWeight = values.length === 0 ? 0 : values.reduce((sum, item) => sum + item.weight, 0) / values.length;
    const confidence = clamp01(meanWeight * 0.58 + sourceMaturity * 0.27 + (1 - disagreement) * 0.15);
    const contested = independentSources >= 2 && disagreement >= 0.45;

    return {
      id: zone.id,
      visibleOccupancy: occupancy,
      confidence: contested ? confidence * 0.72 : confidence,
      independentSources,
      disagreement,
      contested,
    };
  });

  const transitions: VenueConsensusTransition[] = [...transitionsByPair.entries()].map(([key, raw]) => {
    const observations = latestPerSource(raw);
    const values: WeightedValue[] = observations.map((observation) => {
      const sensor = sensorById.get(observation.sourceId);
      const ageFactor = clamp01(1 - Math.max(0, now - observation.observedAt) / maximumAgeMs);
      const sampleFactor = clamp01(observation.payload.sampleSupport / 12);
      return {
        sourceId: observation.sourceId,
        value: Math.max(0, observation.payload.support),
        weight: clamp01(observation.confidence)
          * (sensor?.authorityWeight ?? 0)
          * (0.65 + sampleFactor * 0.2 + ageFactor * 0.15),
      };
    }).filter((item) => item.weight > 0);
    const [fromZoneId, toZoneId] = key.split('->');
    const support = Math.max(0, weightedMedian(values));
    const disagreement = robustDisagreement(values, Math.max(3, support * 0.5));
    const independentSources = values.length;
    const sourceMaturity = clamp01(independentSources / minimumIndependentSources);
    const meanWeight = values.length === 0 ? 0 : values.reduce((sum, item) => sum + item.weight, 0) / values.length;
    const confidence = clamp01(meanWeight * 0.55 + sourceMaturity * 0.3 + (1 - disagreement) * 0.15);
    const contested = independentSources >= 2 && disagreement >= 0.5;
    return {
      fromZoneId,
      toZoneId,
      support,
      confidence: contested ? confidence * 0.7 : confidence,
      independentSources,
      disagreement,
      contested,
    };
  }).sort((a, b) => b.support - a.support || a.fromZoneId.localeCompare(b.fromZoneId) || a.toZoneId.localeCompare(b.toZoneId));

  const zoneConsensusById = new Map(zones.map((zone) => [zone.id, zone]));
  const zoneDefinitions = input.zones.map((zone) => ({
    ...zone,
    visibleOccupancy: zoneConsensusById.get(zone.id)?.visibleOccupancy ?? 0,
  }));
  const transitionObservations = transitions.map((transition) => ({
    fromZoneId: transition.fromZoneId,
    toZoneId: transition.toZoneId,
    support: transition.support,
  }));
  const contestedZoneIds = zones.filter((zone) => zone.contested).map((zone) => zone.id).sort();
  const contestedTransitionIds = transitions
    .filter((transition) => transition.contested)
    .map((transition) => `${transition.fromZoneId}->${transition.toZoneId}`)
    .sort();
  const evidenceUnits = [...zones.map((zone) => zone.confidence), ...transitions.map((transition) => transition.confidence)];
  const confidence = evidenceUnits.length === 0 ? 0 : weightedMean(evidenceUnits.map((value, index) => ({
    value,
    weight: 1,
    sourceId: String(index),
  })));

  const reasons: string[] = [];
  if (droppedObservationCount > 0) reasons.push(`${droppedObservationCount} stale, unhealthy, or semantically incompatible observation${droppedObservationCount === 1 ? ' was' : 's were'} excluded from venue truth`);
  if (contestedZoneIds.length > 0) reasons.push(`${contestedZoneIds.length} zone${contestedZoneIds.length === 1 ? ' has' : 's have'} material cross-source disagreement`);
  if (contestedTransitionIds.length > 0) reasons.push(`${contestedTransitionIds.length} transition${contestedTransitionIds.length === 1 ? ' has' : 's have'} material cross-source disagreement`);
  if (zones.some((zone) => zone.independentSources < minimumIndependentSources)) reasons.push('one or more zones have not reached the preferred independent-source support');
  if (reasons.length === 0) reasons.push('independent aggregate observations agree closely enough to support normal venue-state construction');

  return {
    zoneDefinitions,
    zones,
    transitions,
    transitionObservations,
    acceptedObservationCount: accepted.length,
    droppedObservationCount,
    contestedZoneIds,
    contestedTransitionIds,
    confidence: clamp01(confidence),
    reasons,
  };
}
