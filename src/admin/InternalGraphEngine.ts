export type InternalGraphConfidence = 'VERIFIED' | 'DERIVED' | 'AMBIGUOUS';
export type InternalGraphSensitivity = 'standard' | 'restricted';

export interface InternalGraphNode {
  id: string;
  kind: string;
  label: string;
  sensitivity: InternalGraphSensitivity;
  firstSeenAt: string;
  lastSeenAt: string;
  attributes: Record<string, unknown>;
}

export interface InternalGraphEdge {
  id: string;
  scopeKey: string;
  source: string;
  target: string;
  relation: string;
  directed: boolean;
  confidence: InternalGraphConfidence;
  sensitivity: InternalGraphSensitivity;
  strength: number;
  firstSeenAt: string;
  lastSeenAt: string;
  evidenceCount: number;
  evidence: Record<string, unknown>;
}

export interface InternalGraphPayload {
  generatedAt: string;
  eventId: string | null;
  graphVersion: string;
  nodeCount: number;
  edgeCount: number;
  nodes: InternalGraphNode[];
  edges: InternalGraphEdge[];
}

export interface InternalGraphCommunity {
  id: number;
  label: string;
  nodeIds: string[];
  cohesion: number;
}

export interface InternalGraphNodeMetric {
  nodeId: string;
  weightedDegree: number;
  brokerScore: number;
  communityId: number;
}

export interface InternalGraphSurprise {
  edgeId: string;
  source: string;
  target: string;
  relation: string;
  score: number;
  why: string[];
}

export interface InternalBridgeCandidate {
  source: string;
  via: string;
  target: string;
  score: number;
  why: string[];
}

export interface InternalGraphPath {
  nodeIds: string[];
  edgeIds: string[];
  cost: number;
}

export interface InternalGraphDiff {
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
}

export interface InternalGraphLayoutPoint {
  nodeId: string;
  communityId: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface InternalGraphAnalysis {
  communities: InternalGraphCommunity[];
  metrics: InternalGraphNodeMetric[];
  hubNodeIds: string[];
  brokerNodeIds: string[];
  surprises: InternalGraphSurprise[];
  bridgeCandidates: InternalBridgeCandidate[];
  layout: InternalGraphLayoutPoint[];
}

const CONFIDENCE_WEIGHT: Record<InternalGraphConfidence, number> = {
  VERIFIED: 1,
  DERIVED: 0.7,
  AMBIGUOUS: 0.38,
};

const RELATION_PRIORITY: Record<string, number> = {
  outcome_completed: 4.4,
  outcome_aligned: 3.6,
  office_hours_with: 3,
  mutual_with: 2.5,
  signaled: 1.5,
  hosted: 1.4,
  attended: 1.2,
  follows: 0.7,
  has_role: 0.65,
  aligned_to_outcome: 1.6,
  at_venue: 0.8,
  has_room: 0.5,
  blocked: 1.4,
  reported: 1.8,
};

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeWeight(edge: InternalGraphEdge): number {
  const relationWeight = RELATION_PRIORITY[edge.relation] ?? 1;
  return Math.max(0.01, edge.strength) * CONFIDENCE_WEIGHT[edge.confidence] * relationWeight;
}

function adjacency(payload: InternalGraphPayload): Map<string, Array<{ nodeId: string; edge: InternalGraphEdge }>> {
  const map = new Map<string, Array<{ nodeId: string; edge: InternalGraphEdge }>>();
  for (const node of payload.nodes) map.set(node.id, []);
  for (const edge of payload.edges) {
    if (!map.has(edge.source) || !map.has(edge.target)) continue;
    map.get(edge.source)!.push({ nodeId: edge.target, edge });
    map.get(edge.target)!.push({ nodeId: edge.source, edge });
  }
  for (const entries of map.values()) {
    entries.sort((left, right) => stableCompare(left.nodeId, right.nodeId));
  }
  return map;
}

function degreeMap(payload: InternalGraphPayload): Map<string, number> {
  const degree = new Map(payload.nodes.map((node) => [node.id, 0] as const));
  for (const edge of payload.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
}

function hubCutoff(degrees: number[], percentile = 0.96): number {
  if (degrees.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...degrees].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentile)));
  return sorted[index];
}

