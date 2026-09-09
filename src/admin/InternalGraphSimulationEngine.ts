import {
  analyzeInternalGraph,
  findInternalGraphPath,
  type InternalBridgeCandidate,
  type InternalGraphAnalysis,
  type InternalGraphEdge,
  type InternalGraphPayload,
} from './InternalGraphEngine';

export interface InternalGraphStructuralSummary {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  connectedComponents: number;
  largestComponentSize: number;
  largestComponentRatio: number;
  brokerCount: number;
  hubCount: number;
  bridgeCandidateCount: number;
}

export interface InternalBridgeSimulation {
  candidate: InternalBridgeCandidate;
  baseline: InternalGraphStructuralSummary;
  simulated: InternalGraphStructuralSummary;
  componentDelta: number;
  communityDelta: number;
  largestComponentDelta: number;
  bridgeCandidateDelta: number;
  newBrokerIds: string[];
  displacedBrokerIds: string[];
  sourceTargetCostBefore: number | null;
  sourceTargetCostAfter: number;
  impactScore: number;
  interpretation: string[];
}

export interface InternalNodeResilienceRisk {
  nodeId: string;
  baseline: InternalGraphStructuralSummary;
  withoutNode: InternalGraphStructuralSummary;
  componentIncrease: number;
  largestComponentLoss: number;
  removedEdgeCount: number;
  brokerScore: number;
  weightedDegree: number;
  riskScore: number;
  interpretation: string[];
}

function canonicalPair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function adjacency(payload: InternalGraphPayload): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const node of payload.nodes) graph.set(node.id, new Set());
  for (const edge of payload.edges) {
    if (!graph.has(edge.source) || !graph.has(edge.target)) continue;
    graph.get(edge.source)!.add(edge.target);
    graph.get(edge.target)!.add(edge.source);
  }
  return graph;
}

