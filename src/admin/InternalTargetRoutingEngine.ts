import {
  analyzeInternalGraph,
  type InternalGraphConfidence,
  type InternalGraphEdge,
  type InternalGraphPayload,
} from './InternalGraphEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';
import type { InternalBridgePattern } from './InternalGraphStrategyEngine';

export interface InternalTargetRouteEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  traversedForward: boolean;
  confidence: InternalGraphConfidence;
  evidenceCount: number;
  strength: number;
  firstSeenAt: string;
  lastSeenAt: string;
  evidenceScore: number;
}

export interface InternalTargetRoute {
  id: string;
  targetNodeId: string;
  targetLabel: string;
  targetKind: string;
  nodeIds: string[];
  edges: InternalTargetRouteEdge[];
  hopCount: number;
  score: number;
  evidenceQuality: number;
  verifiedEdgeRatio: number;
  confidenceFloor: InternalGraphConfidence;
  freshness: number;
  communityCrossings: number;
  articulationExposure: number;
  graphBridgeExposure: number;
  historicalPrior: number;
  redundancy: number;
  rationale: string[];
  warnings: string[];
}

export interface InternalTargetRoutingPortfolio {
  generatedAt: string;
  graphVersion: string;
  sourceNodeId: string;
  targetQuery: string;
  matchedTargetCount: number;
  candidatePathCount: number;
  routes: InternalTargetRoute[];
  routeDiversity: number;
  structuralSinglePointNodeIds: string[];
  operatingRule: string;
}

interface TraversalEdge {
  edge: InternalGraphEdge;
  from: string;
  to: string;
  traversedForward: boolean;
}

const CONFIDENCE_RANK: Record<InternalGraphConfidence, number> = {
  AMBIGUOUS: 0,
  DERIVED: 1,
  VERIFIED: 2,
};
const CONFIDENCE_SCORE: Record<InternalGraphConfidence, number> = {
  VERIFIED: 1,
  DERIVED: 0.72,
  AMBIGUOUS: 0.36,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function confidenceFloor(edges: InternalGraphEdge[]): InternalGraphConfidence {
  return edges.reduce<InternalGraphConfidence>(
    (floor, edge) => CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[floor] ? edge.confidence : floor,
    'VERIFIED',
  );
}

function recencyScore(timestamp: string, now = Date.now()): number {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 0.35;
  const days = Math.max(0, (now - parsed) / 86_400_000);
  return 0.25 + Math.exp(-days / 240) * 0.75;
}

function evidenceScore(edge: InternalGraphEdge, traversedForward: boolean): number {
  const confidence = CONFIDENCE_SCORE[edge.confidence];
  const strength = clamp01(Math.log2(1 + Math.max(0, edge.strength)) / 4);
  const repeated = clamp01(Math.log2(1 + Math.max(1, edge.evidenceCount)) / 5);
  const recency = recencyScore(edge.lastSeenAt);
  const direction = edge.directed && !traversedForward ? 0.84 : 1;
  return clamp01((confidence * 0.42 + strength * 0.22 + repeated * 0.18 + recency * 0.18) * direction);
}

function adjacency(payload: InternalGraphPayload): Map<string, TraversalEdge[]> {
  const graph = new Map<string, TraversalEdge[]>();
  for (const node of payload.nodes) graph.set(node.id, []);
  for (const edge of payload.edges) {
    graph.get(edge.source)?.push({ edge, from: edge.source, to: edge.target, traversedForward: true });
    graph.get(edge.target)?.push({ edge, from: edge.target, to: edge.source, traversedForward: !edge.directed });
  }
  for (const entries of graph.values()) {
    entries.sort((left, right) => {
      const scoreDelta = evidenceScore(right.edge, right.traversedForward) - evidenceScore(left.edge, left.traversedForward);
      return scoreDelta !== 0 ? scoreDelta : left.edge.id.localeCompare(right.edge.id);
    });
  }
  return graph;
}

function targetMatchScore(label: string, kind: string, query: string): number {
  const normalizedLabel = label.toLowerCase();
  const normalizedKind = kind.toLowerCase();
  if (normalizedLabel === query) return 1;
  if (normalizedKind === query) return 0.92;
  if (normalizedLabel.startsWith(query)) return 0.88;
  if (normalizedLabel.includes(query)) return 0.8;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => normalizedLabel.includes(token))) return 0.74;
  return 0;
}

