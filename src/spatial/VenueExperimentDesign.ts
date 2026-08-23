import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type VenueExperimentMetric = 'saturation-rate' | 'mean-occupancy' | 'transition-support' | 'dwell-pressure';

export interface VenueExperimentPlan {
  id: string;
  commandId: string;
  targetZoneIds: string[];
  primaryMetric: VenueExperimentMetric;
  baselineValue: number;
  minimumObservationMinutes: number;
  minimumConfidence: number;
  stopConditions: string[];
  rationale: string;
}

function meanOccupancy(snapshot: VenueTwinSnapshot): number {
  if (snapshot.zones.length === 0) return 0;
  return snapshot.zones.reduce((sum, zone) => sum + zone.occupancyRatio, 0) / snapshot.zones.length;
}

function metricFor(command: OrganizerCommand): VenueExperimentMetric {
  if (command.kind === 'safety' || command.kind === 'flow') return 'saturation-rate';
  if (command.kind === 'capacity') return 'mean-occupancy';
  if (command.kind === 'programming') return 'transition-support';
  return 'dwell-pressure';
}

function baselineFor(metric: VenueExperimentMetric, snapshot: VenueTwinSnapshot): number {
  switch (metric) {
    case 'saturation-rate':
      return snapshot.zones.length === 0 ? 0 : snapshot.saturatedZoneCount / snapshot.zones.length;
    case 'transition-support':
      return snapshot.transitions.reduce((sum, transition) => sum + transition.support, 0);
    case 'dwell-pressure':
      return snapshot.zones.length === 0 ? 0 : snapshot.zones.reduce((sum, zone) => sum + zone.dwellPressure, 0) / snapshot.zones.length;
    default:
      return meanOccupancy(snapshot);
  }
}

/**
 * Produces a measurement contract before an operator intervention is applied.
 * This prevents Beacon from declaring success after the fact using whichever
 * metric happens to improve. It is an observational evaluation plan, not a
 * randomized causal experiment.
 */
export function buildVenueExperimentPlan(
  command: OrganizerCommand,
  baseline: VenueTwinSnapshot,
): VenueExperimentPlan {
  const primaryMetric = metricFor(command);
  return {
    id: `measure:${command.id}`,
    commandId: command.id,
    targetZoneIds: command.targetZoneIds,
    primaryMetric,
    baselineValue: baselineFor(primaryMetric, baseline),
    minimumObservationMinutes: command.kind === 'programming' ? 15 : 8,
    minimumConfidence: Math.max(0.6, command.confidence * 0.85),
    stopConditions: [
      'runtime confidence falls below the measurement threshold',
      'zone configuration changes during the observation window',
      'the operator reverts or materially changes the intervention',
    ],
    rationale: `Evaluate ${command.title.toLowerCase()} against a predeclared ${primaryMetric} baseline rather than selecting a favorable metric after the intervention.`,
  };
}