function componentSizes(payload: InternalGraphPayload): number[] {
  const graph = adjacency(payload);
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const nodeId of [...graph.keys()].sort()) {
    if (seen.has(nodeId)) continue;
    let size = 0;
    const queue = [nodeId];
    seen.add(nodeId);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      size += 1;
      for (const neighbor of graph.get(current) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}

export function summarizeInternalGraphStructure(
  payload: InternalGraphPayload,
  analysis = analyzeInternalGraph(payload),
): InternalGraphStructuralSummary {
  const sizes = componentSizes(payload);
  const largest = sizes[0] ?? 0;
  return {
    nodeCount: payload.nodeCount,
    edgeCount: payload.edgeCount,
    communityCount: analysis.communities.length,
    connectedComponents: sizes.length,
    largestComponentSize: largest,
    largestComponentRatio: payload.nodeCount > 0 ? largest / payload.nodeCount : 0,
    brokerCount: analysis.brokerNodeIds.length,
    hubCount: analysis.hubNodeIds.length,
    bridgeCandidateCount: analysis.bridgeCandidates.length,
  };
}

function clonePayload(payload: InternalGraphPayload, edges: InternalGraphEdge[], removedNodeId?: string): InternalGraphPayload {
  const nodes = removedNodeId ? payload.nodes.filter((node) => node.id !== removedNodeId) : [...payload.nodes];
  const nextEdges = removedNodeId
    ? edges.filter((edge) => edge.source !== removedNodeId && edge.target !== removedNodeId)
    : edges;
  return {
    ...payload,
    generatedAt: new Date().toISOString(),
    graphVersion: `${payload.graphVersion}:counterfactual`,
    nodes,
    edges: nextEdges,
    nodeCount: nodes.length,
    edgeCount: nextEdges.length,
  };
}

function hypotheticalBridgeEdge(candidate: InternalBridgeCandidate): InternalGraphEdge {
  const [source, target] = [candidate.source, candidate.target].sort();
  const now = new Date().toISOString();
  return {
    id: `counterfactual:${source}:${target}`,
    scopeKey: 'counterfactual:operator_simulation',
    source,
    target,
    relation: 'hypothetical_introduction',
    directed: false,
    confidence: 'AMBIGUOUS',
    sensitivity: 'standard',
    strength: Math.max(0.35, Math.min(2.5, candidate.score / 2)),
    firstSeenAt: now,
    lastSeenAt: now,
    evidenceCount: 1,
    evidence: { source: 'counterfactual_simulation', viaNodeId: candidate.via, notObserved: true },
  };
}

export function simulateInternalBridge(
  payload: InternalGraphPayload,
  candidate: InternalBridgeCandidate,
): InternalBridgeSimulation {
  const baselineAnalysis = analyzeInternalGraph(payload);
  const baseline = summarizeInternalGraphStructure(payload, baselineAnalysis);
  const beforePath = findInternalGraphPath(payload, candidate.source, candidate.target);
  const simulatedPayload = clonePayload(payload, [...payload.edges, hypotheticalBridgeEdge(candidate)]);
  const simulatedAnalysis = analyzeInternalGraph(simulatedPayload);
  const simulated = summarizeInternalGraphStructure(simulatedPayload, simulatedAnalysis);
  const afterPath = findInternalGraphPath(simulatedPayload, candidate.source, candidate.target);
  const baselineBrokers = new Set(baselineAnalysis.brokerNodeIds);
  const simulatedBrokers = new Set(simulatedAnalysis.brokerNodeIds);
  const newBrokerIds = [...simulatedBrokers].filter((id) => !baselineBrokers.has(id)).sort();
  const displacedBrokerIds = [...baselineBrokers].filter((id) => !simulatedBrokers.has(id)).sort();
  const componentDelta = simulated.connectedComponents - baseline.connectedComponents;
  const communityDelta = simulated.communityCount - baseline.communityCount;
  const largestComponentDelta = simulated.largestComponentRatio - baseline.largestComponentRatio;
  const bridgeCandidateDelta = simulated.bridgeCandidateCount - baseline.bridgeCandidateCount;
  const beforeCost = beforePath?.cost ?? null;
  const afterCost = afterPath?.cost ?? 0;
  const pathGain = beforeCost == null ? 2 : Math.max(0, beforeCost - afterCost);
  const impactScore =
    Math.max(0, -componentDelta) * 4
    + Math.max(0, largestComponentDelta) * 8
    + Math.max(0, -bridgeCandidateDelta) * 0.35
    + pathGain
    + newBrokerIds.length * 0.5;

  return {
    candidate,
    baseline,
    simulated,
    componentDelta,
    communityDelta,
    largestComponentDelta,
    bridgeCandidateDelta,
    newBrokerIds,
    displacedBrokerIds,
    sourceTargetCostBefore: beforeCost,
    sourceTargetCostAfter: afterCost,
    impactScore,
    interpretation: [
      'Counterfactual only; no relationship or outcome is predicted.',
      componentDelta < 0
        ? `could connect ${Math.abs(componentDelta)} currently separate graph component${Math.abs(componentDelta) === 1 ? '' : 's'}`
        : 'does not merge currently separate graph components',
      largestComponentDelta > 0.01
        ? `largest connected component increases by ${Math.round(largestComponentDelta * 100)} percentage points`
        : 'largest-component reach is materially unchanged',
      bridgeCandidateDelta < 0
        ? `${Math.abs(bridgeCandidateDelta)} structural-hole candidate${Math.abs(bridgeCandidateDelta) === 1 ? '' : 's'} disappear after the hypothetical edge`
        : `${Math.max(0, bridgeCandidateDelta)} new structural-hole candidates emerge after re-partitioning`,
    ],
  };
}

export function simulateInternalNodeRemoval(
  payload: InternalGraphPayload,
  nodeId: string,
): InternalNodeResilienceRisk | null {
  const baselineAnalysis = analyzeInternalGraph(payload);
  const metric = baselineAnalysis.metrics.find((row) => row.nodeId === nodeId);
  if (!metric || !payload.nodes.some((node) => node.id === nodeId)) return null;
  const baseline = summarizeInternalGraphStructure(payload, baselineAnalysis);
  const removedEdgeCount = payload.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length;
  const simulatedPayload = clonePayload(payload, payload.edges, nodeId);
  const withoutAnalysis = analyzeInternalGraph(simulatedPayload);
  const withoutNode = summarizeInternalGraphStructure(simulatedPayload, withoutAnalysis);
  const componentIncrease = withoutNode.connectedComponents - baseline.connectedComponents;
  const baselineLargestWithoutSelf = Math.max(0, baseline.largestComponentSize - 1);
  const largestComponentLoss = baselineLargestWithoutSelf > 0
    ? Math.max(0, (baselineLargestWithoutSelf - withoutNode.largestComponentSize) / baselineLargestWithoutSelf)
    : 0;
  const edgeShare = removedEdgeCount / Math.max(1, payload.edgeCount);
  const riskScore =
    Math.max(0, componentIncrease) * 6
    + largestComponentLoss * 14
    + edgeShare * 8
    + Math.log2(1 + metric.brokerScore) * 1.8
    + Math.log2(1 + metric.weightedDegree);

  return {
    nodeId,
    baseline,
    withoutNode,
    componentIncrease,
    largestComponentLoss,
    removedEdgeCount,
    brokerScore: metric.brokerScore,
    weightedDegree: metric.weightedDegree,
    riskScore,
    interpretation: [
      'Resilience simulation only; topology dependence is not a ranking of human worth, trust, or personal importance.',
      componentIncrease > 0
        ? `removal increases connected components by ${componentIncrease}`
        : 'removal does not split the graph into additional components',
      largestComponentLoss > 0.02
        ? `largest connected component loses ${Math.round(largestComponentLoss * 100)}% of its remaining reach`
        : 'largest-component reach is relatively resilient to this removal',
      `${removedEdgeCount} evidence edge${removedEdgeCount === 1 ? '' : 's'} depend directly on this node`,
    ],
  };
}

/**
 * Ranks topology concentration risk over existing hubs/brokers. This is not a ranking of human worth or trust;
 * it identifies where the graph itself is brittle.
 */
export function rankInternalGraphResilienceRisks(
  payload: InternalGraphPayload,
  limit = 16,
): InternalNodeResilienceRisk[] {
  const analysis = analyzeInternalGraph(payload);
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const candidates = [...new Set([...analysis.brokerNodeIds, ...analysis.hubNodeIds])]
    .filter((id) => ['person', 'organization', 'project', 'event', 'role'].includes(nodeById.get(id)?.kind ?? ''))
    .slice(0, 28);
  return candidates
    .flatMap((nodeId) => {
      const result = simulateInternalNodeRemoval(payload, nodeId);
      return result ? [result] : [];
    })
    .sort((left, right) => right.riskScore - left.riskScore || left.nodeId.localeCompare(right.nodeId))
    .slice(0, limit);
}

export function rankCounterfactualBridgeSimulations(
  payload: InternalGraphPayload,
  suppressions: ReadonlySet<string>,
  limit = 12,
): InternalBridgeSimulation[] {
  const analysis = analyzeInternalGraph(payload);
  return analysis.bridgeCandidates
    .filter((candidate) => !suppressions.has(canonicalPair(candidate.source, candidate.target)))
    .slice(0, 28)
    .map((candidate) => simulateInternalBridge(payload, candidate))
    .sort((left, right) => right.impactScore - left.impactScore || left.candidate.source.localeCompare(right.candidate.source))
    .slice(0, limit);
}
