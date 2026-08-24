import type { VenueTwinZoneKind } from './SpatialVenueTwinEngine';

export interface VenueTopologyZone {
  id: string;
  kind: VenueTwinZoneKind;
  operationalCapacity: number;
  enabled: boolean;
}

export interface VenueTopologyLink {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  capacityPerMinute: number;
  accessible: boolean;
  enabled: boolean;
  bidirectional: boolean;
}

export interface VenueTopologyState {
  zones: VenueTopologyZone[];
  links: VenueTopologyLink[];
  disconnectedZoneIds: string[];
  singleLinkDependencyZoneIds: string[];
  bottleneckLinkIds: string[];
  accessibleCoverage: number;
  redundancyScore: number;
  totalDirectedCapacityPerMinute: number;
  reasons: string[];
}

export interface VenueReliefPath {
  zoneIds: string[];
  linkIds: string[];
  hopCount: number;
  pathCapacityPerMinute: number;
  accessible: boolean;
  score: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildAdjacency(zones: VenueTopologyZone[], links: VenueTopologyLink[]) {
  const enabledZoneIds = new Set(zones.filter((zone) => zone.enabled).map((zone) => zone.id));
  const adjacency = new Map<string, Array<{ zoneId: string; link: VenueTopologyLink }>>();
  for (const zoneId of enabledZoneIds) adjacency.set(zoneId, []);

  for (const link of links) {
    if (!link.enabled || !enabledZoneIds.has(link.fromZoneId) || !enabledZoneIds.has(link.toZoneId)) continue;
    adjacency.get(link.fromZoneId)?.push({ zoneId: link.toZoneId, link });
    if (link.bidirectional) adjacency.get(link.toZoneId)?.push({ zoneId: link.fromZoneId, link });
  }

  for (const edges of adjacency.values()) {
    edges.sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.link.id.localeCompare(b.link.id));
  }
  return adjacency;
}

/**
 * Treats semantic venue zones as a graph rather than a flat list. This closes a
 * major operational gap: spare capacity is not useful if the venue cannot reach
 * it through an enabled, sufficiently wide, and—when required—accessible path.
 * The analysis is zone-level and makes no claim about individual evacuation or
 * emergency routing.
 */
export function analyzeVenueTopology(
  zones: VenueTopologyZone[],
  links: VenueTopologyLink[],
): VenueTopologyState {
  const adjacency = buildAdjacency(zones, links);
  const enabledZones = zones.filter((zone) => zone.enabled);
  const degrees = new Map<string, number>();
  for (const zone of enabledZones) degrees.set(zone.id, adjacency.get(zone.id)?.length ?? 0);

  const disconnectedZoneIds = enabledZones
    .filter((zone) => (degrees.get(zone.id) ?? 0) === 0)
    .map((zone) => zone.id)
    .sort();
  const singleLinkDependencyZoneIds = enabledZones
    .filter((zone) => zone.kind !== 'entry' && (degrees.get(zone.id) ?? 0) === 1)
    .map((zone) => zone.id)
    .sort();

  const enabledLinks = links.filter((link) => link.enabled);
  const directedCapacity = enabledLinks.reduce(
    (sum, link) => sum + Math.max(0, link.capacityPerMinute) * (link.bidirectional ? 2 : 1),
    0,
  );
  const meanLinkCapacity = enabledLinks.length === 0
    ? 0
    : enabledLinks.reduce((sum, link) => sum + Math.max(0, link.capacityPerMinute), 0) / enabledLinks.length;
  const bottleneckLinkIds = enabledLinks
    .filter((link) => meanLinkCapacity > 0 && link.capacityPerMinute < meanLinkCapacity * 0.55)
    .map((link) => link.id)
    .sort();

  const accessibleZoneIds = new Set<string>();
  for (const link of enabledLinks) {
    if (!link.accessible) continue;
    accessibleZoneIds.add(link.fromZoneId);
    accessibleZoneIds.add(link.toZoneId);
  }
  const accessibleCoverage = enabledZones.length === 0 ? 0 : accessibleZoneIds.size / enabledZones.length;
  const redundancyScore = enabledZones.length === 0
    ? 0
    : enabledZones.reduce((sum, zone) => sum + clamp01((degrees.get(zone.id) ?? 0) / 2), 0) / enabledZones.length;

  const reasons: string[] = [];
  if (disconnectedZoneIds.length > 0) reasons.push(`${disconnectedZoneIds.length} enabled zone${disconnectedZoneIds.length === 1 ? ' has' : 's have'} no usable topology link`);
  if (singleLinkDependencyZoneIds.length > 0) reasons.push(`${singleLinkDependencyZoneIds.length} non-entry zone${singleLinkDependencyZoneIds.length === 1 ? ' depends' : 's depend'} on a single route`);
  if (bottleneckLinkIds.length > 0) reasons.push(`${bottleneckLinkIds.length} enabled link${bottleneckLinkIds.length === 1 ? ' is' : 's are'} materially narrower than the venue mean`);
  if (accessibleCoverage < 0.8 && enabledZones.length > 0) reasons.push('accessible route coverage does not span enough enabled venue zones');
  if (reasons.length === 0) reasons.push('venue topology has broad connectivity, route redundancy, and accessible coverage');

  return {
    zones: [...zones],
    links: [...links],
    disconnectedZoneIds,
    singleLinkDependencyZoneIds,
    bottleneckLinkIds,
    accessibleCoverage: clamp01(accessibleCoverage),
    redundancyScore: clamp01(redundancyScore),
    totalDirectedCapacityPerMinute: directedCapacity,
    reasons,
  };
}

