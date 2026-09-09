import {
  analyzeInternalGraph,
  type InternalGraphPayload,
} from './InternalGraphEngine';
import {
  expandInternalTransformNeighborhood,
  runInternalNodeTransforms,
  type InternalTransformKind,
} from './InternalGraphTransformEngine';
import { analyzeInternalGraphImpact, type InternalImpactDirection } from './InternalGraphImpactEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';
import { analyzeInternalGraphMotifs } from './InternalGraphMotifEngine';
import {
  analyzeInternalGraphDrift,
  findPathsToTargetEcosystem,
} from './InternalGraphStrategyEngine';

export type InternalGraphMachineStep =
  | {
      id: string;
      kind: 'transform';
      title: string;
      transform: InternalTransformKind;
      source: 'seed' | 'frontier';
      maxSources?: number;
    }
  | {
      id: string;
      kind: 'expand';
      title: string;
      depth: number;
      maxNodes: number;
    }
  | {
      id: string;
      kind: 'impact';
      title: string;
      direction: InternalImpactDirection;
      depth: number;
      relations?: string[];
      maxSources?: number;
    }
  | {
      id: string;
      kind: 'forensics';
      title: string;
      topN: number;
    }
  | {
      id: string;
      kind: 'motifs';
      title: string;
      topN: number;
      motifKeys?: string[];
    }
  | {
      id: string;
      kind: 'surprises';
      title: string;
      topN: number;
    }
  | {
      id: string;
      kind: 'ecosystem_path';
      title: string;
      maxPaths: number;
    }
  | {
      id: string;
      kind: 'drift';
      title: string;
    };

export interface InternalGraphMachineDefinition {
  id: string;
  title: string;
  purpose: string;
  requiresSeed: boolean;
  requiresTargetQuery: boolean;
  requiresPreviousGraph: boolean;
  steps: InternalGraphMachineStep[];
}