function enumeratePaths(input: {
  payload: InternalGraphPayload;
  sourceNodeId: string;
  targetNodeIds: Set<string>;
  suppressions: ReadonlySet<string>;
  maxHops: number;
  maxCandidates: number;
  maxExpansions: number;
}): Array<{ targetNodeId: string; nodes: string[]; traversals: TraversalEdge[] }> {
  const graph = adjacency(input.payload);
  const nodeById = new Map(input.payload.nodes.map((node) => [node.id, node] as const));
  const results: Array<{ targetNodeId: string; nodes: string[]; traversals: TraversalEdge[] }> = [];
  const queue: Array<{ nodeId: string; nodes: string[]; traversals: TraversalEdge[]; quality: number }> = [
    { nodeId: input.sourceNodeId, nodes: [input.sourceNodeId], traversals: [], quality: 1 },
  ];
  let expansions = 0;

  while (queue.length > 0 && results.length < input.maxCandidates && expansions < input.maxExpansions) {
    queue.sort((left, right) => right.quality - left.quality || left.nodes.join('|').localeCompare(right.nodes.join('|')));
    const current = queue.shift()!;
    if (current.traversals.length >= input.maxHops) continue;

    for (const traversal of graph.get(current.nodeId) ?? []) {
      expansions += 1;
      if (expansions > input.maxExpansions) break;
      if (current.nodes.includes(traversal.to)) continue;

      const fromNode = nodeById.get(current.nodeId);
      const toNode = nodeById.get(traversal.to);
      if (!fromNode || !toNode) continue;
      if (
        fromNode.kind === 'person'
        && toNode.kind === 'person'
        && input.suppressions.has(pairKey(fromNode.id, toNode.id))
      ) continue;

      const nodes = [...current.nodes, traversal.to];
      const traversals = [...current.traversals, traversal];
      const quality = current.quality * Math.max(0.08, evidenceScore(traversal.edge, traversal.traversedForward));
      if (input.targetNodeIds.has(traversal.to)) {
        results.push({ targetNodeId: traversal.to, nodes, traversals });
        if (results.length >= input.maxCandidates) break;
      }
      queue.push({ nodeId: traversal.to, nodes, traversals, quality });
    }
  }

  return results;
}

function historicalPriorForPath(
  nodes: string[],
  payload: InternalGraphPayload,
  patterns: InternalBridgePattern[],
): number {
  if (patterns.length === 0) return 0;
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const patternByKind = new Map(patterns.map((pattern) => [pattern.connectorKind, pattern] as const));
  const priors = nodes.slice(1, -1).flatMap((nodeId) => {
    const pattern = patternByKind.get(nodeById.get(nodeId)?.kind ?? '');
    if (!pattern || pattern.sampleSize < 3) return [];
    return [clamp01(pattern.outcomeRate * pattern.confidence)];
  });
  if (priors.length === 0) return 0;
  return priors.reduce((sum, value) => sum + value, 0) / priors.length;
}

function overlap(left: InternalTargetRoute, right: InternalTargetRoute): number {
  const leftEdges = new Set(left.edges.map((edge) => edge.edgeId));
  const rightEdges = new Set(right.edges.map((edge) => edge.edgeId));
  let intersection = 0;
  for (const edge of leftEdges) if (rightEdges.has(edge)) intersection += 1;
  return intersection / Math.max(1, Math.min(leftEdges.size, rightEdges.size));
}