export function findVenueReliefPaths(
  topology: VenueTopologyState,
  fromZoneId: string,
  candidateZoneIds: string[],
  requiresAccessible: boolean,
  maxHops = 4,
): VenueReliefPath[] {
  const candidateSet = new Set(candidateZoneIds);
  const adjacency = buildAdjacency(topology.zones, topology.links);
  if (!adjacency.has(fromZoneId)) return [];

  type QueueItem = {
    zoneId: string;
    zoneIds: string[];
    linkIds: string[];
    capacity: number;
    accessible: boolean;
  };
  const queue: QueueItem[] = [{
    zoneId: fromZoneId,
    zoneIds: [fromZoneId],
    linkIds: [],
    capacity: Number.POSITIVE_INFINITY,
    accessible: true,
  }];
  const bestHops = new Map<string, number>([[fromZoneId, 0]]);
  const paths: VenueReliefPath[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const hops = current.linkIds.length;
    if (hops >= maxHops) continue;

    for (const edge of adjacency.get(current.zoneId) ?? []) {
      if (current.zoneIds.includes(edge.zoneId)) continue;
      const accessible = current.accessible && edge.link.accessible;
      if (requiresAccessible && !accessible) continue;
      const nextHops = hops + 1;
      const previousBest = bestHops.get(edge.zoneId);
      if (previousBest !== undefined && nextHops > previousBest + 1) continue;
      bestHops.set(edge.zoneId, Math.min(previousBest ?? nextHops, nextHops));

      const pathCapacity = Math.min(current.capacity, Math.max(0, edge.link.capacityPerMinute));
      const next: QueueItem = {
        zoneId: edge.zoneId,
        zoneIds: [...current.zoneIds, edge.zoneId],
        linkIds: [...current.linkIds, edge.link.id],
        capacity: pathCapacity,
        accessible,
      };

      if (candidateSet.has(edge.zoneId)) {
        const capacityScore = clamp01(pathCapacity / 60);
        const hopScore = clamp01(1 - (nextHops - 1) * 0.18);
        paths.push({
          zoneIds: next.zoneIds,
          linkIds: next.linkIds,
          hopCount: nextHops,
          pathCapacityPerMinute: pathCapacity,
          accessible,
          score: clamp01(capacityScore * 0.7 + hopScore * 0.3),
        });
      }

      queue.push(next);
    }
  }

  return paths.sort((a, b) => b.score - a.score || b.pathCapacityPerMinute - a.pathCapacityPerMinute || a.zoneIds.join('>').localeCompare(b.zoneIds.join('>')));
}
