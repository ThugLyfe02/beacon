import type { VenueTwinSnapshot, VenueTwinZone } from './SpatialVenueTwinEngine';

export interface ZoneOperatingEnvelope {
  zoneId: string;
  expectedOccupancyMin: number;
  expectedOccupancyMax: number;
  softSaturationThreshold: number;
  hardSaturationThreshold: number;
  minimumConfidence: number;
  maxFlowVolatility: number;
}

export type ZoneEnvelopeState = 'underused' | 'healthy' | 'strained' | 'outside-envelope' | 'unknown';

export interface ZoneEnvelopeAssessment {
  zoneId: string;
  state: ZoneEnvelopeState;
  occupancyRatio: number;
  confidence: number;
  marginToSoftLimit: number;
  marginToHardLimit: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function flowVolatility(zone: VenueTwinZone): number {
  return clamp01(Math.abs(zone.ingressPressure - zone.egressPressure));
}

export function assessZoneAgainstEnvelope(
  zone: VenueTwinZone,
  envelope: ZoneOperatingEnvelope,
): ZoneEnvelopeAssessment {
  const reasons: string[] = [];

  if (zone.confidence < envelope.minimumConfidence) {
    return {
      zoneId: zone.id,
      state: 'unknown',
      occupancyRatio: zone.occupancyRatio,
      confidence: zone.confidence,
      marginToSoftLimit: envelope.softSaturationThreshold - zone.occupancyRatio,
      marginToHardLimit: envelope.hardSaturationThreshold - zone.occupancyRatio,
      reasons: ['Spatial confidence is below the operating threshold.'],
    };
  }

  if (zone.occupancyRatio < envelope.expectedOccupancyMin) reasons.push('Occupancy is below the expected operating band.');
  if (zone.occupancyRatio > envelope.expectedOccupancyMax) reasons.push('Occupancy is above the expected operating band.');
  if (zone.occupancyRatio >= envelope.softSaturationThreshold) reasons.push('Soft saturation threshold has been crossed.');
  if (zone.occupancyRatio >= envelope.hardSaturationThreshold) reasons.push('Hard saturation threshold has been crossed.');
  if (flowVolatility(zone) > envelope.maxFlowVolatility) reasons.push('Ingress/egress imbalance exceeds the configured volatility limit.');

  let state: ZoneEnvelopeState = 'healthy';
  if (zone.occupancyRatio >= envelope.hardSaturationThreshold) state = 'outside-envelope';
  else if (zone.occupancyRatio >= envelope.softSaturationThreshold || flowVolatility(zone) > envelope.maxFlowVolatility) state = 'strained';
  else if (zone.occupancyRatio < envelope.expectedOccupancyMin) state = 'underused';

  return {
    zoneId: zone.id,
    state,
    occupancyRatio: zone.occupancyRatio,
    confidence: zone.confidence,
    marginToSoftLimit: envelope.softSaturationThreshold - zone.occupancyRatio,
    marginToHardLimit: envelope.hardSaturationThreshold - zone.occupancyRatio,
    reasons,
  };
}

export function assessVenueOperatingEnvelope(
  snapshot: VenueTwinSnapshot,
  envelopes: ZoneOperatingEnvelope[],
): ZoneEnvelopeAssessment[] {
  const byId = new Map(envelopes.map((item) => [item.zoneId, item]));
  return snapshot.zones.flatMap((zone) => {
    const envelope = byId.get(zone.id);
    return envelope ? [assessZoneAgainstEnvelope(zone, envelope)] : [];
  });
}
