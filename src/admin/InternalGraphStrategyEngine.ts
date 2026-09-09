import {
  analyzeInternalGraph,
  findInternalGraphPath,
  type InternalBridgeCandidate,
  type InternalGraphAnalysis,
  type InternalGraphCommunity,
  type InternalGraphPath,
  type InternalGraphPayload,
} from './InternalGraphEngine';

export interface InternalBridgePattern {
  connectorKind: string;
  sampleSize: number;
  introducedRate: number;
  mutualRate: number;
  officeHoursRate: number;
  outcomeRate: number;
  completedRate: number;
  averageInitialScore: number;
  confidence: number;
  lastObservedAt: string | null;
}

export interface InternalCommunityMovement {
  currentCommunityId: number;
  currentLabel: string;
  previousCommunityIds: number[];
  sharedNodeCount: number;
  retainedRatio: number;
  status: 'new' | 'stable' | 'converged';
}

export interface InternalCommunitySplit {
  previousCommunityId: number;
  previousLabel: string;
  currentCommunityIds: number[];
  sharedNodeCount: number;
}

export interface InternalGraphDrift {
  previousNodeCount: number;
  currentNodeCount: number;
  previousEdgeCount: number;
  currentEdgeCount: number;
  addedNodeIds: string[];
  removedNodeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  movements: InternalCommunityMovement[];
  splits: InternalCommunitySplit[];
  newBrokerIds: string[];
  lostBrokerIds: string[];
  newHubIds: string[];
  lostHubIds: string[];
  newBridgeKeys: string[];
  convergenceScore: number;
  fragmentationScore: number;
}

export interface InternalEcosystemPathResult {
  targetNodeId: string;
  targetLabel: string;
  targetKind: string;
  path: InternalGraphPath;
}

export type InternalInterventionKind =
  | 'structural_hole'
  | 'broker_activation'
  | 'unexpected_bridge'
  | 'community_drift'
  | 'ecosystem_path';

export interface InternalInterventionOpportunity {
  id: string;
  kind: InternalInterventionKind;
  score: number;
  title: string;
  rationale: string[];
  nodeIds: string[];
  requiresHumanApproval: true;
  evidence: Record<string, unknown>;
}

export type InternalAgentName =
  | 'Cartographer'
  | 'Broker Scout'
  | 'Historian'
  | 'Pathfinder'
  | 'Sentinel';

export interface InternalAgentMission {
  id: string;
  agent: InternalAgentName;
  priority: number;
  title: string;
  thesis: string;
  evidence: string[];
  nodeIds: string[];
  recommendedAction: string;
  autonomy: 'analysis_only';
  requiresHumanApproval: true;
}

export interface InternalAgentRun {
  generatedAt: string;
  graphVersion: string;
  targetQuery: string | null;
  missionCount: number;
  missions: InternalAgentMission[];
  operatingRule: string;
}

const DRIFT_NODE_KINDS = new Set(['person', 'role', 'organization', 'domain', 'project', 'topic']);

function canonicalPair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function setIntersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const item of smaller) if (larger.has(item)) count += 1;
  return count;
}

function filteredCommunityMembers(
  community: InternalGraphCommunity,
  payload: InternalGraphPayload,
): Set<string> {
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const filtered = community.nodeIds.filter((id) => DRIFT_NODE_KINDS.has(nodeById.get(id)?.kind ?? ''));
  return new Set(filtered.length > 0 ? filtered : community.nodeIds);
}

function bridgeKey(candidate: InternalBridgeCandidate): string {
  return `${canonicalPair(candidate.source, candidate.target)}|${candidate.via}`;
}

function safeBridgeCandidates(
  analysis: InternalGraphAnalysis,
  suppressions: ReadonlySet<string>,
): InternalBridgeCandidate[] {
  return analysis.bridgeCandidates.filter(
    (candidate) => !suppressions.has(canonicalPair(candidate.source, candidate.target)),
  );
}

/**
 * Event-to-event topology drift using stable Constellation node ids. Community ids
 * themselves are not assumed stable; communities are matched by evidence overlap.
 */