/**
 * Deterministic weighted label propagation with high-degree hub suppression.
 * This intentionally mirrors Graphify's principle of excluding utility super-hubs
 * during community resolution, while remaining dependency-free for React Native.
 */
export function detectInternalGraphCommunities(
  payload: InternalGraphPayload,
): InternalGraphCommunity[] {
  if (payload.nodes.length === 0) return [];
  const graph = adjacency(payload);
  const degrees = degreeMap(payload);
  const cutoff = hubCutoff([...degrees.values()]);
  const hubs = new Set(
    [...degrees.entries()].filter(([, degree]) => degree > cutoff && degree >= 5).map(([id]) => id),
  );

  const labels = new Map(payload.nodes.map((node) => [node.id, node.id] as const));
  const ordered = [...payload.nodes].sort((a, b) => stableCompare(a.id, b.id));

  for (let iteration = 0; iteration < 10; iteration += 1) {
    let changed = false;
    for (const node of ordered) {
      if (hubs.has(node.id)) continue;
      const scores = new Map<string, number>();
      for (const neighbor of graph.get(node.id) ?? []) {
        if (hubs.has(neighbor.nodeId)) continue;
        const neighborLabel = labels.get(neighbor.nodeId) ?? neighbor.nodeId;
        scores.set(neighborLabel, (scores.get(neighborLabel) ?? 0) + edgeWeight(neighbor.edge));
      }
      if (scores.size === 0) continue;

      const bestLabel = [...scores.entries()]
        .sort((left, right) => {
          if (right[1] !== left[1]) return right[1] - left[1];
          return stableCompare(left[0], right[0]);
        })[0][0];
      if (bestLabel !== labels.get(node.id)) {
        labels.set(node.id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Reattach structural hubs by weighted majority vote after the stable partition.
  for (const hub of [...hubs].sort(stableCompare)) {
    const scores = new Map<string, number>();
    for (const neighbor of graph.get(hub) ?? []) {
      const label = labels.get(neighbor.nodeId) ?? neighbor.nodeId;
      scores.set(label, (scores.get(label) ?? 0) + edgeWeight(neighbor.edge));
    }
    if (scores.size > 0) {
      const best = [...scores.entries()].sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return stableCompare(left[0], right[0]);
      })[0][0];
      labels.set(hub, best);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const node of ordered) {
    const label = labels.get(node.id) ?? node.id;
    const members = grouped.get(label) ?? [];
    members.push(node.id);
    grouped.set(label, members);
  }

  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const rawGroups = [...grouped.values()].map((nodeIds) => nodeIds.sort(stableCompare));
  rawGroups.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    return stableCompare(left[0] ?? '', right[0] ?? '');
  });

  return rawGroups.map((nodeIds, index) => {
    const memberSet = new Set(nodeIds);
    let internalWeight = 0;
    let totalWeight = 0;
    for (const edge of payload.edges) {
      if (!memberSet.has(edge.source) && !memberSet.has(edge.target)) continue;
      const weight = edgeWeight(edge);
      totalWeight += weight;
      if (memberSet.has(edge.source) && memberSet.has(edge.target)) internalWeight += weight;
    }
    const hub = [...nodeIds].sort((left, right) => {
      const degreeDelta = (degrees.get(right) ?? 0) - (degrees.get(left) ?? 0);
      return degreeDelta !== 0 ? degreeDelta : stableCompare(left, right);
    })[0];
    return {
      id: index,
      label: nodeById.get(hub)?.label ?? `Cluster ${index + 1}`,
      nodeIds,
      cohesion: totalWeight > 0 ? internalWeight / totalWeight : 0,
    };
  });
}

function computeMetrics(
  payload: InternalGraphPayload,
  communities: InternalGraphCommunity[],
): InternalGraphNodeMetric[] {
  const communityByNode = new Map<string, number>();
  for (const community of communities) {
    for (const nodeId of community.nodeIds) communityByNode.set(nodeId, community.id);
  }

  const weightedDegree = new Map(payload.nodes.map((node) => [node.id, 0] as const));
  const crossCommunityWeight = new Map(payload.nodes.map((node) => [node.id, 0] as const));
  const neighborCommunities = new Map(payload.nodes.map((node) => [node.id, new Set<number>()] as const));

  for (const edge of payload.edges) {
    const weight = edgeWeight(edge);
    weightedDegree.set(edge.source, (weightedDegree.get(edge.source) ?? 0) + weight);
    weightedDegree.set(edge.target, (weightedDegree.get(edge.target) ?? 0) + weight);

    const leftCommunity = communityByNode.get(edge.source) ?? -1;
    const rightCommunity = communityByNode.get(edge.target) ?? -1;
    if (leftCommunity !== rightCommunity) {
      crossCommunityWeight.set(edge.source, (crossCommunityWeight.get(edge.source) ?? 0) + weight);
      crossCommunityWeight.set(edge.target, (crossCommunityWeight.get(edge.target) ?? 0) + weight);
      if (rightCommunity >= 0) neighborCommunities.get(edge.source)?.add(rightCommunity);
      if (leftCommunity >= 0) neighborCommunities.get(edge.target)?.add(leftCommunity);
    }
  }

  return payload.nodes.map((node) => {
    const cross = crossCommunityWeight.get(node.id) ?? 0;
    const diversity = neighborCommunities.get(node.id)?.size ?? 0;
    return {
      nodeId: node.id,
      weightedDegree: weightedDegree.get(node.id) ?? 0,
      brokerScore: cross * (1 + Math.log2(1 + diversity)),
      communityId: communityByNode.get(node.id) ?? -1,
    };
  });
}

function surprisingConnections(
  payload: InternalGraphPayload,
  metrics: InternalGraphNodeMetric[],
  topN = 12,
): InternalGraphSurprise[] {
  const metricByNode = new Map(metrics.map((metric) => [metric.nodeId, metric] as const));
  const relationCounts = new Map<string, number>();
  for (const edge of payload.edges) relationCounts.set(edge.relation, (relationCounts.get(edge.relation) ?? 0) + 1);

  const scored: InternalGraphSurprise[] = [];
  for (const edge of payload.edges) {
    const left = metricByNode.get(edge.source);
    const right = metricByNode.get(edge.target);
    if (!left || !right || left.communityId === right.communityId) continue;

    const why: string[] = ['bridges separate graph communities'];
    let score = edgeWeight(edge);
    if (edge.confidence === 'DERIVED') {
      score *= 1.15;
      why.push('derived rather than directly recorded');
    } else if (edge.confidence === 'AMBIGUOUS') {
      score *= 0.8;
      why.push('ambiguous evidence requires review');
    }
    const frequency = relationCounts.get(edge.relation) ?? 1;
    if (frequency <= Math.max(2, Math.ceil(payload.edges.length * 0.04))) {
      score *= 1.25;
      why.push('rare relationship type in this graph');
    }
    if (Math.min(left.weightedDegree, right.weightedDegree) < 1.5 && Math.max(left.weightedDegree, right.weightedDegree) > 5) {
      score *= 1.2;
      why.push('peripheral node reaches a high-connectivity hub');
    }

    scored.push({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      score,
      why,
    });
  }

  return scored.sort((left, right) => right.score - left.score || stableCompare(left.edgeId, right.edgeId)).slice(0, topN);
}

function bridgeCandidates(
  payload: InternalGraphPayload,
  metrics: InternalGraphNodeMetric[],
  topN = 16,
): InternalBridgeCandidate[] {
  const graph = adjacency(payload);
  const metricByNode = new Map(metrics.map((metric) => [metric.nodeId, metric] as const));
  const direct = new Set<string>();
  for (const edge of payload.edges) {
    direct.add([edge.source, edge.target].sort(stableCompare).join('|'));
  }

  const best = new Map<string, InternalBridgeCandidate>();
  const people = payload.nodes.filter((node) => node.kind === 'person').sort((a, b) => stableCompare(a.id, b.id));

  for (const via of payload.nodes) {
    const neighbors = (graph.get(via.id) ?? [])
      .filter((entry) => people.some((person) => person.id === entry.nodeId));
    if (neighbors.length < 2 || neighbors.length > 80) continue;

    for (let leftIndex = 0; leftIndex < neighbors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < neighbors.length; rightIndex += 1) {
        const left = neighbors[leftIndex];
        const right = neighbors[rightIndex];
        if (left.nodeId === right.nodeId) continue;
        const pairKey = [left.nodeId, right.nodeId].sort(stableCompare).join('|');
        if (direct.has(pairKey)) continue;

        const leftMetric = metricByNode.get(left.nodeId);
        const rightMetric = metricByNode.get(right.nodeId);
        const crossCommunity = leftMetric && rightMetric && leftMetric.communityId !== rightMetric.communityId;
        const viaKind = via.kind;
        const why = [`shared ${viaKind}: ${via.label}`];
        let score = Math.min(edgeWeight(left.edge), edgeWeight(right.edge));
        if (crossCommunity) {
          score *= 1.65;
          why.push('closes a structural hole between communities');
        }
        if (viaKind === 'event' || viaKind === 'role' || viaKind === 'organization' || viaKind === 'project') {
          score *= 1.18;
          why.push('bridge is explainable in real-world context');
        }

        const candidate: InternalBridgeCandidate = {
          source: left.nodeId,
          via: via.id,
          target: right.nodeId,
          score,
          why,
        };
        const existing = best.get(pairKey);
        if (!existing || candidate.score > existing.score) best.set(pairKey, candidate);
      }
    }
  }

  return [...best.values()]
    .sort((left, right) => right.score - left.score || stableCompare(`${left.source}|${left.target}`, `${right.source}|${right.target}`))
    .slice(0, topN);
}

