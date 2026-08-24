import type { SpatialFlowControlState } from './SpatialFlowControlEngine';
import type { VenueRoutingPolicyState } from './VenueRoutingPolicy';
import type { VenueServicePointSummary } from './VenueServicePoint';
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
  targetZoneIds: string[];
}

export interface SpatialOrganizerCommandState {
  commands: OrganizerCommand[];
  primary: OrganizerCommand | null;
  operatorScore: number;
  sponsorProofScore: number;
  narrative: string;
}

export interface OrganizerCommandContext {
  servicePoints?: VenueServicePointSummary;
  routing?: VenueRoutingPolicyState;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts aggregate venue state into operator-facing commands. Optional service
 * and routing context makes the command concrete: Beacon can distinguish spare
 * capacity that is merely empty from capacity that is actually reachable, and
 * can surface queue pressure at check-in, food, booths, and other service points.
 */
export function buildSpatialOrganizerCommands(
  twin: VenueTwinSnapshot,
  flow: SpatialFlowControlState,
  context: OrganizerCommandContext = {},
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
      measurement: 'Track zone occupancy ratio and ingress pressure for the next 5-10 minutes.',
      targetZoneIds: [flow.primary.zoneId],
    });
  }

  const strongestRoute = context.routing?.primary ?? null;
  if (strongestRoute) {
    commands.push({
      id: `route-${strongestRoute.fromZoneId}-${strongestRoute.toZoneId}`,
      kind: 'flow',
      priority: clamp01(0.58 + strongestRoute.score * 0.35),
      confidence: strongestRoute.confidence,
      title: `Use ${strongestRoute.toZoneId} as the preferred relief path`,
      detail: `The current route preserves ${Math.round(strongestRoute.pathCapacityPerMinute)} people/minute of configured aggregate path capacity and terminates in ${strongestRoute.destinationSpareCapacity} spaces of observed headroom.`,
      operatorAction: `If operators choose to rebalance normal event flow, use the validated ${strongestRoute.pathZoneIds.join(' → ')} zone path rather than routing toward capacity that is not topologically reachable.`,
      measurement: 'Compare origin-zone ingress pressure, destination occupancy ratio, and path-support observations during the next measurement window.',
      targetZoneIds: [...new Set([strongestRoute.fromZoneId, strongestRoute.toZoneId])],
    });
  }

  const congestedServicePoint = context.servicePoints?.points
    .filter((point) => point.state === 'congested' || point.state === 'building')
    .sort((a, b) => b.queuePressure - a.queuePressure || b.confidence - a.confidence || a.id.localeCompare(b.id))[0];
  if (congestedServicePoint) {
    const waitText = congestedServicePoint.estimatedWaitMinutes === null
      ? 'Wait time is withheld because recent throughput support is not strong enough.'
      : `Recent aggregate throughput implies an estimated ${Math.round(congestedServicePoint.estimatedWaitMinutes)} minute wait.`;
    commands.push({
      id: `service-${congestedServicePoint.id}`,
      kind: 'capacity',
      priority: clamp01(0.56 + congestedServicePoint.queuePressure * 0.38),
      confidence: congestedServicePoint.confidence,
      title: `Relieve ${congestedServicePoint.kind} service pressure`,
      detail: `${congestedServicePoint.id} is ${congestedServicePoint.state}; arrivals are ${congestedServicePoint.arrivalRatePerMinute.toFixed(1)}/min versus ${congestedServicePoint.completionRatePerMinute.toFixed(1)}/min completed. ${waitText}`,
      operatorAction: 'Review staffing, open an equivalent nearby service point where configured, or adjust normal wayfinding so demand does not continue accumulating at one queue.',
      measurement: 'Track queue length, arrivals, completions, and estimated wait across the next declared service-point observation window.',
      targetZoneIds: [congestedServicePoint.zoneId],
    });
  }

  const openCapacity = twin.zones
    .filter((zone) => zone.occupancyRatio < 0.5 && zone.confidence >= 0.55)
    .sort((a, b) => a.occupancyRatio - b.occupancyRatio)[0];
  if (openCapacity) {
    const topologyQualified = context.routing === undefined
      || context.routing.candidates.some((candidate) => candidate.toZoneId === openCapacity.id && candidate.decision !== 'blocked');
    commands.push({
      id: `capacity-${openCapacity.id}`,
      kind: 'capacity',
      priority: clamp01(0.48 + (1 - openCapacity.occupancyRatio) * 0.35) * (topologyQualified ? 1 : 0.72),
      confidence: openCapacity.confidence,
      title: `Preserve ${openCapacity.label} as available capacity`,
      detail: topologyQualified
        ? 'Beacon has enough aggregate evidence to treat this zone as headroom, and the current topology does not rule it out as a reachable relief destination.'
        : 'This zone has spare capacity, but the current topology does not support treating it as reachable relief without additional review.',
      operatorAction: topologyQualified
        ? 'Preserve this zone as operational headroom and use it only when a validated route or programming need justifies consuming reserve.'
        : 'Do not route additional flow here until venue topology or access constraints are resolved.',
      measurement: 'Measure whether any redistribution reduces peak occupancy elsewhere without collapsing activity quality here.',
      targetZoneIds: [openCapacity.id],
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
      targetZoneIds: activeZones.map((zone) => zone.id),
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
      targetZoneIds: twin.zones.filter((zone) => zone.state === 'active' || zone.state === 'saturated').map((zone) => zone.id),
    });
  }

  commands.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id));
  const operatorScore = clamp01(
    flow.flowHealth * 0.36
      + twin.overallConfidence * 0.28
      + Math.min(0.18, commands.length * 0.04)
      + (context.routing?.primary?.score ?? 0) * 0.1
      + (1 - (congestedServicePoint?.queuePressure ?? 0)) * 0.08,
  );
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
