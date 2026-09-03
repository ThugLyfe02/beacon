import type { VenueCapacityReserveState } from './VenueCapacityReserve';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import { findVenueReliefPaths, type VenueTopologyState } from './VenueTopology';

export type VenueRouteDecision = 'eligible' | 'review' | 'blocked';

export interface VenueRouteCandidate {
  fromZoneId: string;
  toZoneId: string;
  decision: VenueRouteDecision;
  score: number;
  pathZoneIds: string[];
  linkIds: string[];
  pathCapacityPerMinute: number;
  destinationSpareCapacity: number;
  destinationOccupancyRatio: number;
  accessible: boolean;
  confidence: number;
  reasons: string[];
}

export interface VenueRoutingPolicyState {
  candidates: VenueRouteCandidate[];
  primary: VenueRouteCandidate | null;
  blockedCount: number;
  reason: string;
}

interface VenueRoutingPolicyInput {
  twin: VenueTwinSnapshot;
  topology: VenueTopologyState;
  reserve: VenueCapacityReserveState;
  fromZoneId: string;
  requiresAccessible: boolean;
  minimumPathCapacityPerMinute?: number;
  minimumDestinationSpareCapacity?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts spare-capacity candidates into topology-aware routing options. A zone
 * is not treated as usable relief merely because it is empty: Beacon also checks
 * whether an enabled path exists, whether that path has enough aggregate flow
 * capacity, whether accessibility requirements are preserved, and whether the
 * destination itself has enough trustworthy headroom.
 *
 * This is normal event-flow decision support. It is not an emergency egress or
 * life-safety routing system and must not be represented as one without separate
 * validation against applicable venue and regulatory requirements.
 */
export function evaluateVenueRoutingPolicy(input: VenueRoutingPolicyInput): VenueRoutingPolicyState {
  const minimumPathCapacity = Math.max(1, input.minimumPathCapacityPerMinute ?? 12);
  const minimumSpareCapacity = Math.max(1, input.minimumDestinationSpareCapacity ?? 6);
  const zoneById = new Map(input.twin.zones.map((zone) => [zone.id, zone]));
  const reserveById = new Map(input.reserve.reliefZones.map((zone) => [zone.zoneId, zone]));
  const candidateZoneIds = input.reserve.reliefZones.map((zone) => zone.zoneId);
  const paths = findVenueReliefPaths(
    input.topology,
    input.fromZoneId,
    candidateZoneIds,
    input.requiresAccessible,
    5,
  );

  const candidates = paths.map<VenueRouteCandidate>((path) => {
    const toZoneId = path.zoneIds[path.zoneIds.length - 1];
    const destination = zoneById.get(toZoneId);
    const reserve = reserveById.get(toZoneId);
    const reasons: string[] = [];
    let decision: VenueRouteDecision = 'eligible';

    if (!destination || !reserve) {
      return {
        fromZoneId: input.fromZoneId,
        toZoneId,
        decision: 'blocked',
        score: 0,
        pathZoneIds: path.zoneIds,
        linkIds: path.linkIds,
        pathCapacityPerMinute: path.pathCapacityPerMinute,
        destinationSpareCapacity: 0,
        destinationOccupancyRatio: 1,
        accessible: path.accessible,
        confidence: 0,
        reasons: ['destination is not present in the active venue twin or reserve set'],
      };
    }

    if (input.requiresAccessible && !path.accessible) {
      decision = 'blocked';
      reasons.push('path does not preserve the configured accessibility requirement');
    }
    if (path.pathCapacityPerMinute < minimumPathCapacity) {
      decision = 'blocked';
      reasons.push('path capacity is below the configured routing floor');
    }
    if (reserve.spareCapacity < minimumSpareCapacity) {
      decision = 'blocked';
      reasons.push('destination does not have enough spare capacity for relief routing');
    }
    if (destination.state === 'saturated' || destination.state === 'recovering') {
      decision = 'blocked';
      reasons.push('destination is not in a state that should receive additional aggregate flow');
    }
    if (destination.confidence < 0.55) {
      decision = 'blocked';
      reasons.push('destination confidence is below the routing floor');
    } else if (decision !== 'blocked' && destination.confidence < 0.72) {
      decision = 'review';
      reasons.push('destination confidence supports review but not strong routing authority');
    }
    if (input.topology.singleLinkDependencyZoneIds.includes(toZoneId) && decision === 'eligible') {
      decision = 'review';
      reasons.push('destination depends on a single usable topology link');
    }

    const pathCapacityScore = clamp01(path.pathCapacityPerMinute / 60);
    const spareScore = clamp01(reserve.spareCapacity / Math.max(1, destination.capacity * 0.45));
    const pressureScore = clamp01(1 - destination.occupancyRatio);
    const topologyScore = clamp01(input.topology.redundancyScore * 0.6 + path.score * 0.4);
    const confidence = clamp01(destination.confidence * 0.7 + reserve.confidence * 0.3);
    const score = decision === 'blocked'
      ? 0
      : clamp01(
        pathCapacityScore * 0.27
        + spareScore * 0.28
        + pressureScore * 0.18
        + topologyScore * 0.12
        + confidence * 0.15,
      );

    if (reasons.length === 0) reasons.push('path capacity, destination headroom, accessibility, and confidence satisfy the normal venue-routing policy');

    return {
      fromZoneId: input.fromZoneId,
      toZoneId,
      decision,
      score,
      pathZoneIds: path.zoneIds,
      linkIds: path.linkIds,
      pathCapacityPerMinute: path.pathCapacityPerMinute,
      destinationSpareCapacity: reserve.spareCapacity,
      destinationOccupancyRatio: destination.occupancyRatio,
      accessible: path.accessible,
      confidence,
      reasons,
    };
  }).sort((a, b) => {
    const rank: Record<VenueRouteDecision, number> = { eligible: 3, review: 2, blocked: 1 };
    return rank[b.decision] - rank[a.decision] || b.score - a.score || a.toZoneId.localeCompare(b.toZoneId);
  });

  const primary = candidates.find((candidate) => candidate.decision !== 'blocked') ?? null;
  const blockedCount = candidates.filter((candidate) => candidate.decision === 'blocked').length;
  const reason = primary
    ? `${primary.toZoneId} is the strongest currently reachable relief destination after path, headroom, accessibility, and confidence checks.`
    : candidateZoneIds.length === 0
      ? 'No venue zone currently qualifies as trustworthy relief capacity.'
      : 'Spare capacity exists, but no candidate currently satisfies the topology-aware routing policy.';

  return { candidates, primary, blockedCount, reason };
}
