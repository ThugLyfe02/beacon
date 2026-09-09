import type { InternalGraphEdge, InternalGraphPayload } from './InternalGraphEngine';

export type InternalEvidenceTensionKind =
  | 'safety_state_overlap'
  | 'confidence_divergence'
  | 'scope_overlap';

export interface InternalEvidenceTensionCandidate {
  id: string;
  kind: InternalEvidenceTensionKind;
  leftEdgeId: string;
  rightEdgeId: string;
  score: number;
  reasons: string[];
  suggestedConflictKind: 'state_collision' | 'provenance_disagreement' | 'scope_mismatch';
}

const RELATIONSHIP_RELATIONS = new Set([
  'mutual_with',
  'office_hours_with',
  'outcome_aligned',
  'outcome_completed',
  'signaled',
]);
const SAFETY_RELATIONS = new Set(['blocked', 'reported']);
const CONFIDENCE_RANK = { AMBIGUOUS: 0, DERIVED: 1, VERIFIED: 2 } as const;

function parseTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function overlapDays(left: InternalGraphEdge, right: InternalGraphEdge): number {
  const leftStart = parseTime(left.firstSeenAt);
  const leftEnd = parseTime(left.lastSeenAt);
  const rightStart = parseTime(right.firstSeenAt);
  const rightEnd = parseTime(right.lastSeenAt);
  if (leftStart == null || leftEnd == null || rightStart == null || rightEnd == null) return 0;
  const overlap = Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart);
  return Math.max(0, overlap / 86_400_000);
}

function pairKey(edge: InternalGraphEdge): string {
  const [left, right] = edge.source < edge.target
    ? [edge.source, edge.target]
    : [edge.target, edge.source];
  return `${left}|${right}`;
}

function candidateId(kind: InternalEvidenceTensionKind, left: string, right: string): string {
  return `${kind}:${left < right ? `${left}:${right}` : `${right}:${left}`}`;
}

/**
 * Suggest review tensions between already-authorized graph edges.
 *
 * A tension is deliberately weaker than a contradiction. It never writes to the
 * conflict ledger, changes canonical evidence, or declares either edge false.
 * Operators must inspect and explicitly confirm a real conflict themselves.
 */
export function analyzeInternalEvidenceTensions(payload: InternalGraphPayload): InternalEvidenceTensionCandidate[] {
  const groups = new Map<string, InternalGraphEdge[]>();
  for (const edge of payload.edges) {
    const key = pairKey(edge);
    const bucket = groups.get(key) ?? [];
    bucket.push(edge);
    groups.set(key, bucket);
  }

  const candidates = new Map<string, InternalEvidenceTensionCandidate>();
  const add = (candidate: InternalEvidenceTensionCandidate) => {
    const existing = candidates.get(candidate.id);
    if (!existing || candidate.score > existing.score) candidates.set(candidate.id, candidate);
  };

  for (const edges of groups.values()) {
    if (edges.length < 2) continue;
    const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const left = ordered[i]!;
        const right = ordered[j]!;
        const overlap = overlapDays(left, right);

        const safetyOverlap = (
          (SAFETY_RELATIONS.has(left.relation) && RELATIONSHIP_RELATIONS.has(right.relation))
          || (SAFETY_RELATIONS.has(right.relation) && RELATIONSHIP_RELATIONS.has(left.relation))
        );
        if (safetyOverlap && overlap > 0) {
          add({
            id: candidateId('safety_state_overlap', left.id, right.id),
            kind: 'safety_state_overlap',
            leftEdgeId: left.id,
            rightEdgeId: right.id,
            score: Math.min(1, 0.72 + Math.min(0.2, overlap / 120)),
            reasons: [
              `${left.relation.replaceAll('_', ' ')} and ${right.relation.replaceAll('_', ' ')} have overlapping retained observation windows`,
              `overlap ~${Math.round(overlap)} day${Math.round(overlap) === 1 ? '' : 's'}`,
              'this is a safety/state review tension only; it does not erase or negate historical relationship evidence',
            ],
            suggestedConflictKind: 'state_collision',
          });
        }

        if (
          left.relation === right.relation
          && left.scopeKey === right.scopeKey
          && left.id !== right.id
          && Math.abs(CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence]) >= 2
          && overlap > 0
        ) {
          add({
            id: candidateId('confidence_divergence', left.id, right.id),
            kind: 'confidence_divergence',
            leftEdgeId: left.id,
            rightEdgeId: right.id,
            score: 0.68,
            reasons: [
              `the same relation/scope is retained with ${left.confidence.toLowerCase()} and ${right.confidence.toLowerCase()} confidence`,
              'overlapping observation windows make provenance/confidence reconciliation worth reviewing',
              'confidence disagreement is not proof that either evidence edge is wrong',
            ],
            suggestedConflictKind: 'provenance_disagreement',
          });
        }

        if (
          left.relation === right.relation
          && left.scopeKey !== right.scopeKey
          && overlap > 0
        ) {
          add({
            id: candidateId('scope_overlap', left.id, right.id),
            kind: 'scope_overlap',
            leftEdgeId: left.id,
            rightEdgeId: right.id,
            score: Math.min(0.62, 0.44 + Math.min(0.18, overlap / 180)),
            reasons: [
              `the same relation appears across distinct evidence scopes during overlapping retained windows`,
              'cross-scope duplication may be legitimate; review only when scope semantics matter to a conclusion',
            ],
            suggestedConflictKind: 'scope_mismatch',
          });
        }
      }
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 80);
}