export function analyzeInternalGraphDrift(
  previous: InternalGraphPayload,
  current: InternalGraphPayload,
): InternalGraphDrift {
  const previousAnalysis = analyzeInternalGraph(previous);
  const currentAnalysis = analyzeInternalGraph(current);
  const previousNodes = new Set(previous.nodes.map((node) => node.id));
  const currentNodes = new Set(current.nodes.map((node) => node.id));
  const previousEdges = new Set(previous.edges.map((edge) => edge.id));
  const currentEdges = new Set(current.edges.map((edge) => edge.id));

  const previousMembers = new Map(
    previousAnalysis.communities.map((community) => [
      community.id,
      filteredCommunityMembers(community, previous),
    ] as const),
  );
  const currentMembers = new Map(
    currentAnalysis.communities.map((community) => [
      community.id,
      filteredCommunityMembers(community, current),
    ] as const),
  );

  const movements: InternalCommunityMovement[] = currentAnalysis.communities.map((community) => {
    const currentSet = currentMembers.get(community.id) ?? new Set<string>();
    const overlaps = previousAnalysis.communities
      .map((previousCommunity) => {
        const previousSet = previousMembers.get(previousCommunity.id) ?? new Set<string>();
        const shared = setIntersectionSize(currentSet, previousSet);
        const retained = shared / Math.max(1, Math.min(currentSet.size, previousSet.size));
        return { id: previousCommunity.id, shared, retained };
      })
      .filter((row) => row.shared >= 2 && row.retained >= 0.22)
      .sort((left, right) => right.shared - left.shared || right.retained - left.retained || left.id - right.id);

    const sharedNodeCount = overlaps.reduce((sum, row) => sum + row.shared, 0);
    return {
      currentCommunityId: community.id,
      currentLabel: community.label,
      previousCommunityIds: overlaps.map((row) => row.id),
      sharedNodeCount,
      retainedRatio: Math.min(1, sharedNodeCount / Math.max(1, currentSet.size)),
      status: overlaps.length === 0 ? 'new' : overlaps.length >= 2 ? 'converged' : 'stable',
    };
  });

  const splits: InternalCommunitySplit[] = previousAnalysis.communities.flatMap((previousCommunity) => {
    const previousSet = previousMembers.get(previousCommunity.id) ?? new Set<string>();
    const overlaps = currentAnalysis.communities
      .map((currentCommunity) => {
        const currentSet = currentMembers.get(currentCommunity.id) ?? new Set<string>();
        const shared = setIntersectionSize(previousSet, currentSet);
        const retained = shared / Math.max(1, Math.min(previousSet.size, currentSet.size));
        return { id: currentCommunity.id, shared, retained };
      })
      .filter((row) => row.shared >= 2 && row.retained >= 0.22)
      .sort((left, right) => right.shared - left.shared || left.id - right.id);
    if (overlaps.length < 2) return [];
    return [{
      previousCommunityId: previousCommunity.id,
      previousLabel: previousCommunity.label,
      currentCommunityIds: overlaps.map((row) => row.id),
      sharedNodeCount: overlaps.reduce((sum, row) => sum + row.shared, 0),
    }];
  });

  const previousBrokers = new Set(previousAnalysis.brokerNodeIds);
  const currentBrokers = new Set(currentAnalysis.brokerNodeIds);
  const previousHubs = new Set(previousAnalysis.hubNodeIds);
  const currentHubs = new Set(currentAnalysis.hubNodeIds);
  const previousBridges = new Set(previousAnalysis.bridgeCandidates.map(bridgeKey));
  const currentBridges = new Set(currentAnalysis.bridgeCandidates.map(bridgeKey));

  return {
    previousNodeCount: previous.nodeCount,
    currentNodeCount: current.nodeCount,
    previousEdgeCount: previous.edgeCount,
    currentEdgeCount: current.edgeCount,
    addedNodeIds: [...currentNodes].filter((id) => !previousNodes.has(id)).sort(),
    removedNodeIds: [...previousNodes].filter((id) => !currentNodes.has(id)).sort(),
    addedEdgeIds: [...currentEdges].filter((id) => !previousEdges.has(id)).sort(),
    removedEdgeIds: [...previousEdges].filter((id) => !currentEdges.has(id)).sort(),
    movements,
    splits,
    newBrokerIds: [...currentBrokers].filter((id) => !previousBrokers.has(id)).sort(),
    lostBrokerIds: [...previousBrokers].filter((id) => !currentBrokers.has(id)).sort(),
    newHubIds: [...currentHubs].filter((id) => !previousHubs.has(id)).sort(),
    lostHubIds: [...previousHubs].filter((id) => !currentHubs.has(id)).sort(),
    newBridgeKeys: [...currentBridges].filter((key) => !previousBridges.has(key)).sort(),
    convergenceScore: movements.filter((row) => row.status === 'converged').length / Math.max(1, movements.length),
    fragmentationScore: splits.length / Math.max(1, previousAnalysis.communities.length),
  };
}

