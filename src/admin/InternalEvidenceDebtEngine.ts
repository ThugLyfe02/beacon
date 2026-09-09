import type { InternalGraphEdge, InternalGraphPayload } from './InternalGraphEngine';
import { analyzeInternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';
import type { InternalTargetRoutingPortfolio } from './InternalTargetRoutingEngine';

export type InternalEvidenceDebtKind =
  | 'ambiguous_evidence'
  | 'derived_critical_evidence'
  | 'stale_evidence'
  | 'single_observation'
  | 'critical_bridge_weakness'
  | 'weak_context'
  | 'route_single_point'
  | 'route_low_diversity';

export type InternalEvidenceDebtSurface =
  | 'InternalForensicsLab'
  | 'InternalTransformLab'
  | 'InternalEntityResolutionLab'
  | 'InternalTargetRouting'
  | 'InternalPerspectiveLab'
  | 'InternalDecisionJournal';

export interface InternalEvidenceDebtItem {
  id: string;
  kind: InternalEvidenceDebtKind;
  title: string;
  summary: string;
  priority: number;
  expectedAuthorityGain: number;
  edgeIds: string[];
  nodeIds: string[];
  reasons: string[];
  remediation: string[];
  recommendedSurface: InternalEvidenceDebtSurface;
}

export interface InternalEvidenceDebtReport {
  generatedAt: string;
  graphVersion: string;
  totalDebt: number;
  highPriorityCount: number;
  expectedRecoverableAuthority: number;
  items: InternalEvidenceDebtItem[];
  operatingRule: string;
}

const CONTEXT_KINDS = new Set([
  'event', 'venue', 'room', 'role', 'organization', 'domain', 'project', 'topic', 'outcome',
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ageDays(timestamp: string, now: number): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 86_400_000) : Number.POSITIVE_INFINITY;
}

function stableId(kind: InternalEvidenceDebtKind, parts: string[]): string {
  return `${kind}:${[...parts].sort().join('|')}`;
}

function edgeDebt(input: {
  edge: InternalGraphEdge;
  criticalBridge: boolean;
  now: number;
}): InternalEvidenceDebtItem[] {
  const { edge, criticalBridge, now } = input;
  const result: InternalEvidenceDebtItem[] = [];
  const structuralMultiplier = criticalBridge ? 1.35 : 1;
  const recencyDays = ageDays(edge.lastSeenAt, now);

  if (edge.confidence === 'AMBIGUOUS') {
    result.push({
      id: stableId('ambiguous_evidence', [edge.id]),
      kind: 'ambiguous_evidence',
      title: 'Ambiguous relationship carries analytical load',
      summary: `${edge.relation.replaceAll('_', ' ')} is represented with ambiguous evidence${criticalBridge ? ' and is structurally critical' : ''}.`,
      priority: Math.min(10, 6.2 * structuralMultiplier),
      expectedAuthorityGain: clamp01(0.08 * structuralMultiplier),
      edgeIds: [edge.id],
      nodeIds: [edge.source, edge.target],
      reasons: [
        'Ambiguous evidence lowers the confidence floor of every conclusion that depends on this relationship.',
        ...(criticalBridge ? ['The edge is also graph-theoretically critical, increasing the cost of uncertainty.'] : []),
      ],
      remediation: [
        'Inspect first/last-seen provenance and the originating first-party evidence.',
        'Prefer new verified first-party observations over external enrichment.',
        'If the evidence cannot be strengthened, keep conclusions that depend on this edge in caution/remediation state.',
      ],
      recommendedSurface: 'InternalTransformLab',
    });
  } else if (edge.confidence === 'DERIVED' && criticalBridge) {
    result.push({
      id: stableId('derived_critical_evidence', [edge.id]),
      kind: 'derived_critical_evidence',
      title: 'Derived evidence sits on a critical bridge',
      summary: `${edge.relation.replaceAll('_', ' ')} disconnects reachable topology if removed but is not directly verified.`,
      priority: 7.1,
      expectedAuthorityGain: 0.09,
      edgeIds: [edge.id],
      nodeIds: [edge.source, edge.target],
      reasons: [
        'A structurally critical conclusion should not depend disproportionately on derived evidence.',
        'Strengthening or disproving this edge can materially change broker, route, and community interpretation.',
      ],
      remediation: [
        'Review provenance before using this bridge in an intervention hypothesis.',
        'Seek corroborating first-party event/outcome evidence or explicitly preserve the derived confidence floor.',
      ],
      recommendedSurface: 'InternalForensicsLab',
    });
  }

  if (recencyDays > 365) {
    const staleStrength = clamp01((recencyDays - 365) / 730);
    result.push({
      id: stableId('stale_evidence', [edge.id]),
      kind: 'stale_evidence',
      title: 'Structurally relevant evidence is stale',
      summary: `${edge.relation.replaceAll('_', ' ')} was last observed ${Math.round(recencyDays)} days ago.`,
      priority: Math.min(10, (4.2 + staleStrength * 2.2) * structuralMultiplier),
      expectedAuthorityGain: clamp01((0.035 + staleStrength * 0.035) * structuralMultiplier),
      edgeIds: [edge.id],
      nodeIds: [edge.source, edge.target],
      reasons: [
        'Old evidence may still be true, but its current explanatory value is less certain.',
        ...(criticalBridge ? ['The stale edge is also structurally critical, increasing the need for caution.'] : []),
      ],
      remediation: [
        'Inspect whether later Beacon events provide confirming or contradictory first-party evidence.',
        'Use a recent-evidence Perspective when making time-sensitive routing decisions.',
      ],
      recommendedSurface: 'InternalPerspectiveLab',
    });
  }

  if (edge.evidenceCount <= 1) {
    result.push({
      id: stableId('single_observation', [edge.id]),
      kind: 'single_observation',
      title: 'Relationship has only one supporting observation',
      summary: `${edge.relation.replaceAll('_', ' ')} has not repeated in retained first-party evidence.`,
      priority: Math.min(10, 3.8 * structuralMultiplier),
      expectedAuthorityGain: clamp01(0.03 * structuralMultiplier),
      edgeIds: [edge.id],
      nodeIds: [edge.source, edge.target],
      reasons: [
        'One observation is more vulnerable to event-specific noise or stale context.',
        ...(criticalBridge ? ['The relationship is structurally critical, so repetition would disproportionately improve analytical confidence.'] : []),
      ],
      remediation: [
        'Do not manufacture corroboration; wait for or review independent first-party evidence.',
        'Keep one-shot evidence visible but lower its authority in intervention hypotheses.',
      ],
      recommendedSurface: 'InternalDecisionJournal',
    });
  }

  return result;
}

/**
 * Rank uncertainty obligations by expected improvement to graph-level analytical
 * authority. Evidence debt is never a score of a person, organization, community,
 * trustworthiness, or social value. It cannot authorize outreach or graph mutation.
 */
export function analyzeInternalEvidenceDebt(input: {
  payload: InternalGraphPayload;
  routingPortfolio?: InternalTargetRoutingPortfolio | null;
  now?: number;
}): InternalEvidenceDebtReport {
  const now = input.now ?? Date.now();
  const health = analyzeInternalGraphEpistemicHealth(input.payload, now);
  const forensics = analyzeInternalGraphForensics(input.payload);
  const criticalBridgeIds = new Set(forensics.bridgeEdgeIds);
  const items: InternalEvidenceDebtItem[] = [];

  for (const edge of input.payload.edges) {
    items.push(...edgeDebt({ edge, criticalBridge: criticalBridgeIds.has(edge.id), now }));
  }

  const degree = new Map<string, number>(input.payload.nodes.map((node) => [node.id, 0]));
  for (const edge of input.payload.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const weakContexts = input.payload.nodes
    .filter((node) => CONTEXT_KINDS.has(node.kind) && (degree.get(node.id) ?? 0) <= 1)
    .slice(0, 24);
  if (weakContexts.length > 0) {
    const ratio = weakContexts.length / Math.max(1, input.payload.nodes.filter((node) => CONTEXT_KINDS.has(node.kind)).length);
    items.push({
      id: stableId('weak_context', weakContexts.map((node) => node.id)),
      kind: 'weak_context',
      title: 'Context graph contains weakly anchored entities',
      summary: `${weakContexts.length} retained context nodes have only one visible relationship.`,
      priority: 3.5 + Math.min(3, ratio * 5),
      expectedAuthorityGain: clamp01(ratio * 0.08),
      edgeIds: [],
      nodeIds: weakContexts.map((node) => node.id),
      reasons: [
        'Thin context can fragment communities and make entity-level interpretation brittle.',
        'This is a graph-quality issue, not a statement about the entities themselves.',
      ],
      remediation: [
        'Review non-person duplicate candidates before creating new context nodes.',
        'Use Transform Lab to verify whether existing first-party context already anchors these entities.',
      ],
      recommendedSurface: 'InternalEntityResolutionLab',
    });
  }

  const routing = input.routingPortfolio ?? null;
  if (routing && routing.routes.length > 0 && routing.structuralSinglePointNodeIds.length > 0) {
    items.push({
      id: stableId('route_single_point', routing.structuralSinglePointNodeIds),
      kind: 'route_single_point',
      title: 'Target routing depends on shared structural bottlenecks',
      summary: `${routing.structuralSinglePointNodeIds.length} interior node${routing.structuralSinglePointNodeIds.length === 1 ? '' : 's'} appear across every selected route.`,
      priority: 8.2,
      expectedAuthorityGain: 0.1,
      edgeIds: [],
      nodeIds: routing.structuralSinglePointNodeIds,
      reasons: [
        'Multiple displayed routes are not independent when they all depend on the same structural point.',
        'This does not imply the bottleneck person/entity is risky or important outside the graph.',
      ],
      remediation: [
        'Search for an evidence-supported route that avoids the shared bottleneck.',
        'If no independent route exists, record the dependency explicitly before intervention review.',
      ],
      recommendedSurface: 'InternalTargetRouting',
    });
  }
  if (routing && routing.routes.length > 1 && routing.routeDiversity < 0.42) {
    items.push({
      id: stableId('route_low_diversity', routing.routes.map((route) => route.id)),
      kind: 'route_low_diversity',
      title: 'Route portfolio is visually plural but structurally redundant',
      summary: `Selected route diversity is ${Math.round(routing.routeDiversity * 100)}%.`,
      priority: 6.8,
      expectedAuthorityGain: 0.075,
      edgeIds: routing.routes.flatMap((route) => route.edges.map((edge) => edge.edgeId)),
      nodeIds: routing.routes.flatMap((route) => route.nodeIds),
      reasons: [
        'Low route diversity can create false confidence from several nearly identical paths.',
        'Independent alternatives improve resilience of structural reachability conclusions.',
      ],
      remediation: [
        'Prefer structurally distinct alternatives over small variations of the same evidence chain.',
        'Keep intervention review in caution state when no independent path exists.',
      ],
      recommendedSurface: 'InternalTargetRouting',
    });
  }

  const criticalWeakEdges = input.payload.edges.filter((edge) =>
    criticalBridgeIds.has(edge.id)
      && (edge.confidence !== 'VERIFIED' || edge.evidenceCount <= 1 || ageDays(edge.lastSeenAt, now) > 365));
  if (criticalWeakEdges.length > 0) {
    items.push({
      id: stableId('critical_bridge_weakness', criticalWeakEdges.map((edge) => edge.id)),
      kind: 'critical_bridge_weakness',
      title: 'Critical graph bridges carry weak evidence debt',
      summary: `${criticalWeakEdges.length} graph-theoretic bridge${criticalWeakEdges.length === 1 ? '' : 's'} are ambiguous, derived, stale, or one-shot.`,
      priority: 9.1,
      expectedAuthorityGain: Math.min(0.16, 0.04 + criticalWeakEdges.length * 0.015),
      edgeIds: criticalWeakEdges.map((edge) => edge.id),
      nodeIds: [...new Set(criticalWeakEdges.flatMap((edge) => [edge.source, edge.target]))],
      reasons: [
        'These edges disproportionately influence reachability and community structure.',
        'Improving or disproving their evidence can change multiple downstream conclusions at once.',
      ],
      remediation: [
        'Prioritize provenance review of structurally critical edges before less consequential weak evidence.',
        'If evidence cannot be strengthened, lower authority for routes/interventions that depend on them.',
      ],
      recommendedSurface: 'InternalForensicsLab',
    });
  }

  const deduped = new Map<string, InternalEvidenceDebtItem>();
  for (const item of items) {
    const existing = deduped.get(item.id);
    if (!existing || item.priority > existing.priority) deduped.set(item.id, item);
  }
  const ranked = [...deduped.values()]
    .sort((left, right) => right.priority - left.priority || right.expectedAuthorityGain - left.expectedAuthorityGain || left.id.localeCompare(right.id))
    .slice(0, 80);
  const totalDebt = ranked.reduce((sum, item) => sum + item.priority, 0);
  const expectedRecoverableAuthority = clamp01(
    Math.min(1 - health.score, ranked.slice(0, 8).reduce((sum, item) => sum + item.expectedAuthorityGain, 0)),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    graphVersion: input.payload.graphVersion,
    totalDebt,
    highPriorityCount: ranked.filter((item) => item.priority >= 7).length,
    expectedRecoverableAuthority,
    items: ranked,
    operatingRule: 'Evidence Debt ranks graph-level uncertainty obligations by expected analytical-authority gain. It never scores human worth, authorizes outreach, or permits external enrichment to manufacture certainty.',
  };
}