function buildRoute(input: {
  payload: InternalGraphPayload;
  nodes: string[];
  traversals: TraversalEdge[];
  targetNodeId: string;
  targetMatch: number;
  patterns: InternalBridgePattern[];
  articulationIds: ReadonlySet<string>;
  criticalBridgeIds: ReadonlySet<string>;
  communityByNode: ReadonlyMap<string, number>;
}): InternalTargetRoute {
  const nodeById = new Map(input.payload.nodes.map((node) => [node.id, node] as const));
  const rawEdges = input.traversals.map((item) => item.edge);
  const edgeScores = input.traversals.map((item) => evidenceScore(item.edge, item.traversedForward));
  const evidenceQuality = edgeScores.length > 0
    ? edgeScores.reduce((sum, score) => sum + score, 0) / edgeScores.length
    : 0;
  const verifiedEdgeRatio = rawEdges.length > 0
    ? rawEdges.filter((edge) => edge.confidence === 'VERIFIED').length / rawEdges.length
    : 0;
  const freshness = rawEdges.length > 0
    ? rawEdges.reduce((sum, edge) => sum + recencyScore(edge.lastSeenAt), 0) / rawEdges.length
    : 0;
  let communityCrossings = 0;
  for (let index = 1; index < input.nodes.length; index += 1) {
    const previousCommunity = input.communityByNode.get(input.nodes[index - 1]);
    const currentCommunity = input.communityByNode.get(input.nodes[index]);
    if (previousCommunity != null && currentCommunity != null && previousCommunity !== currentCommunity) communityCrossings += 1;
  }
  const interiorNodes = input.nodes.slice(1, -1);
  const articulationExposure = interiorNodes.filter((id) => input.articulationIds.has(id)).length;
  const graphBridgeExposure = rawEdges.filter((edge) => input.criticalBridgeIds.has(edge.id)).length;
  const historicalPrior = historicalPriorForPath(input.nodes, input.payload, input.patterns);
  const floor = confidenceFloor(rawEdges);
  const hopEfficiency = 1 / Math.max(1, rawEdges.length);
  const bottleneckPenalty = clamp01(articulationExposure * 0.16 + graphBridgeExposure * 0.12);
  const excessiveCrossingPenalty = Math.max(0, communityCrossings - 2) * 0.05;
  const score = Math.max(0,
    input.targetMatch * 2.2
    + evidenceQuality * 2.1
    + verifiedEdgeRatio * 1.15
    + freshness * 0.8
    + hopEfficiency * 0.65
    + historicalPrior * 0.6
    + Math.min(2, communityCrossings) * 0.12
    - bottleneckPenalty * 1.8
    - excessiveCrossingPenalty,
  );

  const rationale = [
    `${rawEdges.length} explainable hop${rawEdges.length === 1 ? '' : 's'} to ${nodeById.get(input.targetNodeId)?.label ?? input.targetNodeId}`,
    `${Math.round(verifiedEdgeRatio * 100)}% of route edges are directly verified`,
    `evidence quality ${Math.round(evidenceQuality * 100)}% · freshness ${Math.round(freshness * 100)}%`,
    `${communityCrossings} community crossing${communityCrossings === 1 ? '' : 's'}`,
    ...(historicalPrior > 0 ? [`historical connector prior ${(historicalPrior * 100).toFixed(0)}% after confidence weighting; observational only`] : []),
  ];
  const warnings = [
    ...(floor === 'AMBIGUOUS' ? ['route contains ambiguous evidence'] : floor === 'DERIVED' ? ['route confidence floor is derived evidence'] : []),
    ...(articulationExposure > 0 ? [`${articulationExposure} interior articulation point${articulationExposure === 1 ? '' : 's'} create single-node dependence`] : []),
    ...(graphBridgeExposure > 0 ? [`${graphBridgeExposure} route edge${graphBridgeExposure === 1 ? '' : 's'} are graph bridges whose removal disconnects topology`] : []),
    ...(input.traversals.some((item) => item.edge.directed && !item.traversedForward) ? ['route traverses at least one directed relation in reverse for structural navigation; review semantics before acting'] : []),
  ];

  return {
    id: `${input.targetNodeId}:${rawEdges.map((edge) => edge.id).join(':')}`,
    targetNodeId: input.targetNodeId,
    targetLabel: nodeById.get(input.targetNodeId)?.label ?? input.targetNodeId,
    targetKind: nodeById.get(input.targetNodeId)?.kind ?? 'unknown',
    nodeIds: input.nodes,
    edges: input.traversals.map((item) => ({
      edgeId: item.edge.id,
      fromNodeId: item.from,
      toNodeId: item.to,
      relation: item.edge.relation,
      traversedForward: item.traversedForward,
      confidence: item.edge.confidence,
      evidenceCount: item.edge.evidenceCount,
      strength: item.edge.strength,
      firstSeenAt: item.edge.firstSeenAt,
      lastSeenAt: item.edge.lastSeenAt,
      evidenceScore: evidenceScore(item.edge, item.traversedForward),
    })),
    hopCount: rawEdges.length,
    score,
    evidenceQuality,
    verifiedEdgeRatio,
    confidenceFloor: floor,
    freshness,
    communityCrossings,
    articulationExposure,
    graphBridgeExposure,
    historicalPrior,
    redundancy: 0,
    rationale,
    warnings,
  };
}

/**
 * Build a diverse, explainable portfolio of routes into a target ecosystem.
 *
 * This is structural navigation over already-authorized Beacon evidence. A route
 * does not predict consent, compatibility, influence, or whether an introduction
 * should occur. Authoritative block suppressions are applied to person-person hops.
 */