export function findPathsToTargetEcosystem(
  payload: InternalGraphPayload,
  sourceNodeId: string,
  targetQuery: string,
  limit = 8,
): InternalEcosystemPathResult[] {
  const query = targetQuery.trim().toLowerCase();
  if (!query || !payload.nodes.some((node) => node.id === sourceNodeId)) return [];

  return payload.nodes
    .filter((node) => node.id !== sourceNodeId)
    .filter((node) => node.label.toLowerCase().includes(query) || node.kind.toLowerCase() === query)
    .flatMap((node) => {
      const path = findInternalGraphPath(payload, sourceNodeId, node.id);
      return path ? [{ targetNodeId: node.id, targetLabel: node.label, targetKind: node.kind, path }] : [];
    })
    .sort((left, right) => left.path.cost - right.path.cost || left.path.edgeIds.length - right.path.edgeIds.length || left.targetLabel.localeCompare(right.targetLabel))
    .slice(0, limit);
}

function patternByKind(patterns: InternalBridgePattern[]): Map<string, InternalBridgePattern> {
  return new Map(patterns.map((pattern) => [pattern.connectorKind, pattern] as const));
}

/**
 * Operator interventions combine current topology with historical observational
 * bridge patterns. The history adjusts ranking only; it never claims causality.
 */
