import type {
  InternalGraphConfidence,
  InternalGraphEdge,
  InternalGraphPayload,
} from './InternalGraphEngine';

export type InternalImpactDirection = 'outbound' | 'inbound' | 'both';

export interface InternalImpactHit {
  nodeId: string;
  depth: number;
  viaEdgeId: string;
  relation: string;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  structuralWeight: number;
  confidenceFloor: InternalGraphConfidence;
}

export interface InternalImpactBottleneck {
  nodeId: string;
  pathCount: number;
  weightedPathCount: number;
  maxDepthBeyond: number;
}

export interface InternalGraphImpactResult {
  seedNodeId: string;
  direction: InternalImpactDirection;
  depth: number;
  relations: string[] | null;
  hits: InternalImpactHit[];
  nodeIds: string[];
  edgeIds: string[];
  bottlenecks: InternalImpactBottleneck[];
  relationCounts: Record<string, number>;
  verifiedHitRatio: number;
  methodologyNote: string;
}

interface TraversalEdge {
  nextNodeId: string;
  edge: InternalGraphEdge;
}

const CONFIDENCE_RANK: Record<InternalGraphConfidence, number> = {
  AMBIGUOUS: 0,
  DERIVED: 1,
  VERIFIED: 2,
};

const CONFIDENCE_WEIGHT: Record<InternalGraphConfidence, number> = {
  VERIFIED: 1,
  DERIVED: 0.72,
  AMBIGUOUS: 0.4,
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function confidenceFloor(
  current: InternalGraphConfidence,
  next: InternalGraphConfidence,
): InternalGraphConfidence {
  return CONFIDENCE_RANK[next] < CONFIDENCE_RANK[current] ? next : current;
}

function edgeWeight(edge: InternalGraphEdge): number {
  const confidence = CONFIDENCE_WEIGHT[edge.confidence];
  const evidence = Math.log2(2 + Math.max(1, edge.evidenceCount));
  const strength = Math.log2(1 + Math.max(0.01, edge.strength));
  return Math.max(0.05, confidence * evidence * (0.7 + strength * 0.3));
}

function traversalEdges(
  payload: InternalGraphPayload,
  nodeId: string,
  direction: InternalImpactDirection,
  relations: ReadonlySet<string> | null,
): TraversalEdge[] {
  const rows: TraversalEdge[] = [];
  for (const edge of payload.edges) {
    if (relations && !relations.has(edge.relation)) continue;
    if (!edge.directed) {
      if (edge.source === nodeId) rows.push({ nextNodeId: edge.target, edge });
      else if (edge.target === nodeId) rows.push({ nextNodeId: edge.source, edge });
      continue;
    }

    if ((direction === 'outbound' || direction === 'both') && edge.source === nodeId) {
      rows.push({ nextNodeId: edge.target, edge });
    }
    if ((direction === 'inbound' || direction === 'both') && edge.target === nodeId) {
      rows.push({ nextNodeId: edge.source, edge });
    }
  }
  return rows.sort((left, right) =>
    stableCompare(left.nextNodeId, right.nextNodeId)
    || stableCompare(left.edge.relation, right.edge.relation)
    || stableCompare(left.edge.id, right.edge.id));
}

/**
 * Relation-aware structural blast radius inspired by Graphify's affected-graph
 * traversal. This reports graph reachability through already-authorized Beacon
 * evidence; it does not claim a social, causal, behavioral, or business outcome
 * would occur if a node changed or disappeared.
 */
export function analyzeInternalGraphImpact(
  payload: InternalGraphPayload,
  seedNodeId: string,
  options: {
    direction?: InternalImpactDirection;
    depth?: number;
    relations?: string[] | null;
    maxHits?: number;
  } = {},
): InternalGraphImpactResult {
  const nodeIds = new Set(payload.nodes.map((node) => node.id));
  if (!nodeIds.has(seedNodeId)) {
    return {
      seedNodeId,
      direction: options.direction ?? 'both',
      depth: Math.max(1, Math.min(options.depth ?? 3, 6)),
      relations: options.relations ?? null,
      hits: [],
      nodeIds: [],
      edgeIds: [],
      bottlenecks: [],
      relationCounts: {},
      verifiedHitRatio: 0,
      methodologyNote: 'Structural reachability only; no causal or human-value claim is implied.',
    };
  }

  const direction = options.direction ?? 'both';
  const depth = Math.max(1, Math.min(options.depth ?? 3, 6));
  const maxHits = Math.max(1, Math.min(options.maxHits ?? 240, 1200));
  const relationFilter = options.relations && options.relations.length > 0
    ? new Set(options.relations)
    : null;
  const seenDepth = new Map<string, number>([[seedNodeId, 0]]);
  const queue: Array<{
    nodeId: string;
    depth: number;
    pathNodeIds: string[];
    pathEdgeIds: string[];
    weight: number;
    confidence: InternalGraphConfidence;
  }> = [{
    nodeId: seedNodeId,
    depth: 0,
    pathNodeIds: [seedNodeId],
    pathEdgeIds: [],
    weight: 1,
    confidence: 'VERIFIED',
  }];
  const hits: InternalImpactHit[] = [];

  while (queue.length > 0 && hits.length < maxHits) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;

    for (const traversal of traversalEdges(payload, current.nodeId, direction, relationFilter)) {
      if (!nodeIds.has(traversal.nextNodeId)) continue;
      if (current.pathNodeIds.includes(traversal.nextNodeId)) continue;

      const nextDepth = current.depth + 1;
      const previousDepth = seenDepth.get(traversal.nextNodeId);
      if (previousDepth != null && previousDepth < nextDepth) continue;

      const nextWeight = current.weight * edgeWeight(traversal.edge);
      const nextConfidence = confidenceFloor(current.confidence, traversal.edge.confidence);
      const nextPathNodes = [...current.pathNodeIds, traversal.nextNodeId];
      const nextPathEdges = [...current.pathEdgeIds, traversal.edge.id];

      if (previousDepth == null || nextDepth <= previousDepth) {
        seenDepth.set(traversal.nextNodeId, nextDepth);
        hits.push({
          nodeId: traversal.nextNodeId,
          depth: nextDepth,
          viaEdgeId: traversal.edge.id,
          relation: traversal.edge.relation,
          pathNodeIds: nextPathNodes,
          pathEdgeIds: nextPathEdges,
          structuralWeight: nextWeight,
          confidenceFloor: nextConfidence,
        });
      }

      if (nextDepth < depth && queue.length < maxHits * 3) {
        queue.push({
          nodeId: traversal.nextNodeId,
          depth: nextDepth,
          pathNodeIds: nextPathNodes,
          pathEdgeIds: nextPathEdges,
          weight: nextWeight,
          confidence: nextConfidence,
        });
      }
      if (hits.length >= maxHits) break;
    }
  }

  const uniqueHits = new Map<string, InternalImpactHit>();
  for (const hit of hits) {
    const existing = uniqueHits.get(hit.nodeId);
    if (!existing
      || hit.depth < existing.depth
      || (hit.depth === existing.depth && hit.structuralWeight > existing.structuralWeight)) {
      uniqueHits.set(hit.nodeId, hit);
    }
  }

  const rankedHits = [...uniqueHits.values()].sort((left, right) =>
    left.depth - right.depth
    || right.structuralWeight - left.structuralWeight
    || stableCompare(left.nodeId, right.nodeId));
  const edgeIds = new Set<string>();
  const relationCounts: Record<string, number> = {};
  const bottleneck = new Map<string, InternalImpactBottleneck>();

  for (const hit of rankedHits) {
    hit.pathEdgeIds.forEach((edgeId) => edgeIds.add(edgeId));
    relationCounts[hit.relation] = (relationCounts[hit.relation] ?? 0) + 1;
    const internalNodes = hit.pathNodeIds.slice(1, -1);
    for (const nodeId of internalNodes) {
      const current = bottleneck.get(nodeId) ?? {
        nodeId,
        pathCount: 0,
        weightedPathCount: 0,
        maxDepthBeyond: 0,
      };
      current.pathCount += 1;
      current.weightedPathCount += hit.structuralWeight;
      const index = hit.pathNodeIds.indexOf(nodeId);
      current.maxDepthBeyond = Math.max(current.maxDepthBeyond, hit.pathNodeIds.length - index - 1);
      bottleneck.set(nodeId, current);
    }
  }

  const bottlenecks = [...bottleneck.values()]
    .sort((left, right) =>
      right.pathCount - left.pathCount
      || right.weightedPathCount - left.weightedPathCount
      || right.maxDepthBeyond - left.maxDepthBeyond
      || stableCompare(left.nodeId, right.nodeId))
    .slice(0, 24);
  const verifiedHits = rankedHits.filter((hit) => hit.confidenceFloor === 'VERIFIED').length;

  return {
    seedNodeId,
    direction,
    depth,
    relations: relationFilter ? [...relationFilter].sort(stableCompare) : null,
    hits: rankedHits,
    nodeIds: [seedNodeId, ...rankedHits.map((hit) => hit.nodeId)],
    edgeIds: [...edgeIds].sort(stableCompare),
    bottlenecks,
    relationCounts,
    verifiedHitRatio: rankedHits.length > 0 ? verifiedHits / rankedHits.length : 0,
    methodologyNote: 'Impact means explainable graph reachability under the selected relation/direction rules. It does not predict consent, behavior, compatibility, causation, or human importance.',
  };
}
