import type {
  InternalGraphConfidence,
  InternalGraphPayload,
} from './InternalGraphEngine';
import { analyzeInternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';

export interface InternalGraphPerspectiveDefinition {
  id: string;
  title: string;
  description: string;
  focusKinds: string[];
  relations: string[];
  confidenceFloor: InternalGraphConfidence;
  minEvidenceCount: number;
  maxAgeDays: number | null;
  includeIsolates: boolean;
  builtin: boolean;
}

export interface InternalGraphPerspectiveResult {
  definition: InternalGraphPerspectiveDefinition;
  payload: InternalGraphPayload;
  perspectiveFingerprint: string;
  sceneVersion: string;
  hiddenNodeCount: number;
  hiddenEdgeCount: number;
  focusNodeCount: number;
  operatingRule: string;
}

export interface InternalGraphSceneDirective {
  id: string;
  perspectiveId: string;
  title: string;
  rationale: string;
  priority: number;
}

const CONFIDENCE_RANK: Record<InternalGraphConfidence, number> = {
  AMBIGUOUS: 0,
  DERIVED: 1,
  VERIFIED: 2,
};

export const INTERNAL_GRAPH_BUILTIN_PERSPECTIVES: InternalGraphPerspectiveDefinition[] = [
  {
    id: 'authorized_full',
    title: 'Authorized Full Graph',
    description: 'Everything in the already-authorized graph payload. No analytical filtering beyond capability/RLS boundaries.',
    focusKinds: [],
    relations: [],
    confidenceFloor: 'AMBIGUOUS',
    minEvidenceCount: 1,
    maxAgeDays: null,
    includeIsolates: true,
    builtin: true,
  },
  {
    id: 'evidence_first',
    title: 'Evidence First',
    description: 'Directly verified evidence only, emphasizing defensible topology before structural interpretation.',
    focusKinds: [],
    relations: [],
    confidenceFloor: 'VERIFIED',
    minEvidenceCount: 1,
    maxAgeDays: 730,
    includeIsolates: false,
    builtin: true,
  },
  {
    id: 'repeated_evidence',
    title: 'Repeated Evidence',
    description: 'Relationships supported at least twice, reducing one-off evidence dominance in broker/community analysis.',
    focusKinds: [],
    relations: [],
    confidenceFloor: 'DERIVED',
    minEvidenceCount: 2,
    maxAgeDays: 730,
    includeIsolates: false,
    builtin: true,
  },
  {
    id: 'recent_pulse',
    title: 'Recent Pulse',
    description: 'Relationships observed in the last 120 days for fast-moving topology and event-to-event emergence.',
    focusKinds: [],
    relations: [],
    confidenceFloor: 'DERIVED',
    minEvidenceCount: 1,
    maxAgeDays: 120,
    includeIsolates: false,
    builtin: true,
  },
  {
    id: 'context_map',
    title: 'Context Map',
    description: 'Organizations, domains, projects, topics, venues, roles and events with their directly connected context.',
    focusKinds: ['organization', 'domain', 'project', 'topic', 'venue', 'role', 'event'],
    relations: [],
    confidenceFloor: 'DERIVED',
    minEvidenceCount: 1,
    maxAgeDays: 1095,
    includeIsolates: false,
    builtin: true,
  },
  {
    id: 'outcome_ladder',
    title: 'Outcome Ladder',
    description: 'Relationship evidence most closely tied to verified mutual, Office Hours and aligned/completed outcome chronology.',
    focusKinds: ['person', 'event', 'outcome'],
    relations: ['mutual_with', 'office_hours_with', 'outcome_aligned', 'outcome_completed', 'aligned_to_outcome', 'signaled'],
    confidenceFloor: 'DERIVED',
    minEvidenceCount: 1,
    maxAgeDays: 1095,
    includeIsolates: false,
    builtin: true,
  },
  {
    id: 'broker_context',
    title: 'Broker Context',
    description: 'People plus real-world contexts that explain cross-community brokerage without treating brokerage as human value.',
    focusKinds: ['person', 'organization', 'project', 'role', 'event', 'venue'],
    relations: [],
    confidenceFloor: 'DERIVED',
    minEvidenceCount: 1,
    maxAgeDays: 730,
    includeIsolates: false,
    builtin: true,
  },
];

function normalizeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function stableDefinition(definition: InternalGraphPerspectiveDefinition): string {
  return JSON.stringify({
    focusKinds: normalizeStrings(definition.focusKinds),
    relations: normalizeStrings(definition.relations),
    confidenceFloor: definition.confidenceFloor,
    minEvidenceCount: Math.max(1, Math.floor(definition.minEvidenceCount)),
    maxAgeDays: definition.maxAgeDays == null ? null : Math.max(1, Math.floor(definition.maxAgeDays)),
    includeIsolates: definition.includeIsolates,
  });
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecentEnough(timestamp: string, maxAgeDays: number | null, now: number): boolean {
  if (maxAgeDays == null) return true;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return now - parsed <= maxAgeDays * 86_400_000;
}

/**
 * Applies a deterministic analytical lens to an already-authorized graph payload.
 * A perspective can only REMOVE evidence from view; it cannot add, enrich, infer,
 * or elevate permissions. The underlying canonical graph remains untouched.
 */
export function applyInternalGraphPerspective(
  payload: InternalGraphPayload,
  definition: InternalGraphPerspectiveDefinition,
  now = Date.now(),
): InternalGraphPerspectiveResult {
  const focusKinds = new Set(normalizeStrings(definition.focusKinds));
  const relations = new Set(normalizeStrings(definition.relations));
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const floorRank = CONFIDENCE_RANK[definition.confidenceFloor];
  const minEvidence = Math.max(1, Math.floor(definition.minEvidenceCount));

  const passingEdges = payload.edges.filter((edge) => {
    if (CONFIDENCE_RANK[edge.confidence] < floorRank) return false;
    if (edge.evidenceCount < minEvidence) return false;
    if (!isRecentEnough(edge.lastSeenAt, definition.maxAgeDays, now)) return false;
    if (relations.size > 0 && !relations.has(edge.relation.toLowerCase())) return false;
    if (focusKinds.size === 0) return true;
    const sourceKind = nodeById.get(edge.source)?.kind.toLowerCase() ?? '';
    const targetKind = nodeById.get(edge.target)?.kind.toLowerCase() ?? '';
    return focusKinds.has(sourceKind) || focusKinds.has(targetKind);
  });

  const visibleNodeIds = new Set<string>();
  for (const edge of passingEdges) {
    visibleNodeIds.add(edge.source);
    visibleNodeIds.add(edge.target);
  }
  if (definition.includeIsolates) {
    for (const node of payload.nodes) {
      if (focusKinds.size === 0 || focusKinds.has(node.kind.toLowerCase())) visibleNodeIds.add(node.id);
    }
  }

  const nodes = payload.nodes.filter((node) => visibleNodeIds.has(node.id));
  const edges = passingEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const perspectiveFingerprint = fingerprint(stableDefinition(definition));
  const sceneVersion = `${payload.graphVersion}:lens:${perspectiveFingerprint}`;

  return {
    definition,
    payload: {
      ...payload,
      graphVersion: sceneVersion,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes,
      edges,
    },
    perspectiveFingerprint,
    sceneVersion,
    hiddenNodeCount: Math.max(0, payload.nodeCount - nodes.length),
    hiddenEdgeCount: Math.max(0, payload.edgeCount - edges.length),
    focusNodeCount: focusKinds.size === 0 ? nodes.length : nodes.filter((node) => focusKinds.has(node.kind.toLowerCase())).length,
    operatingRule: 'Perspective filtering changes analytical visibility only. It never changes canonical graph evidence, capabilities, person identity, or relationship truth.',
  };
}

/**
 * Agent Scene Director. Returns reviewable lens suggestions only; it cannot apply
 * a perspective by itself or mutate graph state.
 */
export function recommendInternalGraphSceneDirectives(
  payload: InternalGraphPayload,
): InternalGraphSceneDirective[] {
  const health = analyzeInternalGraphEpistemicHealth(payload);
  const directives: InternalGraphSceneDirective[] = [];
  const relationSet = new Set(payload.edges.map((edge) => edge.relation));

  if (health.ambiguousEdgeRatio >= 0.08 || health.band === 'fragile' || health.band === 'degraded') {
    directives.push({
      id: 'director:evidence-first',
      perspectiveId: 'evidence_first',
      title: 'Reduce to verified evidence',
      rationale: `${Math.round(health.ambiguousEdgeRatio * 100)}% ambiguous evidence · graph health ${health.band}`,
      priority: 10,
    });
  }
  if (health.staleEdgeRatio >= 0.15 || health.freshEdgeRatio < 0.55) {
    directives.push({
      id: 'director:recent-pulse',
      perspectiveId: 'recent_pulse',
      title: 'Inspect recent topology only',
      rationale: `${Math.round(health.freshEdgeRatio * 100)}% of visible evidence is fresh within 120 days`,
      priority: 8.5,
    });
  }
  if (health.repeatedEvidenceRatio < 0.35 && payload.edgeCount >= 8) {
    directives.push({
      id: 'director:repeated',
      perspectiveId: 'repeated_evidence',
      title: 'Require repeated evidence',
      rationale: `Only ${Math.round(health.repeatedEvidenceRatio * 100)}% of relationships have repeated support`,
      priority: 8,
    });
  }
  if ([...relationSet].some((relation) => relation.startsWith('outcome_') || relation === 'office_hours_with' || relation === 'mutual_with')) {
    directives.push({
      id: 'director:outcome',
      perspectiveId: 'outcome_ladder',
      title: 'Trace relationship → outcome ladders',
      rationale: 'Verified relationship/outcome chronology exists in the current graph.',
      priority: 7.2,
    });
  }
  if (payload.nodes.some((node) => ['organization', 'domain', 'project', 'topic'].includes(node.kind))) {
    directives.push({
      id: 'director:context',
      perspectiveId: 'context_map',
      title: 'Reframe around ecosystem context',
      rationale: 'Context entities can reduce person-centric tunnel vision and expose shared ecosystems.',
      priority: 6.5,
    });
  }

  directives.push({
    id: 'director:broker-context',
    perspectiveId: 'broker_context',
    title: 'Inspect broker context',
    rationale: 'Brokerage should be interpreted through real-world contexts, not raw centrality alone.',
    priority: 6,
  });

  return directives.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}
