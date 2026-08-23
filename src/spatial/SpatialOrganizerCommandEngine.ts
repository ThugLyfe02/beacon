import type { SpatialFlowControlState } from './SpatialFlowControlEngine';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type OrganizerCommandKind = 'flow' | 'capacity' | 'programming' | 'sponsor' | 'safety' | 'follow-up';

export interface OrganizerCommand {
  id: string;
  kind: OrganizerCommandKind;
  priority: number;
  confidence: number;
  title: string;
  detail: string;
  operatorAction: string;
  measurement: string;
}

export interface SpatialOrganizerCommandState {
  commands: OrganizerCommand[];
  primary: OrganizerCommand | null;
  operatorScore: number;
  sponsorProofScore: number;
  narrative: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts aggregate venue state into operator-facing commands. This is the
 * business leverage layer: it makes Beacon useful to organizers before, during,
 * and after an event without exposing attendee-level movement histories.
 */
export function buildSpatialOrganizerCommands(
  twin: VenueTwinSnapshot,
  flow: SpatialFlowControlState,
): SpatialOrganizerCommandState {
  const commands: OrganizerCommand[] = [];

  if (flow.primary && flow.primary.kind !== 'observe') {
    commands.push({
      id: `flow-${flow.primary.id}`,
      kind: flow.primary.kind === 'decompress' ? 'safety' : 'flow',
      priority: clamp01(0.78 + flow.primary.priority * 0.22),
      confidence: flow.primary.confidence,
      title: flow.primary.title,
      detail: flow.primary.rationale,
      operatorAction: flow.primary.expectedEffect,
      measurement: `Track zone occupancy ratio and ingress pressure for the next 5-10 minutes.`,
    });
  }

  const openCapacity = twin.zones
    .filter((zone) => zone.occupancyRatio < 0.5 && zone.confidence >= 0.55)
    .sort((a, b) => a.occupancyRatio - b.occupancyRatio)[0];
  if (openCapacity) {
    commands.push({
      id: `capacity-${openCapacity.id}`,
      kind: 'capacity',
      priority: clamp01(0.48 + (1 - openCapacity.occupancyRatio) * 0.35),
      confidence: openCapacity.confidence,
      title: `Preserve ${openCapacity.label} as available capacity`,
      detail: 'Beacon has enough aggregate evidence to treat this zone as headroom rather than an active bottleneck.',
      operatorAction: 'Use this zone as the preferred destination for signage, staff guidance, or future routing if another area saturates.',
      measurement: 'Measure whether redistribution reduces peak occupancy elsewhere without collapsing activity quality here.',
    });
  }

  const activeZones = twin.zones.filter((zone) => zone.state === 'active' || zone.state === 'saturated');
  if (activeZones.length >= 2) {
    const meanConfidence = activeZones.reduce((sum, zone) => sum + zone.confidence, 0) / activeZones.length;
    commands.push({
      id: 'programming-multi-zone',
      kind: 'programming',
      priority: clamp01(0.52 + activeZones.length * 0.06),
      confidence: meanConfidence,
      title: 'Program around a multi-zone event, not a single hotspot',
      detail: `${activeZones.length} zones are carrying sustained aggregate activity, which suggests the event is no longer behaving like one central room.`,
      operatorAction: 'Stagger programming, staff presence, and announcements so one high-energy zone does not cannibalize the others.',
      measurement: 'Compare zone dwell pressure and cross-zone transition support before and after the programming change.',
    });
  }

  const sponsorProofScore = clamp01(
    twin.activeZoneCount * 0.12
      + Math.min(0.42, twin.transitions.reduce((sum, item) => sum + item.support, 0) * 0.02)
      + twin.overallConfidence * 0.34,
  );

  if (sponsorProofScore >= 0.55) {
    commands.push({
      id: 'sponsor-proof',
      kind: 'sponsor',
      priority: sponsorProofScore * 0.84,
      confidence: twin.overallConfidence,
      title: 'Convert venue activity into sponsor proof',
      detail: 'Beacon can summarize aggregate zone activation and cross-zone movement without exposing attendee-level trajectories.',
      operatorAction: 'Package validated zone activation, dwell pressure, and transition evidence into the post-event sponsor report.',
      measurement: 'Report aggregate activation and flow quality alongside configured sponsor zones and program moments.',
    });
  }

  commands.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const operatorScore = clamp01(flow.flowHealth * 0.42 + twin.overallConfidence * 0.32 + Math.min(0.26, commands.length * 0.06));
  const primary = commands[0] ?? null;

  return {
    commands,
    primary,
    operatorScore,
    sponsorProofScore,
    narrative: primary
      ? `${primary.title}. Beacon is turning live spatial evidence into an operator decision with a measurable post-action check.`
      : 'The venue is stable enough that Beacon does not need to manufacture an operator intervention.',
  };
}
