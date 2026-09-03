import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export interface ZoneObservationSample {
  observedAt: number;
  zoneId: string;
  occupancyRatio: number;
  ingressPressure: number;
  egressPressure: number;
  dwellPressure: number;
  confidence: number;
}

export type ZoneChangeKind = 'occupancy-rise' | 'occupancy-fall' | 'ingress-surge' | 'egress-surge' | 'dwell-shift';

export interface ZoneChangePoint {
  zoneId: string;
  kind: ZoneChangeKind;
  observedAt: number;
  magnitude: number;
  confidence: number;
  baseline: number;
  current: number;
  explanation: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviation(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function detectOne(
  history: ZoneObservationSample[],
  current: ZoneObservationSample,
  field: 'occupancyRatio' | 'ingressPressure' | 'egressPressure' | 'dwellPressure',
  positiveKind: ZoneChangeKind,
  negativeKind: ZoneChangeKind,
): ZoneChangePoint | null {
  if (history.length < 4 || current.confidence < 0.55) return null;
  const values = history.map((item) => item[field]);
  const baseline = mean(values);
  const sigma = Math.max(0.035, deviation(values, baseline));
  const delta = current[field] - baseline;
  const normalized = Math.abs(delta) / sigma;
  if (normalized < 2.25 || Math.abs(delta) < 0.08) return null;

  const kind = delta >= 0 ? positiveKind : negativeKind;
  return {
    zoneId: current.zoneId,
    kind,
    observedAt: current.observedAt,
    magnitude: clamp01(Math.abs(delta)),
    confidence: clamp01(current.confidence * Math.min(1, normalized / 3)),
    baseline,
    current: current[field],
    explanation: `${field} moved ${delta >= 0 ? 'above' : 'below'} its recent zone baseline by ${Math.abs(delta).toFixed(2)} with ${normalized.toFixed(1)}σ separation.`,
  };
}

export function detectVenueChangePoints(
  history: ZoneObservationSample[],
  snapshot: VenueTwinSnapshot,
): ZoneChangePoint[] {
  const now = snapshot.generatedAt;
  const changes: ZoneChangePoint[] = [];

  for (const zone of snapshot.zones) {
    const zoneHistory = history
      .filter((item) => item.zoneId === zone.id && item.observedAt < now)
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, 12);
    const current: ZoneObservationSample = {
      observedAt: now,
      zoneId: zone.id,
      occupancyRatio: zone.occupancyRatio,
      ingressPressure: zone.ingressPressure,
      egressPressure: zone.egressPressure,
      dwellPressure: zone.dwellPressure,
      confidence: zone.confidence,
    };

    const candidates = [
      detectOne(zoneHistory, current, 'occupancyRatio', 'occupancy-rise', 'occupancy-fall'),
      detectOne(zoneHistory, current, 'ingressPressure', 'ingress-surge', 'occupancy-fall'),
      detectOne(zoneHistory, current, 'egressPressure', 'egress-surge', 'occupancy-rise'),
      detectOne(zoneHistory, current, 'dwellPressure', 'dwell-shift', 'dwell-shift'),
    ].filter((item): item is ZoneChangePoint => item !== null);

    changes.push(...candidates);
  }

  return changes.sort((a, b) => b.confidence - a.confidence || b.magnitude - a.magnitude || a.zoneId.localeCompare(b.zoneId));
}

export function appendVenueObservationHistory(
  history: ZoneObservationSample[],
  snapshot: VenueTwinSnapshot,
  maxSamplesPerZone = 24,
): ZoneObservationSample[] {
  const next = [...history];
  for (const zone of snapshot.zones) {
    next.push({
      observedAt: snapshot.generatedAt,
      zoneId: zone.id,
      occupancyRatio: zone.occupancyRatio,
      ingressPressure: zone.ingressPressure,
      egressPressure: zone.egressPressure,
      dwellPressure: zone.dwellPressure,
      confidence: zone.confidence,
    });
  }

  const grouped = new Map<string, ZoneObservationSample[]>();
  for (const item of next) grouped.set(item.zoneId, [...(grouped.get(item.zoneId) ?? []), item]);
  return [...grouped.values()].flatMap((items) => items.sort((a, b) => b.observedAt - a.observedAt).slice(0, maxSamplesPerZone));
}