export function rankInternalGraphInterventions(input: {
  payload: InternalGraphPayload;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
  drift?: InternalGraphDrift | null;
}): InternalInterventionOpportunity[] {
  const { payload, patterns = [], suppressions = new Set<string>(), drift = null } = input;
  const analysis = analyzeInternalGraph(payload);
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const patternMap = patternByKind(patterns);
  const opportunities: InternalInterventionOpportunity[] = [];

  for (const candidate of safeBridgeCandidates(analysis, suppressions).slice(0, 24)) {
    const via = nodeById.get(candidate.via);
    const pattern = patternMap.get(via?.kind ?? 'unknown');
    const observationalPrior = pattern
      ? pattern.outcomeRate * pattern.confidence
      : 0;
    const score = candidate.score * (1 + observationalPrior * 0.72);
    opportunities.push({
      id: `bridge:${bridgeKey(candidate)}`,
      kind: 'structural_hole',
      score,
      title: `${nodeById.get(candidate.source)?.label ?? candidate.source} ↔ ${nodeById.get(candidate.target)?.label ?? candidate.target}`,
      rationale: [
        ...candidate.why,
        ...(pattern ? [
          `${via?.kind ?? 'connector'} bridges historically show ${Math.round(pattern.outcomeRate * 100)}% observed aligned-outcome chronology across n=${pattern.sampleSize}`,
          `historical-pattern confidence ${Math.round(pattern.confidence * 100)}%; correlation only`,
        ] : ['no mature historical connector pattern yet']),
      ],
      nodeIds: [candidate.source, candidate.via, candidate.target],
      requiresHumanApproval: true,
      evidence: {
        connectorKind: via?.kind ?? 'unknown',
        candidateScore: candidate.score,
        observationalPrior,
        sampleSize: pattern?.sampleSize ?? 0,
      },
    });
  }

  for (const brokerId of analysis.brokerNodeIds.slice(0, 8)) {
    const metric = analysis.metrics.find((row) => row.nodeId === brokerId);
    const node = nodeById.get(brokerId);
    if (!metric || !node) continue;
    opportunities.push({
      id: `broker:${brokerId}`,
      kind: 'broker_activation',
      score: metric.brokerScore,
      title: `Broker leverage: ${node.label}`,
      rationale: [
        `cross-community broker score ${metric.brokerScore.toFixed(2)}`,
        `weighted connectivity ${metric.weightedDegree.toFixed(2)}`,
        'review whether this broker can credibly connect otherwise separated clusters',
      ],
      nodeIds: [brokerId],
      requiresHumanApproval: true,
      evidence: { communityId: metric.communityId, brokerScore: metric.brokerScore },
    });
  }

  for (const surprise of analysis.surprises.slice(0, 8)) {
    opportunities.push({
      id: `surprise:${surprise.edgeId}`,
      kind: 'unexpected_bridge',
      score: surprise.score,
      title: `Unexpected bridge: ${nodeById.get(surprise.source)?.label ?? surprise.source} ↔ ${nodeById.get(surprise.target)?.label ?? surprise.target}`,
      rationale: surprise.why,
      nodeIds: [surprise.source, surprise.target],
      requiresHumanApproval: true,
      evidence: { relation: surprise.relation, edgeId: surprise.edgeId },
    });
  }

  if (drift && (drift.convergenceScore > 0 || drift.fragmentationScore > 0)) {
    opportunities.push({
      id: 'drift:community-structure',
      kind: 'community_drift',
      score: (drift.convergenceScore + drift.fragmentationScore) * 4,
      title: 'Community structure materially changed',
      rationale: [
        `${drift.movements.filter((row) => row.status === 'converged').length} current communities show convergence`,
        `${drift.splits.length} previous communities show fragmentation`,
        `${drift.newBrokerIds.length} new brokers emerged`,
      ],
      nodeIds: drift.newBrokerIds.slice(0, 6),
      requiresHumanApproval: true,
      evidence: {
        convergenceScore: drift.convergenceScore,
        fragmentationScore: drift.fragmentationScore,
      },
    });
  }

  return opportunities
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 32);
}