export function buildInternalTargetRoutingPortfolio(input: {
  payload: InternalGraphPayload;
  sourceNodeId: string;
  targetQuery: string;
  patterns?: InternalBridgePattern[];
  suppressions: ReadonlySet<string>;
  maxHops?: number;
  maxRoutes?: number;
}): InternalTargetRoutingPortfolio {
  const query = input.targetQuery.trim().toLowerCase();
  const maxHops = Math.max(2, Math.min(input.maxHops ?? 6, 8));
  const maxRoutes = Math.max(1, Math.min(input.maxRoutes ?? 8, 12));
  if (!query || !input.payload.nodes.some((node) => node.id === input.sourceNodeId)) {
    return {
      generatedAt: new Date().toISOString(), graphVersion: input.payload.graphVersion, sourceNodeId: input.sourceNodeId,
      targetQuery: input.targetQuery.trim(), matchedTargetCount: 0, candidatePathCount: 0, routes: [], routeDiversity: 0,
      structuralSinglePointNodeIds: [], operatingRule: 'No route generated because the source or target ecosystem query is not present in the authorized graph.',
    };
  }

  const targets = input.payload.nodes
    .map((node) => ({ node, match: targetMatchScore(node.label, node.kind, query) }))
    .filter((row) => row.node.id !== input.sourceNodeId && row.match > 0)
    .sort((left, right) => right.match - left.match || left.node.label.localeCompare(right.node.label))
    .slice(0, 40);
  const targetNodeIds = new Set(targets.map((row) => row.node.id));
  const targetMatchById = new Map(targets.map((row) => [row.node.id, row.match] as const));
  const candidates = enumeratePaths({
    payload: input.payload,
    sourceNodeId: input.sourceNodeId,
    targetNodeIds,
    suppressions: input.suppressions,
    maxHops,
    maxCandidates: 120,
    maxExpansions: 6000,
  });

  const analysis = analyzeInternalGraph(input.payload);
  const forensics = analyzeInternalGraphForensics(input.payload, analysis);
  const articulationIds = new Set(forensics.articulationNodeIds);
  const criticalBridgeIds = new Set(forensics.criticalBridges.filter((edge) => edge.disconnectsGraph).map((edge) => edge.edgeId));
  const communityByNode = new Map(analysis.metrics.map((metric) => [metric.nodeId, metric.communityId] as const));

  const scored = candidates
    .map((candidate) => buildRoute({
      payload: input.payload,
      nodes: candidate.nodes,
      traversals: candidate.traversals,
      targetNodeId: candidate.targetNodeId,
      targetMatch: targetMatchById.get(candidate.targetNodeId) ?? 0,
      patterns: input.patterns ?? [],
      articulationIds,
      criticalBridgeIds,
      communityByNode,
    }))
    .sort((left, right) => right.score - left.score || left.hopCount - right.hopCount || left.id.localeCompare(right.id));

  const selected: InternalTargetRoute[] = [];
  const remaining = [...scored];
  while (selected.length < maxRoutes && remaining.length > 0) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const maxOverlap = selected.length === 0 ? 0 : Math.max(...selected.map((route) => overlap(route, candidate)));
      const adjusted = candidate.score - maxOverlap * 1.35;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    const [route] = remaining.splice(bestIndex, 1);
    const maxOverlap = selected.length === 0 ? 0 : Math.max(...selected.map((item) => overlap(item, route)));
    selected.push({ ...route, redundancy: maxOverlap });
  }

  const interiorCounts = new Map<string, number>();
  for (const route of selected) {
    for (const nodeId of new Set(route.nodeIds.slice(1, -1))) {
      interiorCounts.set(nodeId, (interiorCounts.get(nodeId) ?? 0) + 1);
    }
  }
  const structuralSinglePointNodeIds = [...interiorCounts.entries()]
    .filter(([, count]) => selected.length >= 2 && count === selected.length)
    .map(([nodeId]) => nodeId)
    .sort();
  const pairDiversities: number[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) pairDiversities.push(1 - overlap(selected[i], selected[j]));
  }

  return {
    generatedAt: new Date().toISOString(),
    graphVersion: input.payload.graphVersion,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery.trim(),
    matchedTargetCount: targets.length,
    candidatePathCount: candidates.length,
    routes: selected,
    routeDiversity: pairDiversities.length > 0 ? pairDiversities.reduce((sum, value) => sum + value, 0) / pairDiversities.length : selected.length === 1 ? 0 : 1,
    structuralSinglePointNodeIds,
    operatingRule: 'Routes describe explainable structural reachability over authorized Beacon evidence. They do not predict consent, compatibility, influence, or whether an introduction should occur; social action remains human-approved.',
  };
}
