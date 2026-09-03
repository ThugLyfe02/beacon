import type { VenueTwinSnapshot, VenueTwinZone } from './SpatialVenueTwinEngine';

export type FlowInterventionKind = 'observe' | 'reroute' | 'decompress' | 'open-capacity' | 'hold';

export interface FlowIntervention {
  id: string;
  zoneId: string;
  kind: FlowInterventionKind;
  priority: number;
  confidence: number;
  title: string;
  rationale: string;
  expectedEffect: string;
}

export interface SpatialFlowControlState {
  interventions: FlowIntervention[];
  primary: FlowIntervention | null;
  bottleneckCount: number;
  flowHealth: number;
  narrative: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreZone(zone: VenueTwinZone): number {
  const saturation = zone.state === 'saturated' ? 1 : zone.state === 'active' ? 0.68 : 0.25;
  return clamp01(
    saturation * 0.4
      + zone.occupancyRatio * 0.28
      + zone.ingressPressure * 0.2
      + zone.dwellPressure * 0.12,
  );
}

/**
 * Converts the aggregate venue twin into reversible operational interventions.
 * It does not direct specific people or infer individual intent. Guidance is
 * expressed at the zone level so organizers can improve the physical event.
 */
export function buildSpatialFlowControl(twin: VenueTwinSnapshot): SpatialFlowControlState {
  const interventions = twin.zones
    .map<FlowIntervention>((zone) => {
      const priority = scoreZone(zone);
      const confidence = clamp01(zone.confidence * twin.overallConfidence);

      if (zone.state === 'recovering') {
        return {
          id: `hold-${zone.id}`,
          zoneId: zone.id,
          kind: 'hold',
          priority,
          confidence,
          title: `Hold changes around ${zone.label}`,
          rationale: 'Live spatial confidence is recovering, so Beacon should not amplify uncertain movement guidance.',
          expectedEffect: 'Preserve operational stability until the venue model becomes trustworthy again.',
        };
      }

      if (zone.state === 'saturated') {
        return {
          id: `decompress-${zone.id}`,
          zoneId: zone.id,
          kind: 'decompress',
          priority,
          confidence,
          title: `Decompress ${zone.label}`,
          rationale: `${Math.round(zone.occupancyRatio * 100)}% of configured capacity is currently represented with elevated ingress pressure.`,
          expectedEffect: 'Reduce crowding pressure by shifting future route guidance toward credible adjacent capacity.',
        };
      }

      if (zone.state === 'active' && zone.ingressPressure > 0.6) {
        return {
          id: `reroute-${zone.id}`,
          zoneId: zone.id,
          kind: 'reroute',
          priority,
          confidence,
          title: `Balance inbound flow near ${zone.label}`,
          rationale: 'The zone is healthy but incoming aggregate pressure is rising faster than local capacity headroom.',
          expectedEffect: 'Preserve activity quality without allowing a healthy zone to become the next bottleneck.',
        };
      }

      if (zone.state === 'forming' && zone.occupancyRatio < 0.45) {
        return {
          id: `open-${zone.id}`,
          zoneId: zone.id,
          kind: 'open-capacity',
          priority: priority * 0.72,
          confidence,
          title: `Expose available capacity at ${zone.label}`,
          rationale: 'The area is beginning to activate while retaining meaningful headroom.',
          expectedEffect: 'Give organizers a credible alternative zone when another part of the venue becomes constrained.',
        };
      }

      return {
        id: `observe-${zone.id}`,
        zoneId: zone.id,
        kind: 'observe',
        priority: priority * 0.5,
        confidence,
        title: `Observe ${zone.label}`,
        rationale: 'Current activity does not justify an intervention.',
        expectedEffect: 'Maintain the current venue state and gather additional aggregate evidence.',
      };
    })
    .sort((left, right) => right.priority - left.priority || right.confidence - left.confidence || left.id.localeCompare(right.id));

  const primary = interventions[0] ?? null;
  const bottleneckCount = twin.zones.filter((zone) => zone.state === 'saturated' || (zone.state === 'active' && zone.ingressPressure > 0.6)).length;
  const flowHealth = clamp01(1 - Math.min(0.8, bottleneckCount * 0.18) - (1 - twin.overallConfidence) * 0.2);

  return {
    interventions,
    primary,
    bottleneckCount,
    flowHealth,
    narrative: primary
      ? `${primary.title}. ${primary.expectedEffect}`
      : 'No aggregate venue intervention is currently justified.',
  };
}