export interface InternalGraphMachineTraceStep {
  stepId: string;
  kind: InternalGraphMachineStep['kind'];
  title: string;
  inputNodeIds: string[];
  outputNodeIds: string[];
  edgeIds: string[];
  evidence: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface InternalGraphMachineRun {
  machineId: string;
  title: string;
  generatedAt: string;
  graphVersion: string;
  seedNodeId: string | null;
  targetQuery: string | null;
  trace: InternalGraphMachineTraceStep[];
  finalNodeIds: string[];
  finalEdgeIds: string[];
  questions: string[];
  operatingRule: string;
}

const OUTCOME_RELATIONS = [
  'mutual_with',
  'office_hours_with',
  'outcome_aligned',
  'outcome_completed',
];

export const INTERNAL_GRAPH_MACHINES: InternalGraphMachineDefinition[] = [
  {
    id: 'broker-xray',
    title: 'Broker X-Ray',
    purpose: 'Explain whether a selected node is genuine cross-community brokerage, what depends on it, and which evidence chains create that position.',
    requiresSeed: true,
    requiresTargetQuery: false,
    requiresPreviousGraph: false,
    steps: [
      { id: 'bridge-pivots', kind: 'transform', title: 'Cross-community pivots', transform: 'bridge_pivot', source: 'seed' },
      { id: 'provenance', kind: 'transform', title: 'Evidence provenance', transform: 'provenance', source: 'seed' },
      { id: 'impact', kind: 'impact', title: 'Structural blast radius', direction: 'both', depth: 3, maxSources: 1 },
      { id: 'forensics', kind: 'forensics', title: 'Brokerage forensics', topN: 16 },
      { id: 'motifs', kind: 'motifs', title: 'Higher-order brokerage motifs', topN: 8, motifKeys: ['multi_community_broker', 'articulation_dependence', 'cross_community_context_bridge'] },
    ],
  },
  {
    id: 'ecosystem-entry',
    title: 'Target Ecosystem Entry',
    purpose: 'Find explainable entry routes into a target ecosystem, expose path bottlenecks, and test whether the route has redundant alternatives.',
    requiresSeed: true,
    requiresTargetQuery: true,
    requiresPreviousGraph: false,
    steps: [
      { id: 'local-context', kind: 'expand', title: 'Local evidence neighborhood', depth: 2, maxNodes: 180 },
      { id: 'paths', kind: 'ecosystem_path', title: 'Explainable target paths', maxPaths: 8 },
      { id: 'impact', kind: 'impact', title: 'Reachability blast radius', direction: 'both', depth: 3, maxSources: 1 },
      { id: 'forensics', kind: 'forensics', title: 'Path bottleneck forensics', topN: 18 },
      { id: 'surprises', kind: 'surprises', title: 'Unexpected cross-community entry edges', topN: 10 },
    ],
  },
  {
    id: 'bridge-emergence',
    title: 'Unexpected Bridge Emergence',
    purpose: 'Surface non-obvious cross-community edges, genuine structural bridges, and higher-order patterns that can explain newly emerging network connectivity.',
    requiresSeed: false,
    requiresTargetQuery: false,
    requiresPreviousGraph: false,
    steps: [
      { id: 'surprises', kind: 'surprises', title: 'Unexpected connections', topN: 18 },
      { id: 'forensics', kind: 'forensics', title: 'Critical edge forensics', topN: 18 },
      { id: 'motifs', kind: 'motifs', title: 'Bridge motifs', topN: 10, motifKeys: ['cross_community_context_bridge', 'repeated_cross_community_edge', 'multi_community_broker'] },
    ],
  },
  {
    id: 'community-drift',
    title: 'Community Drift Autopsy',
    purpose: 'Explain how communities converged, split, or re-centered between two event graphs and which brokers or motifs changed with them.',
    requiresSeed: false,
    requiresTargetQuery: false,
    requiresPreviousGraph: true,
    steps: [
      { id: 'drift', kind: 'drift', title: 'Event-to-event topology drift' },
      { id: 'forensics', kind: 'forensics', title: 'Current structural dependence', topN: 18 },
      { id: 'motifs', kind: 'motifs', title: 'Current network motifs', topN: 10 },
      { id: 'surprises', kind: 'surprises', title: 'Newly important unexpected edges', topN: 12 },
    ],
  },
  {
    id: 'outcome-ladder',
    title: 'Outcome Ladder Audit',
    purpose: 'Trace first-party relationship ladders from mutual evidence through Office Hours and independently confirmed outcomes without claiming operator causation.',
    requiresSeed: false,
    requiresTargetQuery: false,
    requiresPreviousGraph: false,
    steps: [
      { id: 'motifs', kind: 'motifs', title: 'Relationship-to-outcome motifs', topN: 10, motifKeys: ['relationship_outcome_ladder'] },
      { id: 'impact', kind: 'impact', title: 'Outcome-chain reachability', direction: 'both', depth: 4, relations: OUTCOME_RELATIONS, maxSources: 5 },
      { id: 'provenance', kind: 'transform', title: 'Outcome evidence provenance', transform: 'provenance', source: 'frontier', maxSources: 5 },
    ],
  },
];

function stableUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function label(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function traceQuestions(
  payload: InternalGraphPayload,
  trace: InternalGraphMachineTraceStep[],
  targetQuery: string | null,
): string[] {
  const questions: string[] = [];
  const impact = trace.find((step) => step.kind === 'impact');
  const forensics = trace.find((step) => step.kind === 'forensics');
  const drift = trace.find((step) => step.kind === 'drift');
  const paths = trace.find((step) => step.kind === 'ecosystem_path');

  const bottleneckId = typeof impact?.metrics.topBottleneckNodeId === 'string'
    ? impact.metrics.topBottleneckNodeId
    : null;
  if (bottleneckId) {
    questions.push(`What alternate evidence route bypasses ${label(payload, bottleneckId)} if that structural bottleneck is unavailable?`);
  }
  if (forensics && Number(forensics.metrics.articulationCount ?? 0) > 0) {
    questions.push('Which articulation dependencies can be reduced by strengthening already-consensual alternate routes between communities?');
  }
  if (paths && Number(paths.metrics.pathCount ?? 0) === 1 && targetQuery) {
    questions.push(`Can ${targetQuery} be reached through a second independent evidence path rather than one fragile route?`);
  }
  if (drift && Number(drift.metrics.convergedCommunityCount ?? 0) > 0) {
    questions.push('Which shared event, role, organization, project, or topic context best explains the observed community convergence?');
  }
  if (drift && Number(drift.metrics.splitCommunityCount ?? 0) > 0) {
    questions.push('Which evidence edges disappeared or weakened around the communities that split?');
  }
  if (trace.some((step) => step.kind === 'surprises' && step.outputNodeIds.length > 0)) {
    questions.push('Which unexpected bridge is repeated across independent evidence, and which is only a one-off structural anomaly?');
  }
  if (trace.some((step) => step.kind === 'motifs' && Number(step.metrics.outcomeLadderCount ?? 0) > 0)) {
    questions.push('Which contexts repeatedly appear in relationship-to-outcome ladders, and does that pattern survive Bayesian shrinkage in Pattern Lab?');
  }

  return stableUnique(questions).slice(0, 10);
}

export function runInternalGraphMachine(
  machineId: string,
  input: {
    current: InternalGraphPayload;
    previous?: InternalGraphPayload | null;
    seedNodeId?: string | null;
    targetQuery?: string | null;
  },
): InternalGraphMachineRun {
  const machine = INTERNAL_GRAPH_MACHINES.find((candidate) => candidate.id === machineId);
  if (!machine) throw new Error(`Unknown Constellation machine: ${machineId}`);
  const seedNodeId = input.seedNodeId ?? null;
  const targetQuery = input.targetQuery?.trim() || null;
  if (machine.requiresSeed && (!seedNodeId || !input.current.nodes.some((node) => node.id === seedNodeId))) {
    throw new Error(`${machine.title} requires a valid seed node.`);
  }
  if (machine.requiresTargetQuery && !targetQuery) {
    throw new Error(`${machine.title} requires a target ecosystem query.`);
  }
  if (machine.requiresPreviousGraph && !input.previous) {
    throw new Error(`${machine.title} requires a previous event graph.`);
  }

  const analysis = analyzeInternalGraph(input.current);
  const forensics = analyzeInternalGraphForensics(input.current, analysis);
  const motifs = analyzeInternalGraphMotifs(input.current, analysis);
  let frontier = seedNodeId ? [seedNodeId] : [];
  const trace: InternalGraphMachineTraceStep[] = [];
  const finalNodes = new Set<string>(frontier);
  const finalEdges = new Set<string>();

  for (const step of machine.steps) {
    const inputNodeIds = [...frontier];
    let outputNodeIds: string[] = [];
    let edgeIds: string[] = [];
    let evidence: string[] = [];
    const metrics: Record<string, number | string | boolean> = {};

    if (step.kind === 'transform') {
      const sources = (step.source === 'seed' && seedNodeId ? [seedNodeId] : frontier)
        .slice(0, Math.max(1, Math.min(step.maxSources ?? 8, 20)));
      const rows = sources.flatMap((source) =>
        runInternalNodeTransforms(input.current, source).filter((result) => result.kind === step.transform));
      outputNodeIds = stableUnique(rows.flatMap((row) => row.targetNodeIds));
      edgeIds = stableUnique(rows.flatMap((row) => row.edgeIds));
      evidence = rows.flatMap((row) => row.evidence).slice(0, 16);
      metrics.transformResultCount = rows.length;
      metrics.aggregateScore = rows.reduce((sum, row) => sum + row.score, 0);
    } else if (step.kind === 'expand') {
      const seeds = frontier.length > 0 ? frontier : seedNodeId ? [seedNodeId] : [];
      const expanded = expandInternalTransformNeighborhood(input.current, seeds, step.depth, step.maxNodes);
      outputNodeIds = expanded.nodeIds;
      edgeIds = expanded.edgeIds;
      metrics.nodeCount = expanded.nodeIds.length;
      metrics.edgeCount = expanded.edgeIds.length;
      metrics.depth = step.depth;
    } else if (step.kind === 'impact') {
      let sources = frontier.length > 0 ? frontier : seedNodeId ? [seedNodeId] : [];
      if (sources.length === 0) {
        sources = analysis.brokerNodeIds.slice(0, step.maxSources ?? 5);
      }
      sources = sources.slice(0, Math.max(1, Math.min(step.maxSources ?? 5, 12)));
      const rows = sources.map((source) => analyzeInternalGraphImpact(input.current, source, {
        direction: step.direction,
        depth: step.depth,
        relations: step.relations ?? null,
        maxHits: 180,
      }));
      outputNodeIds = stableUnique(rows.flatMap((row) => row.nodeIds));
      edgeIds = stableUnique(rows.flatMap((row) => row.edgeIds));
      const topBottleneck = rows.flatMap((row) => row.bottlenecks)
        .sort((left, right) => right.pathCount - left.pathCount || right.weightedPathCount - left.weightedPathCount)[0];
      evidence = rows.flatMap((row) => row.hits.slice(0, 4).map((hit) =>
        `${label(input.current, sourceForPath(hit.pathNodeIds))} → ${label(input.current, hit.nodeId)} · depth ${hit.depth} · ${hit.relation} · ${hit.confidenceFloor}`
      )).slice(0, 16);
      metrics.hitCount = rows.reduce((sum, row) => sum + row.hits.length, 0);
      metrics.verifiedHitRatio = rows.length > 0
        ? rows.reduce((sum, row) => sum + row.verifiedHitRatio, 0) / rows.length
        : 0;
      if (topBottleneck) {
        metrics.topBottleneckNodeId = topBottleneck.nodeId;
        metrics.topBottleneckPathCount = topBottleneck.pathCount;
      }
    } else if (step.kind === 'forensics') {
      const working = new Set(frontier);
      const brokers = forensics.brokers
        .filter((broker) => working.size === 0 || working.has(broker.nodeId))
        .slice(0, step.topN);
      const criticalEdges = forensics.criticalBridges.slice(0, step.topN);
      outputNodeIds = stableUnique([
        ...brokers.map((broker) => broker.nodeId),
        ...criticalEdges.flatMap((edge) => [edge.source, edge.target]),
      ]);
      edgeIds = stableUnique(criticalEdges.map((edge) => edge.edgeId));
      evidence = [
        ...brokers.slice(0, 8).map((broker) => `${label(input.current, broker.nodeId)} · forensic ${broker.forensicScore.toFixed(2)} · participation ${broker.participationCoefficient.toFixed(2)}${broker.articulation ? ' · articulation' : ''}`),
        ...criticalEdges.slice(0, 6).map((edge) => `${label(input.current, edge.source)} ↔ ${label(input.current, edge.target)} · surprisal ${edge.edgeSurprisal.toFixed(2)}${edge.disconnectsGraph ? ' · graph bridge' : ''}`),
      ];
      metrics.brokerCount = brokers.length;
      metrics.articulationCount = brokers.filter((broker) => broker.articulation).length;
      metrics.criticalBridgeCount = criticalEdges.length;
      metrics.structuralDependence = forensics.structuralDependence;
    } else if (step.kind === 'motifs') {
      const allowed = step.motifKeys ? new Set(step.motifKeys) : null;
      const rows = motifs.filter((motif) => !allowed || allowed.has(motif.key)).slice(0, step.topN);
      outputNodeIds = stableUnique(rows.flatMap((motif) => motif.examples.flat()));
      evidence = rows.map((motif) => `${motif.key} · count ${motif.count} · strength ${motif.strength.toFixed(2)} · ${motif.explanation}`);
      metrics.motifCount = rows.length;
      metrics.totalOccurrences = rows.reduce((sum, motif) => sum + motif.count, 0);
      metrics.outcomeLadderCount = rows.find((motif) => motif.key === 'relationship_outcome_ladder')?.count ?? 0;
    } else if (step.kind === 'surprises') {
      const rows = analysis.surprises.slice(0, step.topN);
      outputNodeIds = stableUnique(rows.flatMap((row) => [row.source, row.target]));
      edgeIds = stableUnique(rows.map((row) => row.edgeId));
      evidence = rows.map((row) => `${label(input.current, row.source)} ↔ ${label(input.current, row.target)} · ${row.relation} · score ${row.score.toFixed(2)} · ${row.why.join('; ')}`);
      metrics.surpriseCount = rows.length;
      metrics.maxSurpriseScore = rows[0]?.score ?? 0;
    } else if (step.kind === 'ecosystem_path') {
      const source = seedNodeId ?? frontier.find((nodeId) => input.current.nodes.some((node) => node.id === nodeId && node.kind === 'person')) ?? null;
      const rows = source && targetQuery
        ? findPathsToTargetEcosystem(input.current, source, targetQuery, step.maxPaths)
        : [];
      outputNodeIds = stableUnique(rows.flatMap((row) => row.path.nodeIds));
      edgeIds = stableUnique(rows.flatMap((row) => row.path.edgeIds));
      evidence = rows.map((row) => `${label(input.current, source!)} → ${row.targetLabel} · ${row.path.edgeIds.length} hops · cost ${row.path.cost.toFixed(3)}`);
      metrics.pathCount = rows.length;
      metrics.bestPathCost = rows[0]?.path.cost ?? -1;
    } else if (step.kind === 'drift') {
      if (!input.previous) throw new Error(`${machine.title} requires a previous graph for drift.`);
      const drift = analyzeInternalGraphDrift(input.previous, input.current);
      outputNodeIds = stableUnique([
        ...drift.addedNodeIds,
        ...drift.removedNodeIds,
        ...drift.newBrokerIds,
        ...drift.lostBrokerIds,
      ]);
      edgeIds = stableUnique([...drift.addedEdgeIds, ...drift.removedEdgeIds]);
      evidence = [
        `added nodes ${drift.addedNodeIds.length} · removed ${drift.removedNodeIds.length}`,
        `new brokers ${drift.newBrokerIds.length} · lost brokers ${drift.lostBrokerIds.length}`,
        `convergence ${(drift.convergenceScore * 100).toFixed(0)}% · fragmentation ${(drift.fragmentationScore * 100).toFixed(0)}%`,
        `community splits ${drift.splits.length} · new structural holes ${drift.newBridgeKeys.length}`,
      ];
      metrics.addedNodeCount = drift.addedNodeIds.length;
      metrics.removedNodeCount = drift.removedNodeIds.length;
      metrics.newBrokerCount = drift.newBrokerIds.length;
      metrics.lostBrokerCount = drift.lostBrokerIds.length;
      metrics.convergedCommunityCount = drift.movements.filter((movement) => movement.status === 'converged').length;
      metrics.splitCommunityCount = drift.splits.length;
      metrics.convergenceScore = drift.convergenceScore;
      metrics.fragmentationScore = drift.fragmentationScore;
    }

    outputNodeIds.forEach((nodeId) => finalNodes.add(nodeId));
    edgeIds.forEach((edgeId) => finalEdges.add(edgeId));
    if (outputNodeIds.length > 0) frontier = outputNodeIds.slice(0, 180);
    trace.push({
      stepId: step.id,
      kind: step.kind,
      title: step.title,
      inputNodeIds,
      outputNodeIds,
      edgeIds,
      evidence,
      metrics,
    });
  }

  return {
    machineId: machine.id,
    title: machine.title,
    generatedAt: new Date().toISOString(),
    graphVersion: input.current.graphVersion,
    seedNodeId,
    targetQuery,
    trace,
    finalNodeIds: stableUnique([...finalNodes]),
    finalEdgeIds: stableUnique([...finalEdges]),
    questions: traceQuestions(input.current, trace, targetQuery),
    operatingRule: 'Machine steps compose deterministic transforms over already-authorized Beacon evidence. A Machine may analyze or propose questions; it cannot fetch external identity data, message users, create relationships, bypass blocks, or write hypothetical results as evidence.',
  };
}

function sourceForPath(pathNodeIds: string[]): string {
  return pathNodeIds[0] ?? '';
}