export function findInternalGraphPath(
  payload: InternalGraphPayload,
  sourceId: string,
  targetId: string,
): InternalGraphPath | null {
  if (sourceId === targetId) return { nodeIds: [sourceId], edgeIds: [], cost: 0 };
  const graph = adjacency(payload);
  if (!graph.has(sourceId) || !graph.has(targetId)) return null;

  const distance = new Map<string, number>([[sourceId, 0]]);
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const unvisited = new Set(payload.nodes.map((node) => node.id));

  while (unvisited.size > 0) {
    const current = [...unvisited]
      .filter((id) => distance.has(id))
      .sort((left, right) => {
        const delta = (distance.get(left) ?? Infinity) - (distance.get(right) ?? Infinity);
        return delta !== 0 ? delta : stableCompare(left, right);
      })[0];
    if (!current) break;
    if (current === targetId) break;
    unvisited.delete(current);

    for (const neighbor of graph.get(current) ?? []) {
      if (!unvisited.has(neighbor.nodeId)) continue;
      const weight = edgeWeight(neighbor.edge);
      const confidencePenalty = neighbor.edge.confidence === 'AMBIGUOUS' ? 1.8 : neighbor.edge.confidence === 'DERIVED' ? 1.25 : 1;
      const candidate = (distance.get(current) ?? 0) + confidencePenalty / Math.max(0.05, weight);
      const known = distance.get(neighbor.nodeId);
      if (known == null || candidate < known) {
        distance.set(neighbor.nodeId, candidate);
        previous.set(neighbor.nodeId, { nodeId: current, edgeId: neighbor.edge.id });
      }
    }
  }

  if (!previous.has(targetId)) return null;
  const nodeIds = [targetId];
  const edgeIds: string[] = [];
  let cursor = targetId;
  while (cursor !== sourceId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edgeIds.unshift(step.edgeId);
    cursor = step.nodeId;
    nodeIds.unshift(cursor);
  }
  return { nodeIds, edgeIds, cost: distance.get(targetId) ?? 0 };
}

