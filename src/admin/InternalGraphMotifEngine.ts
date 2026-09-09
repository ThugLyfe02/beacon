import {
  analyzeInternalGraph,
  type InternalGraphAnalysis,
  type InternalGraphEdge,
  type InternalGraphPayload,
} from './InternalGraphEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';

export type InternalGraphMotifClass =
  | 'closure'
  | 'brokerage'
  | 'outcome_chain'
  | 'context_bridge'
  | 'fragility'
  | 'convergence';

export interface InternalGraphMotif {
  key: string;
  class: InternalGraphMotifClass;
  count: number;
  strength: number;
  examples: string[][];
  explanation: string;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function adjacency(payload: InternalGraphPayload): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const node of payload.nodes) graph.set(node.id, new Set());
  for (const edge of payload.edges) {
    graph.get(edge.source)?.add(edge.target);
    graph.get(edge.target)?.add(edge.source);
  }
  return graph;
}

function pairRelations(payload: InternalGraphPayload): Map<string, Set<string>> {
  const relations = new Map<string, Set<string>>();
  for (const edge of payload.edges) {
    const key = [edge.source, edge.target].sort(stableCompare).join('|');
    const set = relations.get(key) ?? new Set<string>();
    set.add(edge.relation);
    relations.set(key, set);
  }
  return relations;
}

function edgeStrength(edge: InternalGraphEdge): number {
  const confidence = edge.confidence === 'VERIFIED' ? 1 : edge.confidence === 'DERIVED' ? 0.72 : 0.4;
  return Math.max(0.01, edge.strength) * confidence * Math.log2(2 + edge.evidenceCount);
}

function pushExample(examples: string[][], value: string[]): void {
  if (examples.length >= 8) return;
  examples.push(value);
}

function countTriadicClosures(payload: InternalGraphPayload): InternalGraphMotif {
  const graph = adjacency(payload);
  const people = payload.nodes.filter((node) => node.kind === 'person').map((node) => node.id).sort(stableCompare);
  let count = 0;
  const examples: string[][] = [];

  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const left = people[i];
      const right = people[j];
      if (!graph.get(left)?.has(right)) continue;
      for (let k = j + 1; k < people.length; k += 1) {
        const third = people[k];
        if (graph.get(left)?.has(third) && graph.get(right)?.has(third)) {
          count += 1;
          pushExample(examples, [left, right, third]);
        }
      }
    }
  }

  return {
    key: 'triadic_closure',
    class: 'closure',
    count,
    strength: Math.log2(1 + count),
    examples,
    explanation: 'Three person nodes form a closed triangle of explainable relationships; repeated growth here signals local network consolidation.',
  };
}

function countContextBridges(payload: InternalGraphPayload, analysis: InternalGraphAnalysis): InternalGraphMotif {
  const graph = adjacency(payload);
  const communityByNode = new Map(analysis.metrics.map((metric) => [metric.nodeId, metric.communityId] as const));
  const contexts = payload.nodes
    .filter((node) => ['event', 'role', 'organization', 'project', 'topic', 'venue'].includes(node.kind))
    .sort((a, b) => stableCompare(a.id, b.id));
  let count = 0;
  let strength = 0;
  const examples: string[][] = [];

  for (const context of contexts) {
    const people = [...(graph.get(context.id) ?? [])]
      .filter((nodeId) => payload.nodes.some((node) => node.id === nodeId && node.kind === 'person'))
      .sort(stableCompare);
    for (let i = 0; i < people.length; i += 1) {
      for (let j = i + 1; j < people.length; j += 1) {
        const leftCommunity = communityByNode.get(people[i]) ?? -1;
        const rightCommunity = communityByNode.get(people[j]) ?? -1;
        if (leftCommunity < 0 || rightCommunity < 0 || leftCommunity === rightCommunity) continue;
        count += 1;
        strength += 1 + Math.log2(1 + new Set([leftCommunity, rightCommunity]).size);
        pushExample(examples, [people[i], context.id, people[j]]);
      }
    }
  }

  return {
    key: 'cross_community_context_bridge',
    class: 'context_bridge',
    count,
    strength,
    examples,
    explanation: 'A real-world context such as an event, role, organization or project connects people assigned to otherwise separate communities.',
  };
}

