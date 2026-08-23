import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import { buildVenueCapacityReserve } from './VenueCapacityReserve';

export interface VenuePressureScenario {
  id: string;
  title: string;
  occupancyMultiplier: number;
  confidenceMultiplier: number;
  ingressShock: number;
}

export interface VenuePressureResult {
  scenarioId: string;
  projectedSaturatedZones: number;
  projectedMeanOccupancy: number;
  reserveAfterShock: number;
  fragileZoneIds: string[];
  riskScore: number;
}

const SCENARIOS: VenuePressureScenario[] = [
  { id: 'late-arrival-wave', title: 'Late arrival wave', occupancyMultiplier: 1.18, confidenceMultiplier: 0.95, ingressShock: 0.2 },
  { id: 'program-release', title: 'Program release', occupancyMultiplier: 1.12, confidenceMultiplier: 0.92, ingressShock: 0.32 },
  { id: 'telemetry-degradation', title: 'Telemetry degradation', occupancyMultiplier: 1, confidenceMultiplier: 0.55, ingressShock: 0 },
  { id: 'single-zone-overload', title: 'Single-zone overload', occupancyMultiplier: 1.25, confidenceMultiplier: 0.9, ingressShock: 0.4 },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Deterministic pressure testing for the venue control model. This does not
 * simulate individual attendees. It perturbs aggregate occupancy, ingress and
 * confidence to reveal brittle venue configurations before they become live
 * operational problems.
 */
export function pressureTestVenue(
  twin: VenueTwinSnapshot,
  scenarios: VenuePressureScenario[] = SCENARIOS,
): VenuePressureResult[] {
  return scenarios.map((scenario) => {
    const projected = twin.zones.map((zone, index) => {
      const concentrationFactor = scenario.id === 'single-zone-overload' && index === 0 ? 1.25 : 1;
      const occupancy = Math.min(zone.capacity, zone.visibleOccupancy * scenario.occupancyMultiplier * concentrationFactor);
      const ratio = zone.capacity <= 0 ? 1 : occupancy / zone.capacity;
      const confidence = clamp01(zone.confidence * scenario.confidenceMultiplier);
      return { zone, occupancy, ratio, confidence };
    });

    const projectedSaturatedZones = projected.filter((item) => item.ratio >= 0.92).length;
    const projectedMeanOccupancy = projected.length === 0 ? 0 : projected.reduce((sum, item) => sum + item.ratio, 0) / projected.length;
    const syntheticTwin: VenueTwinSnapshot = {
      ...twin,
      zones: twin.zones.map((zone, index) => ({
        ...zone,
        visibleOccupancy: projected[index]?.occupancy ?? zone.visibleOccupancy,
        occupancyRatio: projected[index]?.ratio ?? zone.occupancyRatio,
        confidence: projected[index]?.confidence ?? zone.confidence,
        ingressPressure: clamp01(zone.ingressPressure + scenario.ingressShock),
      })),
      saturatedZoneCount: projectedSaturatedZones,
      overallConfidence: projected.length === 0 ? 0 : projected.reduce((sum, item) => sum + item.confidence, 0) / projected.length,
    };

    const reserve = buildVenueCapacityReserve(syntheticTwin);
    const fragileZoneIds = projected
      .filter((item) => item.ratio >= 0.82 || item.confidence < 0.6)
      .map((item) => item.zone.id);
    const riskScore = clamp01(
      projectedSaturatedZones * 0.18
      + projectedMeanOccupancy * 0.38
      + (1 - syntheticTwin.overallConfidence) * 0.24
      + (reserve.usableReserve === 0 ? 0.2 : 0),
    );

    return {
      scenarioId: scenario.id,
      projectedSaturatedZones,
      projectedMeanOccupancy,
      reserveAfterShock: reserve.usableReserve,
      fragileZoneIds,
      riskScore,
    };
  });
}