export function diffInternalGraphs(
  previous: InternalGraphPayload | null,
  current: InternalGraphPayload,
): InternalGraphDiff {
  if (!previous) {
    return {
      addedNodeIds: current.nodes.map((node) => node.id),
      removedNodeIds: [],
      addedEdgeIds: current.edges.map((edge) => edge.id),
      removedEdgeIds: [],
    };
  }
  const previousNodes = new Set(previous.nodes.map((node) => node.id));
  const currentNodes = new Set(current.nodes.map((node) => node.id));
  const previousEdges = new Set(previous.edges.map((edge) => edge.id));
  const currentEdges = new Set(current.edges.map((edge) => edge.id));
  return {
    addedNodeIds: [...currentNodes].filter((id) => !previousNodes.has(id)).sort(stableCompare),
    removedNodeIds: [...previousNodes].filter((id) => !currentNodes.has(id)).sort(stableCompare),
    addedEdgeIds: [...currentEdges].filter((id) => !previousEdges.has(id)).sort(stableCompare),
    removedEdgeIds: [...previousEdges].filter((id) => !currentEdges.has(id)).sort(stableCompare),
  };
}

function buildLayout(
  payload: InternalGraphPayload,
  communities: InternalGraphCommunity[],
  metrics: InternalGraphNodeMetric[],
): InternalGraphLayoutPoint[] {
  const metricByNode = new Map(metrics.map((metric) => [metric.nodeId, metric] as const));
  const points: InternalGraphLayoutPoint[] = [];
  const communityCount = Math.max(1, communities.length);
  const outerRadius = Math.max(4, Math.sqrt(payload.nodes.length) * 1.25);

  for (const community of communities) {
    const communityAngle = (community.id / communityCount) * Math.PI * 2 - Math.PI / 2;
    const centerX = Math.cos(communityAngle) * outerRadius;
    const centerY = Math.sin(communityAngle) * outerRadius;
    const ordered = [...community.nodeIds].sort((left, right) => {
      const metricDelta = (metricByNode.get(right)?.weightedDegree ?? 0) - (metricByNode.get(left)?.weightedDegree ?? 0);
      return metricDelta !== 0 ? metricDelta : stableCompare(left, right);
    });
    const innerRadius = Math.max(0.9, Math.sqrt(ordered.length) * 0.72);

    ordered.forEach((nodeId, index) => {
      const metric = metricByNode.get(nodeId);
      const normalizedRank = ordered.length <= 1 ? 0 : index / (ordered.length - 1);
      const radius = index === 0 ? 0 : innerRadius * (0.35 + normalizedRank * 0.65);
      const angle = index === 0 ? 0 : ((index - 1) / Math.max(1, ordered.length - 1)) * Math.PI * 2;
      points.push({
        nodeId,
        communityId: community.id,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        z: (metric?.brokerScore ?? 0) > 3 ? 0.35 : 0,
        radius: Math.min(0.42, 0.12 + Math.log2(1 + (metric?.weightedDegree ?? 0)) * 0.045),
      });
    });
  }
  return points;
}

export function analyzeInternalGraph(payload: InternalGraphPayload): InternalGraphAnalysis {
  const communities = detectInternalGraphCommunities(payload);
  const metrics = computeMetrics(payload, communities);
  const hubNodeIds = [...metrics]
    .sort((left, right) => right.weightedDegree - left.weightedDegree || stableCompare(left.nodeId, right.nodeId))
    .slice(0, 12)
    .map((metric) => metric.nodeId);
  const brokerNodeIds = [...metrics]
    .sort((left, right) => right.brokerScore - left.brokerScore || stableCompare(left.nodeId, right.nodeId))
    .filter((metric) => metric.brokerScore > 0)
    .slice(0, 12)
    .map((metric) => metric.nodeId);

  return {
    communities,
    metrics,
    hubNodeIds,
    brokerNodeIds,
    surprises: surprisingConnections(payload, metrics),
    bridgeCandidates: bridgeCandidates(payload, metrics),
    layout: buildLayout(payload, communities, metrics),
  };
}