export function runInternalGraphAgentOrchestrator(input: {
  current: InternalGraphPayload;
  previous?: InternalGraphPayload | null;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
  targetQuery?: string | null;
  sourceNodeId?: string | null;
}): InternalAgentRun {
  const {
    current,
    previous = null,
    patterns = [],
    suppressions = new Set<string>(),
    targetQuery = null,
    sourceNodeId = null,
  } = input;
  const analysis = analyzeInternalGraph(current);
  const drift = previous ? analyzeInternalGraphDrift(previous, current) : null;
  const interventions = rankInternalGraphInterventions({ payload: current, patterns, suppressions, drift });
  const nodeById = new Map(current.nodes.map((node) => [node.id, node] as const));
  const missions: InternalAgentMission[] = [];

  if (drift) {
    const convergenceCount = drift.movements.filter((row) => row.status === 'converged').length;
    missions.push({
      id: 'cartographer:drift',
      agent: 'Cartographer',
      priority: 7 + drift.convergenceScore * 4 + drift.fragmentationScore * 3,
      title: 'Re-map changing network boundaries',
      thesis: `${convergenceCount} communities converged and ${drift.splits.length} split relative to the comparison event.`,
      evidence: [
        `${drift.addedEdgeIds.length} edges appeared; ${drift.removedEdgeIds.length} disappeared`,
        `${drift.newBrokerIds.length} new brokers; ${drift.lostBrokerIds.length} lost brokers`,
      ],
      nodeIds: drift.newBrokerIds.slice(0, 8),
      recommendedAction: 'Review converging/splitting communities before programming the next room or intervention.',
      autonomy: 'analysis_only',
      requiresHumanApproval: true,
    });
  }

  const topBridge = interventions.find((item) => item.kind === 'structural_hole');
  if (topBridge) {
    missions.push({
      id: `broker-scout:${topBridge.id}`,
      agent: 'Broker Scout',
      priority: 9 + Math.min(5, topBridge.score),
      title: topBridge.title,
      thesis: topBridge.rationale[0] ?? 'A high-value structural hole is present.',
      evidence: topBridge.rationale,
      nodeIds: topBridge.nodeIds,
      recommendedAction: 'Inspect the connector and decide whether a human-mediated introduction is credible and appropriate.',
      autonomy: 'analysis_only',
      requiresHumanApproval: true,
    });
  }

  const maturePattern = [...patterns]
    .filter((pattern) => pattern.sampleSize >= 3)
    .sort((left, right) => (right.outcomeRate * right.confidence) - (left.outcomeRate * left.confidence))[0];
  if (maturePattern) {
    missions.push({
      id: `historian:${maturePattern.connectorKind}`,
      agent: 'Historian',
      priority: 5 + maturePattern.outcomeRate * maturePattern.confidence * 7,
      title: `Watch ${maturePattern.connectorKind} bridge archetypes`,
      thesis: `${Math.round(maturePattern.outcomeRate * 100)}% of retained ${maturePattern.connectorKind} watches reached aligned-outcome chronology across n=${maturePattern.sampleSize}.`,
      evidence: [
        `${Math.round(maturePattern.mutualRate * 100)}% mutual+`,
        `${Math.round(maturePattern.officeHoursRate * 100)}% Office Hours+`,
        `${Math.round(maturePattern.completedRate * 100)}% completed outcome`,
        'observational chronology only; not a causal estimate',
      ],
      nodeIds: [],
      recommendedAction: 'Use this as a ranking prior, then inspect current evidence before intervening.',
      autonomy: 'analysis_only',
      requiresHumanApproval: true,
    });
  }

  if (targetQuery && sourceNodeId) {
    const paths = findPathsToTargetEcosystem(current, sourceNodeId, targetQuery, 3);
    const best = paths[0];
    if (best) {
      missions.push({
        id: `pathfinder:${sourceNodeId}:${best.targetNodeId}`,
        agent: 'Pathfinder',
        priority: 10 - Math.min(6, best.path.cost),
        title: `Explainable route into ${targetQuery}`,
        thesis: `${nodeById.get(sourceNodeId)?.label ?? sourceNodeId} can reach ${best.targetLabel} through ${best.path.edgeIds.length} evidence-backed hops.`,
        evidence: [
          `path cost ${best.path.cost.toFixed(3)}`,
          best.path.nodeIds.map((id) => nodeById.get(id)?.label ?? id).join(' → '),
        ],
        nodeIds: best.path.nodeIds,
        recommendedAction: 'Inspect each hop for current relevance and consent before using the route operationally.',
        autonomy: 'analysis_only',
        requiresHumanApproval: true,
      });
    }
  }

  missions.push({
    id: 'sentinel:suppression',
    agent: 'Sentinel',
    priority: suppressions.size > 0 ? 8 : 4,
    title: 'Bridge-safety boundary calibrated',
    thesis: `${suppressions.size} blocked pair${suppressions.size === 1 ? '' : 's'} are suppressed independently of visualization mode.`,
    evidence: [
      'candidate generation fails closed if the suppression set cannot be loaded',
      'agents cannot override block state or restricted graph permissions',
    ],
    nodeIds: [],
    recommendedAction: 'No action required unless suppression calibration fails or restricted evidence needs review.',
    autonomy: 'analysis_only',
    requiresHumanApproval: true,
  });

  missions.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return {
    generatedAt: new Date().toISOString(),
    graphVersion: current.graphVersion,
    targetQuery,
    missionCount: missions.length,
    missions,
    operatingRule: 'Agents continuously detect, rank and explain. They do not message users, create introductions, or mutate relationships without explicit operator approval.',
  };
}