function countOutcomeChains(payload: InternalGraphPayload): InternalGraphMotif {
  const relations = pairRelations(payload);
  let count = 0;
  let strength = 0;
  const examples: string[][] = [];

  for (const [pair, pairRelationSet] of relations.entries()) {
    const hasMutual = pairRelationSet.has('mutual_with');
    const hasOfficeHours = pairRelationSet.has('office_hours_with');
    const hasAligned = pairRelationSet.has('outcome_aligned');
    const hasCompleted = pairRelationSet.has('outcome_completed');
    if (!hasMutual || (!hasOfficeHours && !hasAligned && !hasCompleted)) continue;

    count += 1;
    const level = hasCompleted ? 4 : hasAligned ? 3 : hasOfficeHours ? 2 : 1;
    strength += level;
    pushExample(examples, pair.split('|'));
  }

  return {
    key: 'relationship_outcome_ladder',
    class: 'outcome_chain',
    count,
    strength,
    examples,
    explanation: 'The same person pair carries a verified relationship ladder beyond mutual formation into Office Hours or two-party outcome evidence.',
  };
}

function countRepeatedEvidenceBridges(payload: InternalGraphPayload, analysis: InternalGraphAnalysis): InternalGraphMotif {
  const communityByNode = new Map(analysis.metrics.map((metric) => [metric.nodeId, metric.communityId] as const));
  const candidates = payload.edges.filter((edge) => {
    const left = communityByNode.get(edge.source) ?? -1;
    const right = communityByNode.get(edge.target) ?? -1;
    return left >= 0 && right >= 0 && left !== right && edge.evidenceCount >= 2;
  });
  return {
    key: 'repeated_cross_community_edge',
    class: 'brokerage',
    count: candidates.length,
    strength: candidates.reduce((total, edge) => total + edgeStrength(edge), 0),
    examples: candidates.slice(0, 8).map((edge) => [edge.source, edge.target]),
    explanation: 'Cross-community relationships recur across more than one evidence observation, separating durable bridges from one-off contact.',
  };
}

function countArticulationDependence(payload: InternalGraphPayload, analysis: InternalGraphAnalysis): InternalGraphMotif {
  const forensics = analyzeInternalGraphForensics(payload, analysis);
  return {
    key: 'articulation_dependence',
    class: 'fragility',
    count: forensics.articulationNodeIds.length,
    strength: forensics.structuralDependence * Math.max(1, payload.nodes.length),
    examples: forensics.brokers.filter((broker) => broker.articulation).slice(0, 8).map((broker) => [broker.nodeId]),
    explanation: 'One or more nodes are articulation points whose absence fragments explainable reachability; this is a resilience warning, not a human-value score.',
  };
}

function countMultiCommunityBrokers(payload: InternalGraphPayload, analysis: InternalGraphAnalysis): InternalGraphMotif {
  const forensics = analyzeInternalGraphForensics(payload, analysis);
  const brokers = forensics.brokers.filter((broker) => broker.crossCommunityCount >= 2 && broker.participationCoefficient >= 0.45);
  return {
    key: 'multi_community_broker',
    class: 'brokerage',
    count: brokers.length,
    strength: brokers.reduce((total, broker) => total + broker.forensicScore, 0),
    examples: brokers.slice(0, 8).map((broker) => [broker.nodeId]),
    explanation: 'A node distributes relationships across multiple communities with low enough redundancy to provide genuine brokerage rather than simple popularity.',
  };
}

export function analyzeInternalGraphMotifs(
  payload: InternalGraphPayload,
  analysis = analyzeInternalGraph(payload),
): InternalGraphMotif[] {
  return [
    countTriadicClosures(payload),
    countContextBridges(payload, analysis),
    countOutcomeChains(payload),
    countRepeatedEvidenceBridges(payload, analysis),
    countArticulationDependence(payload, analysis),
    countMultiCommunityBrokers(payload, analysis),
  ].sort((left, right) => right.strength - left.strength || stableCompare(left.key, right.key));
}

export function motifEpochPayload(motifs: InternalGraphMotif[]): Array<{
  key: string;
  class: InternalGraphMotifClass;
  count: number;
  strength: number;
}> {
  return motifs.map((motif) => ({
    key: motif.key,
    class: motif.class,
    count: motif.count,
    strength: motif.strength,
  }));
}
