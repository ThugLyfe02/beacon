import type {
  InternalGraphConfidence,
  InternalGraphEdge,
  InternalGraphPayload,
} from './InternalGraphEngine';

export interface InternalGraphPatternNodeConstraint {
  kind?: string | null;
}

export interface InternalGraphPatternEdgeConstraint {
  relation?: string | null;
  confidenceFloor?: InternalGraphConfidence;
  minEvidenceCount?: number;
}

export interface InternalGraphPatternDefinition {
  id: string;
  title: string;
  nodeConstraints: InternalGraphPatternNodeConstraint[];
  edgeConstraints: InternalGraphPatternEdgeConstraint[];
  maxResults: number;
}

export interface InternalGraphPatternMatch {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  confidenceFloor: InternalGraphConfidence;
  verifiedEdgeRatio: number;
  evidenceCount: number;
  score: number;
}

export interface InternalGraphPatternResult {
  generatedAt: string;
  graphVersion: string;
  definition: InternalGraphPatternDefinition;
  matchCount: number;
  matches: InternalGraphPatternMatch[];
  operatingRule: string;
}

export interface InternalGraphPatternSuggestion {
  id: string;
  title: string;
  description: string;
  definition: InternalGraphPatternDefinition;
}

const CONFIDENCE_RANK: Record<InternalGraphConfidence, number> = {
  AMBIGUOUS: 0,
  DERIVED: 1,
  VERIFIED: 2,
};

function normalize(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
  return normalized || null;
}

function floorConfidence(edges: InternalGraphEdge[]): InternalGraphConfidence {
  return edges.reduce<InternalGraphConfidence>((floor, edge) => (
    CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[floor] ? edge.confidence : floor
  ), 'VERIFIED');
}

function edgePasses(edge: InternalGraphEdge, constraint: InternalGraphPatternEdgeConstraint): boolean {
  const relation = normalize(constraint.relation);
  if (relation && edge.relation.toLowerCase() !== relation) return false;
  const floor = constraint.confidenceFloor ?? 'AMBIGUOUS';
  if (CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[floor]) return false;
  if (edge.evidenceCount < Math.max(1, constraint.minEvidenceCount ?? 1)) return false;
  return true;
}

function nodePasses(kind: string, constraint: InternalGraphPatternNodeConstraint): boolean {
  const required = normalize(constraint.kind);
  return required == null || kind.toLowerCase() === required;
}

function buildAdjacency(payload: InternalGraphPayload): Map<string, Array<{ edge: InternalGraphEdge; nextId: string }>> {
  const adjacency = new Map<string, Array<{ edge: InternalGraphEdge; nextId: string }>>();
  for (const node of payload.nodes) adjacency.set(node.id, []);
  for (const edge of payload.edges) {
    adjacency.get(edge.source)?.push({ edge, nextId: edge.target });
    adjacency.get(edge.target)?.push({ edge, nextId: edge.source });
  }
  for (const rows of adjacency.values()) rows.sort((left, right) => left.edge.id.localeCompare(right.edge.id));
  return adjacency;
}

/**
 * Executes a bounded structural pattern query over already-authorized graph data.
 * Pattern grammar is path-shaped, max four edges, and cannot execute arbitrary
 * Cypher/SQL or fetch/enrich identities.
 */
