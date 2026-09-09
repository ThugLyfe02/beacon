import {
  analyzeInternalGraph,
  type InternalGraphAnalysis,
  type InternalGraphEdge,
  type InternalGraphPayload,
} from './InternalGraphEngine';

export interface InternalGraphForensicBroker {
  nodeId: string;
  forensicScore: number;
  brokerScore: number;
  participationCoefficient: number;
  effectiveSize: number;
  redundancyRatio: number;
  crossCommunityCount: number;
  articulation: boolean;
  dependentComponentCount: number;
  reasons: string[];
}

export interface InternalGraphCriticalBridge {
  edgeId: string;
  source: string;
  target: string;
  relation: string;
  edgeSurprisal: number;
  disconnectsGraph: boolean;
  reasons: string[];
}

export interface InternalGraphStructuralForensics {
  brokers: InternalGraphForensicBroker[];
  articulationNodeIds: string[];
  bridgeEdgeIds: string[];
  criticalBridges: InternalGraphCriticalBridge[];
  structuralDependence: number;
  largestBrokerDependence: number;
  summary: string;
  methodologyNote: string;
}

interface Neighbor {
  nodeId: string;
  edge: InternalGraphEdge;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildAdjacency(payload: InternalGraphPayload): Map<string, Neighbor[]> {
  const graph = new Map<string, Neighbor[]>();
  for (const node of payload.nodes) graph.set(node.id, []);
  for (const edge of payload.edges) {
    if (!graph.has(edge.source) || !graph.has(edge.target)) continue;
    graph.get(edge.source)!.push({ nodeId: edge.target, edge });
    graph.get(edge.target)!.push({ nodeId: edge.source, edge });
  }
  for (const neighbors of graph.values()) neighbors.sort((a, b) => stableCompare(a.nodeId, b.nodeId));
  return graph;
}

function canonicalEdgeKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

/** Tarjan articulation/bridge analysis over the explainable graph. */
function criticalStructure(payload: InternalGraphPayload): {
  articulation: Set<string>;
  bridgePairs: Set<string>;
  dependentComponents: Map<string, number>;
} {
  const graph = buildAdjacency(payload);
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulation = new Set<string>();
  const bridgePairs = new Set<string>();
  const dependentComponents = new Map<string, number>();
  let clock = 0;

  const visit = (nodeId: string) => {
    clock += 1;
    discovery.set(nodeId, clock);
    low.set(nodeId, clock);
    let children = 0;
    let separatedChildren = 0;

    for (const neighbor of graph.get(nodeId) ?? []) {
      const next = neighbor.nodeId;
      if (!discovery.has(next)) {
        children += 1;
        parent.set(next, nodeId);
        visit(next);
        low.set(nodeId, Math.min(low.get(nodeId)!, low.get(next)!));

        if (low.get(next)! > discovery.get(nodeId)!) {
          bridgePairs.add(canonicalEdgeKey(nodeId, next));
        }

        const isRoot = (parent.get(nodeId) ?? null) === null;
        if ((!isRoot && low.get(next)! >= discovery.get(nodeId)!) || (isRoot && children > 1)) {
          articulation.add(nodeId);
          separatedChildren += 1;
        }
      } else if (next !== parent.get(nodeId)) {
        low.set(nodeId, Math.min(low.get(nodeId)!, discovery.get(next)!));
      }
    }

    if (articulation.has(nodeId)) {
      dependentComponents.set(nodeId, Math.max(2, separatedChildren + 1));
    }
  };

  for (const node of [...payload.nodes].sort((a, b) => stableCompare(a.id, b.id))) {
    if (!discovery.has(node.id)) {
      parent.set(node.id, null);
      visit(node.id);
    }
  }

  return { articulation, bridgePairs, dependentComponents };
}

function communityMap(analysis: InternalGraphAnalysis): Map<string, number> {
  return new Map(analysis.metrics.map((metric) => [metric.nodeId, metric.communityId] as const));
}

/**
 * Participation coefficient from Guimerà/Amaral-style community participation:
 * 0 means almost all ties remain inside one community; values toward 1 mean ties
 * are distributed across several communities.
 */
function participationCoefficient(
  nodeId: string,
  graph: Map<string, Neighbor[]>,
  communities: Map<string, number>,
): number {
  const neighbors = graph.get(nodeId) ?? [];
  if (neighbors.length < 2) return 0;
  const counts = new Map<number, number>();
  for (const neighbor of neighbors) {
    const communityId = communities.get(neighbor.nodeId) ?? -1;
    counts.set(communityId, (counts.get(communityId) ?? 0) + 1);
  }
  const degree = neighbors.length;
  let concentration = 0;
  for (const count of counts.values()) concentration += (count / degree) ** 2;
  return Math.max(0, Math.min(1, 1 - concentration));
}

/**
 * Burt-style effective-size approximation. A broker with many neighbors who are
 * already connected to one another has lower effective size than a broker whose
 * contacts reach otherwise separate pockets of the graph.
 */
function effectiveSize(nodeId: string, graph: Map<string, Neighbor[]>): number {
  const neighbors = graph.get(nodeId) ?? [];
  const degree = neighbors.length;
  if (degree <= 1) return degree;
  const neighborSet = new Set(neighbors.map((neighbor) => neighbor.nodeId));
  let neighborNeighborLinks = 0;
  for (const neighbor of neighbors) {
    for (const second of graph.get(neighbor.nodeId) ?? []) {
      if (neighborSet.has(second.nodeId)) neighborNeighborLinks += 1;
    }
  }
  const redundantTies = neighborNeighborLinks / 2;
  return Math.max(1, degree - (2 * redundantTies) / degree);
}

function edgeSurprisal(
  edge: InternalGraphEdge,
  degree: Map<string, number>,
  edgeCount: number,
): number {
  if (edgeCount <= 0) return 0;
  const leftDegree = degree.get(edge.source) ?? 1;
  const rightDegree = degree.get(edge.target) ?? 1;
  const expected = Math.max(1e-6, Math.min(0.999999, (leftDegree * rightDegree) / (2 * edgeCount)));
  return -Math.log2(expected);
}

/**
 * Structural forensics describes graph topology only. `forensicScore` is not a
 * human-value score and must never be interpreted as trustworthiness, compatibility,
 * social worth, or influence outside the bounded evidence graph.
 */
export function analyzeInternalGraphForensics(
  payload: InternalGraphPayload,
  analysis = analyzeInternalGraph(payload),
): InternalGraphStructuralForensics {
  const graph = buildAdjacency(payload);
  const communities = communityMap(analysis);
  const metricByNode = new Map(analysis.metrics.map((metric) => [metric.nodeId, metric] as const));
  const degree = new Map<string, number>(
    payload.nodes.map((node) => [node.id, graph.get(node.id)?.length ?? 0] as [string, number]),
  );
  const critical = criticalStructure(payload);

  const brokers = payload.nodes.map<InternalGraphForensicBroker>((node) => {
    const neighbors = graph.get(node.id) ?? [];
    const metric = metricByNode.get(node.id);
    const participation = participationCoefficient(node.id, graph, communities);
    const effective = effectiveSize(node.id, graph);
    const redundancyRatio = neighbors.length > 0 ? 1 - effective / neighbors.length : 0;
    const ownCommunity = communities.get(node.id) ?? -1;
    const crossCommunities = new Set(
      neighbors
        .map((neighbor) => communities.get(neighbor.nodeId) ?? -1)
        .filter((communityId) => communityId !== ownCommunity && communityId >= 0),
    );
    const articulation = critical.articulation.has(node.id);
    const dependentComponentCount = critical.dependentComponents.get(node.id) ?? 1;
    const brokerScore = metric?.brokerScore ?? 0;

    let forensicScore = brokerScore * (0.55 + participation * 0.45);
    forensicScore *= 0.7 + Math.log2(1 + effective) * 0.3;
    if (articulation) forensicScore *= 1.65;
    if (crossCommunities.size >= 2) forensicScore *= 1.15;

    const reasons: string[] = [];
    if (articulation) reasons.push(`removal separates at least ${dependentComponentCount} graph regions`);
    if (participation >= 0.55) reasons.push('ties are distributed across multiple communities');
    if (effective >= Math.max(3, neighbors.length * 0.65)) reasons.push('low neighbor redundancy / high effective network size');
    if (crossCommunities.size >= 2) reasons.push(`directly spans ${crossCommunities.size} external communities`);
    if (brokerScore > 0) reasons.push('carries weighted cross-community evidence');

    return {
      nodeId: node.id,
      forensicScore,
      brokerScore,
      participationCoefficient: participation,
      effectiveSize: effective,
      redundancyRatio: Math.max(0, Math.min(1, redundancyRatio)),
      crossCommunityCount: crossCommunities.size,
      articulation,
      dependentComponentCount,
      reasons,
    };
  }).sort((left, right) => right.forensicScore - left.forensicScore || stableCompare(left.nodeId, right.nodeId));

  const criticalBridges = payload.edges.map<InternalGraphCriticalBridge>((edge) => {
    const disconnectsGraph = critical.bridgePairs.has(canonicalEdgeKey(edge.source, edge.target));
    const surprisal = edgeSurprisal(edge, degree, payload.edges.length);
    const reasons: string[] = [];
    if (disconnectsGraph) reasons.push('edge is a graph-theoretic bridge: removing it disconnects reachable topology');
    if (surprisal >= 4) reasons.push('connection is statistically unexpected under degree-preserving baseline');
    if (edge.confidence === 'VERIFIED') reasons.push('relationship has verified source evidence');
    if (edge.evidenceCount > 1) reasons.push(`relationship repeated across ${edge.evidenceCount} evidence observations`);
    return {
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      edgeSurprisal: surprisal,
      disconnectsGraph,
      reasons,
    };
  }).filter((edge) => edge.disconnectsGraph || edge.edgeSurprisal >= 3.5)
    .sort((left, right) => {
      if (left.disconnectsGraph !== right.disconnectsGraph) return left.disconnectsGraph ? -1 : 1;
      return right.edgeSurprisal - left.edgeSurprisal || stableCompare(left.edgeId, right.edgeId);
    });

  const people = payload.nodes.filter((node) => node.kind === 'person');
  const articulationPeople = brokers.filter((broker) => critical.articulation.has(broker.nodeId)
    && people.some((person) => person.id === broker.nodeId));
  const structuralDependence = people.length > 0
    ? articulationPeople.length / people.length
    : 0;
  const largestBrokerDependence = brokers[0]?.forensicScore ?? 0;

  return {
    brokers,
    articulationNodeIds: [...critical.articulation].sort(stableCompare),
    bridgeEdgeIds: payload.edges
      .filter((edge) => critical.bridgePairs.has(canonicalEdgeKey(edge.source, edge.target)))
      .map((edge) => edge.id)
      .sort(stableCompare),
    criticalBridges,
    structuralDependence,
    largestBrokerDependence,
    summary: critical.articulation.size > 0
      ? `${critical.articulation.size} articulation point${critical.articulation.size === 1 ? '' : 's'} and ${critical.bridgePairs.size} graph bridge${critical.bridgePairs.size === 1 ? '' : 's'} create measurable structural dependence.`
      : 'No single articulation point currently disconnects the explainable graph.',
    methodologyNote: 'Structural position only: this is not a human-value score and does not estimate trust, compatibility, consent, or importance outside the bounded evidence graph.',
  };
}
