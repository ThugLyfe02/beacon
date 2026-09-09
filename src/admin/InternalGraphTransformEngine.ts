import {
  analyzeInternalGraph,
  type InternalGraphEdge,
  type InternalGraphNode,
  type InternalGraphPayload,
} from './InternalGraphEngine';

export type InternalTransformKind =
  | 'relationship_ladder'
  | 'shared_context'
  | 'entity_pivot'
  | 'bridge_pivot'
  | 'temporal_evidence'
  | 'provenance';

export interface InternalTransformResult {
  id: string;
  kind: InternalTransformKind;
  title: string;
  description: string;
  sourceNodeId: string;
  targetNodeIds: string[];
  edgeIds: string[];
  score: number;
  evidence: string[];
}

export interface InternalEvidenceTimelineItem {
  edgeId: string;
  relation: string;
  counterpartNodeId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  evidenceCount: number;
  confidence: InternalGraphEdge['confidence'];
  sensitivity: InternalGraphEdge['sensitivity'];
}

const CONTEXT_KINDS = new Set(['event', 'venue', 'role', 'organization', 'domain', 'project', 'topic', 'room', 'outcome']);
const HIGH_VALUE_RELATIONS = new Set(['outcome_completed', 'outcome_aligned', 'office_hours_with', 'mutual_with', 'signaled']);

function adjacency(payload: InternalGraphPayload, nodeId: string): Array<{ edge: InternalGraphEdge; target: InternalGraphNode }> {
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  return payload.edges.flatMap((edge) => {
    if (edge.source !== nodeId && edge.target !== nodeId) return [];
    const counterpartId = edge.source === nodeId ? edge.target : edge.source;
    const target = nodeById.get(counterpartId);
    return target ? [{ edge, target }] : [];
  });
}

function recencyScore(timestamp: string): number {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return 0;
  const days = Math.max(0, (Date.now() - time) / 86_400_000);
  return Math.exp(-days / 120);
}

function relationshipScore(edge: InternalGraphEdge): number {
  const base = HIGH_VALUE_RELATIONS.has(edge.relation) ? 2.4 : 1;
  const confidence = edge.confidence === 'VERIFIED' ? 1 : edge.confidence === 'DERIVED' ? 0.72 : 0.4;
  return base * confidence * Math.log2(2 + edge.evidenceCount) * (0.7 + recencyScore(edge.lastSeenAt) * 0.3);
}

export function buildInternalEvidenceTimeline(
  payload: InternalGraphPayload,
  nodeId: string,
): InternalEvidenceTimelineItem[] {
  return adjacency(payload, nodeId)
    .map(({ edge, target }) => ({
      edgeId: edge.id,
      relation: edge.relation,
      counterpartNodeId: target.id,
      firstSeenAt: edge.firstSeenAt,
      lastSeenAt: edge.lastSeenAt,
      evidenceCount: edge.evidenceCount,
      confidence: edge.confidence,
      sensitivity: edge.sensitivity,
    }))
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || right.evidenceCount - left.evidenceCount || left.edgeId.localeCompare(right.edgeId));
}

/**
 * Maltego-like transforms over first-party Constellation evidence. A transform
 * expands or pivots already-authorized graph state; it never performs external
 * identity lookup, scraping or enrichment.
 */