export function runInternalGraphPatternQuery(
  payload: InternalGraphPayload,
  definition: InternalGraphPatternDefinition,
): InternalGraphPatternResult {
  const edgeCount = definition.edgeConstraints.length;
  if (edgeCount < 1 || edgeCount > 4 || definition.nodeConstraints.length !== edgeCount + 1) {
    return {
      generatedAt: new Date().toISOString(),
      graphVersion: payload.graphVersion,
      definition,
      matchCount: 0,
      matches: [],
      operatingRule: 'Pattern rejected because the bounded grammar requires 1-4 edges and exactly one more node constraint than edge constraints.',
    };
  }

  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const adjacency = buildAdjacency(payload);
  const maxResults = Math.max(1, Math.min(definition.maxResults || 40, 100));
  const matches: InternalGraphPatternMatch[] = [];

  const walk = (nodeIds: string[], edges: InternalGraphEdge[]) => {
    if (matches.length >= maxResults) return;
    const depth = edges.length;
    const currentId = nodeIds[nodeIds.length - 1];
    if (depth === edgeCount) {
      const floor = floorConfidence(edges);
      const verifiedEdgeRatio = edges.filter((edge) => edge.confidence === 'VERIFIED').length / edges.length;
      const evidenceCount = edges.reduce((sum, edge) => sum + edge.evidenceCount, 0);
      const score = verifiedEdgeRatio * 2 + Math.log2(1 + evidenceCount) * 0.5 + (floor === 'VERIFIED' ? 1 : floor === 'DERIVED' ? 0.5 : 0);
      matches.push({
        id: `${nodeIds.join('>')}|${edges.map((edge) => edge.id).join('>')}`,
        nodeIds: [...nodeIds],
        edgeIds: edges.map((edge) => edge.id),
        confidenceFloor: floor,
        verifiedEdgeRatio,
        evidenceCount,
        score,
      });
      return;
    }

    const edgeConstraint = definition.edgeConstraints[depth];
    const nextNodeConstraint = definition.nodeConstraints[depth + 1];
    for (const candidate of adjacency.get(currentId) ?? []) {
      if (nodeIds.includes(candidate.nextId)) continue;
      if (!edgePasses(candidate.edge, edgeConstraint)) continue;
      const nextNode = nodeById.get(candidate.nextId);
      if (!nextNode || !nodePasses(nextNode.kind, nextNodeConstraint)) continue;
      walk([...nodeIds, candidate.nextId], [...edges, candidate.edge]);
      if (matches.length >= maxResults) break;
    }
  };

  const startConstraint = definition.nodeConstraints[0];
  for (const node of payload.nodes) {
    if (!nodePasses(node.kind, startConstraint)) continue;
    walk([node.id], []);
    if (matches.length >= maxResults) break;
  }

  matches.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  return {
    generatedAt: new Date().toISOString(),
    graphVersion: payload.graphVersion,
    definition,
    matchCount: matches.length,
    matches,
    operatingRule: 'Pattern matches describe structural evidence chains only. They do not imply consent, intent, compatibility, misconduct, or permission to act.',
  };
}

export function suggestInternalGraphPatterns(payload: InternalGraphPayload): InternalGraphPatternSuggestion[] {
  const relations = new Set(payload.edges.map((edge) => edge.relation));
  const suggestions: InternalGraphPatternSuggestion[] = [];

  if (relations.has('mutual_with') && relations.has('office_hours_with')) {
    suggestions.push({
      id: 'mutual-to-office-hours',
      title: 'Mutual → Office Hours chain',
      description: 'Find verified mutual relationships that continue into an Office Hours relationship through a shared person node.',
      definition: {
        id: 'mutual-to-office-hours', title: 'Mutual → Office Hours chain',
        nodeConstraints: [{ kind: 'person' }, { kind: 'person' }, { kind: 'person' }],
        edgeConstraints: [
          { relation: 'mutual_with', confidenceFloor: 'VERIFIED', minEvidenceCount: 1 },
          { relation: 'office_hours_with', confidenceFloor: 'VERIFIED', minEvidenceCount: 1 },
        ],
        maxResults: 40,
      },
    });
  }
  if (relations.has('has_role') && relations.has('attended')) {
    suggestions.push({
      id: 'role-to-event',
      title: 'Role-context → event participation',
      description: 'Find role-linked people whose context also reaches an event participation chain.',
      definition: {
        id: 'role-to-event', title: 'Role-context → event participation',
        nodeConstraints: [{ kind: 'role' }, { kind: 'person' }, { kind: 'event' }],
        edgeConstraints: [
          { relation: 'has_role', confidenceFloor: 'DERIVED', minEvidenceCount: 1 },
          { relation: 'attended', confidenceFloor: 'VERIFIED', minEvidenceCount: 1 },
        ],
        maxResults: 40,
      },
    });
  }
  if (relations.has('mutual_with') && (relations.has('outcome_completed') || relations.has('outcome_aligned'))) {
    const outcomeRelation = relations.has('outcome_completed') ? 'outcome_completed' : 'outcome_aligned';
    suggestions.push({
      id: 'relationship-outcome',
      title: 'Relationship → outcome chain',
      description: 'Find verified mutual relationships with a nearby aligned/completed outcome relationship.',
      definition: {
        id: 'relationship-outcome', title: 'Relationship → outcome chain',
        nodeConstraints: [{ kind: 'person' }, { kind: 'person' }, { kind: null }],
        edgeConstraints: [
          { relation: 'mutual_with', confidenceFloor: 'VERIFIED', minEvidenceCount: 1 },
          { relation: outcomeRelation, confidenceFloor: 'DERIVED', minEvidenceCount: 1 },
        ],
        maxResults: 40,
      },
    });
  }

  return suggestions;
}
