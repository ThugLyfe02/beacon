import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export interface VenueProgramMoment {
  id: string;
  title: string;
  startsAt: number;
  endsAt: number;
  zoneIds: string[];
  kind: 'session' | 'announcement' | 'activation' | 'break' | 'entry-wave' | 'exit-wave';
}

export interface ProgramEffectObservation {
  programMomentId: string;
  zoneId: string;
  baselineOccupancy: number;
  duringOccupancy: number;
  baselineIngress: number;
  duringIngress: number;
  baselineDwell: number;
  duringDwell: number;
  occupancyDelta: number;
  ingressDelta: number;
  dwellDelta: number;
  confidence: number;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zoneValue(snapshot: VenueTwinSnapshot, zoneId: string, key: 'occupancyRatio' | 'ingressPressure' | 'dwellPressure'): number | null {
  const zone = snapshot.zones.find((item) => item.id === zoneId);
  return zone ? zone[key] : null;
}

/**
 * Attributes aggregate venue shifts to configured program windows using before
 * versus during comparisons. This is descriptive attribution, not causal proof.
 */
export function attributeProgramEffects(
  moment: VenueProgramMoment,
  baselineSnapshots: VenueTwinSnapshot[],
  duringSnapshots: VenueTwinSnapshot[],
): ProgramEffectObservation[] {
  return moment.zoneIds.flatMap((zoneId) => {
    const baselineOccupancyValues = baselineSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'occupancyRatio')).filter((value): value is number => value !== null);
    const duringOccupancyValues = duringSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'occupancyRatio')).filter((value): value is number => value !== null);
    const baselineIngressValues = baselineSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'ingressPressure')).filter((value): value is number => value !== null);
    const duringIngressValues = duringSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'ingressPressure')).filter((value): value is number => value !== null);
    const baselineDwellValues = baselineSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'dwellPressure')).filter((value): value is number => value !== null);
    const duringDwellValues = duringSnapshots.map((snapshot) => zoneValue(snapshot, zoneId, 'dwellPressure')).filter((value): value is number => value !== null);

    if (baselineOccupancyValues.length < 2 || duringOccupancyValues.length < 2) return [];

    const baselineOccupancy = mean(baselineOccupancyValues);
    const duringOccupancy = mean(duringOccupancyValues);
    const baselineIngress = mean(baselineIngressValues);
    const duringIngress = mean(duringIngressValues);
    const baselineDwell = mean(baselineDwellValues);
    const duringDwell = mean(duringDwellValues);
    const support = Math.min(1, (baselineOccupancyValues.length + duringOccupancyValues.length) / 10);

    return [{
      programMomentId: moment.id,
      zoneId,
      baselineOccupancy,
      duringOccupancy,
      baselineIngress,
      duringIngress,
      baselineDwell,
      duringDwell,
      occupancyDelta: duringOccupancy - baselineOccupancy,
      ingressDelta: duringIngress - baselineIngress,
      dwellDelta: duringDwell - baselineDwell,
      confidence: support,
    }];
  });
}