export function runInternalNodeTransforms(
  payload: InternalGraphPayload,
  nodeId: string,
): InternalTransformResult[] {
  const source = payload.nodes.find((node) => node.id === nodeId);
  if (!source) return [];
  const neighbors = adjacency(payload, nodeId);
  const analysis = analyzeInternalGraph(payload);
  const metricByNode = new Map(analysis.metrics.map((metric) => [metric.nodeId, metric] as const));
  const sourceMetric = metricByNode.get(nodeId);
  const results: InternalTransformResult[] = [];

  const people = neighbors.filter(({ target }) => target.kind === 'person');
  if (people.length > 0) {
    const ranked = [...people].sort((left, right) => relationshipScore(right.edge) - relationshipScore(left.edge));
    results.push({
      id: `${nodeId}:relationship_ladder`,
      kind: 'relationship_ladder',
      title: 'Relationship ladder',
      description: 'Direct people relationships ranked by verified depth, repeated evidence and recency.',
      sourceNodeId: nodeId,
      targetNodeIds: ranked.map(({ target }) => target.id),
      edgeIds: ranked.map(({ edge }) => edge.id),
      score: ranked.reduce((sum, row) => sum + relationshipScore(row.edge), 0),
      evidence: ranked.slice(0, 6).map(({ edge, target }) => `${edge.relation} → ${target.label} · ${edge.confidence} · n=${edge.evidenceCount}`),
    });
  }

  const context = neighbors.filter(({ target }) => CONTEXT_KINDS.has(target.kind));
  if (context.length > 0) {
    results.push({
      id: `${nodeId}:shared_context`,
      kind: 'shared_context',
      title: 'Context pivots',
      description: 'Events, roles, organizations, projects, topics, venues and outcomes directly evidenced around this entity.',
      sourceNodeId: nodeId,
      targetNodeIds: context.map(({ target }) => target.id),
      edgeIds: context.map(({ edge }) => edge.id),
      score: context.reduce((sum, row) => sum + relationshipScore(row.edge), 0),
      evidence: context.slice(0, 8).map(({ edge, target }) => `${target.kind}: ${target.label} via ${edge.relation}`),
    });
  }

  if (source.kind !== 'person') {
    const entityPeople = people.sort((left, right) => relationshipScore(right.edge) - relationshipScore(left.edge));
    if (entityPeople.length > 0) {
      results.push({
        id: `${nodeId}:entity_pivot`,
        kind: 'entity_pivot',
        title: `People around ${source.label}`,
        description: 'Reverse-pivot from this entity to people with first-party evidence touching it.',
        sourceNodeId: nodeId,
        targetNodeIds: entityPeople.map(({ target }) => target.id),
        edgeIds: entityPeople.map(({ edge }) => edge.id),
        score: entityPeople.reduce((sum, row) => sum + relationshipScore(row.edge), 0),
        evidence: entityPeople.slice(0, 8).map(({ edge, target }) => `${target.label} · ${edge.relation} · n=${edge.evidenceCount}`),
      });
    }
  }

  const bridgeTargets = neighbors.filter(({ target }) => {
    const targetMetric = metricByNode.get(target.id);
    return sourceMetric && targetMetric && sourceMetric.communityId !== targetMetric.communityId;
  });
  if (bridgeTargets.length > 0) {
    results.push({
      id: `${nodeId}:bridge_pivot`,
      kind: 'bridge_pivot',
      title: 'Cross-community pivots',
      description: 'Direct evidence crossing current community boundaries—the edges most likely to explain brokerage.',
      sourceNodeId: nodeId,
      targetNodeIds: bridgeTargets.map(({ target }) => target.id),
      edgeIds: bridgeTargets.map(({ edge }) => edge.id),
      score: (sourceMetric?.brokerScore ?? 0) + bridgeTargets.reduce((sum, row) => sum + relationshipScore(row.edge), 0),
      evidence: bridgeTargets.slice(0, 8).map(({ edge, target }) => `${target.label} in community ${metricByNode.get(target.id)?.communityId ?? '?'} via ${edge.relation}`),
    });
  }

  const timeline = buildInternalEvidenceTimeline(payload, nodeId);
  if (timeline.length > 0) {
    results.push({
      id: `${nodeId}:temporal_evidence`,
      kind: 'temporal_evidence',
      title: 'Temporal evidence trail',
      description: 'What changed around this node over time, using first/last seen timestamps rather than an inferred biography.',
      sourceNodeId: nodeId,
      targetNodeIds: timeline.map((item) => item.counterpartNodeId),
      edgeIds: timeline.map((item) => item.edgeId),
      score: timeline.reduce((sum, item) => sum + recencyScore(item.lastSeenAt), 0),
      evidence: timeline.slice(0, 8).map((item) => `${item.relation} · last ${item.lastSeenAt} · evidence n=${item.evidenceCount}`),
    });
  }

  const provenanceEdges = neighbors
    .filter(({ edge }) => edge.evidence && Object.keys(edge.evidence).length > 0)
    .sort((left, right) => right.edge.evidenceCount - left.edge.evidenceCount);
  if (provenanceEdges.length > 0) {
    results.push({
      id: `${nodeId}:provenance`,
      kind: 'provenance',
      title: 'Evidence provenance',
      description: 'Why these graph edges exist and how much supporting evidence they carry.',
      sourceNodeId: nodeId,
      targetNodeIds: provenanceEdges.map(({ target }) => target.id),
      edgeIds: provenanceEdges.map(({ edge }) => edge.id),
      score: provenanceEdges.reduce((sum, row) => sum + row.edge.evidenceCount, 0),
      evidence: provenanceEdges.slice(0, 8).map(({ edge, target }) => `${edge.relation} → ${target.label} · ${edge.confidence} · ${JSON.stringify(edge.evidence).slice(0, 180)}`),
    });
  }

  return results.sort((left, right) => right.score - left.score || left.kind.localeCompare(right.kind));
}

export function expandInternalTransformNeighborhood(
  payload: InternalGraphPayload,
  seedNodeIds: string[],
  depth = 2,
  maxNodes = 120,
): { nodeIds: string[]; edgeIds: string[] } {
  const safeDepth = Math.max(1, Math.min(depth, 4));
  const graph = new Map<string, Array<{ nodeId: string; edgeId: string }>>();
  for (const node of payload.nodes) graph.set(node.id, []);
  for (const edge of payload.edges) {
    graph.get(edge.source)?.push({ nodeId: edge.target, edgeId: edge.id });
    graph.get(edge.target)?.push({ nodeId: edge.source, edgeId: edge.id });
  }
  const seen = new Set(seedNodeIds.filter((id) => graph.has(id)));
  const edges = new Set<string>();
  let frontier = [...seen];
  for (let level = 0; level < safeDepth && frontier.length > 0 && seen.size < maxNodes; level += 1) {
    const next: string[] = [];
    for (const nodeId of frontier.sort()) {
      for (const neighbor of graph.get(nodeId) ?? []) {
        edges.add(neighbor.edgeId);
        if (seen.has(neighbor.nodeId) || seen.size >= maxNodes) continue;
        seen.add(neighbor.nodeId);
        next.push(neighbor.nodeId);
      }
    }
    frontier = next;
  }
  return { nodeIds: [...seen].sort(), edgeIds: [...edges].sort() };
}
