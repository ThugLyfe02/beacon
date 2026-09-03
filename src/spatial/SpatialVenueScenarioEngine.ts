import type { SpatialFlowControlState } from './SpatialFlowControlEngine';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type VenueScenarioKind = 'baseline' | 'open-capacity' | 'decompress' | 'programming-shift';

export interface VenueScenario {
  id: string;
  kind: VenueScenarioKind;
  title: string;
  projectedFlowHealth: number;
  projectedBottlenecks: number;
  projectedSponsorProof: number;
  confidence: number;
  rationale: string;
}

export interface VenueScenarioState {
  scenarios: VenueScenario[];
  recommended: VenueScenario;
  baseline: VenueScenario;
  projectedGain: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Runs deterministic aggregate what-if scenarios against the venue twin.
 * This is not person simulation: it models zone pressure and operator actions,
 * avoiding synthetic individual trajectories or claims about attendee intent.
 */
export function buildVenueScenarios(twin: VenueTwinSnapshot, flow: SpatialFlowControlState): VenueScenarioState {
  const baseline: VenueScenario = {
    id: 'baseline',
    kind: 'baseline',
    title: 'Maintain current venue state',
    projectedFlowHealth: flow.flowHealth,
    projectedBottlenecks: flow.bottleneckCount,
    projectedSponsorProof: clamp01(twin.activeZoneCount * 0.1 + twin.overallConfidence * 0.4),
    confidence: twin.overallConfidence,
    rationale: 'Baseline preserves current routing and programming so every alternative can be measured against a stable control.',
  };

  const scenarios: VenueScenario[] = [baseline];

  if (twin.zones.some((zone) => zone.state === 'saturated')) {
    scenarios.push({
      id: 'decompress',
      kind: 'decompress',
      title: 'Decompress saturated zones',
      projectedFlowHealth: clamp01(flow.flowHealth + 0.18),
      projectedBottlenecks: Math.max(0, flow.bottleneckCount - 1),
      projectedSponsorProof: clamp01(baseline.projectedSponsorProof + 0.04),
      confidence: clamp01(twin.overallConfidence * 0.94),
      rationale: 'Shift future aggregate route guidance toward credible headroom and measure whether peak zone pressure falls.',
    });
  }

  const headroomZones = twin.zones.filter((zone) => zone.occupancyRatio < 0.5 && zone.confidence >= 0.55).length;
  if (headroomZones > 0) {
    scenarios.push({
      id: 'open-capacity',
      kind: 'open-capacity',
      title: 'Activate underused venue capacity',
      projectedFlowHealth: clamp01(flow.flowHealth + Math.min(0.16, headroomZones * 0.05)),
      projectedBottlenecks: Math.max(0, flow.bottleneckCount - (headroomZones >= 2 ? 1 : 0)),
      projectedSponsorProof: clamp01(baseline.projectedSponsorProof + Math.min(0.12, headroomZones * 0.035)),
      confidence: clamp01(twin.overallConfidence * 0.9),
      rationale: 'Use underutilized zones as deliberate capacity rather than waiting for crowding to force redistribution.',
    });
  }

  if (twin.activeZoneCount >= 2) {
    scenarios.push({
      id: 'programming-shift',
      kind: 'programming-shift',
      title: 'Stagger programming across active zones',
      projectedFlowHealth: clamp01(flow.flowHealth + 0.12),
      projectedBottlenecks: Math.max(0, flow.bottleneckCount - 1),
      projectedSponsorProof: clamp01(baseline.projectedSponsorProof + 0.1),
      confidence: clamp01(twin.overallConfidence * 0.88),
      rationale: 'Treat the event as a multi-zone system and reduce the chance that one program moment cannibalizes the rest of the venue.',
    });
  }

  scenarios.sort((a, b) => {
    const utilityA = a.projectedFlowHealth * 0.55 + (1 - Math.min(1, a.projectedBottlenecks / 3)) * 0.25 + a.projectedSponsorProof * 0.2;
    const utilityB = b.projectedFlowHealth * 0.55 + (1 - Math.min(1, b.projectedBottlenecks / 3)) * 0.25 + b.projectedSponsorProof * 0.2;
    if (utilityA !== utilityB) return utilityB - utilityA;
    return a.id.localeCompare(b.id);
  });

  const recommended = scenarios[0];
  const projectedGain = clamp01(recommended.projectedFlowHealth - baseline.projectedFlowHealth);
  return { scenarios, recommended, baseline, projectedGain };
}
