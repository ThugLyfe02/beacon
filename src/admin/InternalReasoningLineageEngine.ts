import type { InternalDecisionJournalEntry } from './internalDecisionJournal.service';
import type { InternalDecisionEvidenceRef } from './internalDecisionEvidenceRefs.service';
import type { InternalEvidenceConflict } from './internalEvidenceConflict.service';
import type { InternalGraphPayload } from './InternalGraphEngine';

export type InternalReasoningDependencyState = 'bound' | 'unbound' | 'conflicted' | 'orphaned';

export interface InternalReasoningDecisionLineage {
  journalId: string;
  title: string;
  decisionKind: string;
  graphVersion: string;
  dependencyState: InternalReasoningDependencyState;
  refCount: number;
  liveRefCount: number;
  orphanedRefCount: number;
  conflictedRefCount: number;
  edgeIds: string[];
  conflictIds: string[];
  relationFamilies: string[];
  oldestEvidenceAt: string | null;
  newestEvidenceAt: string | null;
  reasons: string[];
}

export interface InternalConflictBlastRadius {
  conflictId: string;
  reviewPriority: number;
  edgeIds: [string, string];
  impactedJournalIds: string[];
  impactedDecisionKinds: string[];
  impactedCount: number;
}

export interface InternalReasoningLineageReport {
  generatedAt: string;
  graphVersion: string;
  openDecisionCount: number;
  boundDecisionCount: number;
  conflictedDecisionCount: number;
  orphanedDecisionCount: number;
  unboundDecisionCount: number;
  decisions: InternalReasoningDecisionLineage[];
  conflictBlastRadius: InternalConflictBlastRadius[];
  operatingRule: string;
}

function timestampMin(values: string[]): string | null {
  const valid = values.filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return valid[0] ?? null;
}

function timestampMax(values: string[]): string | null {
  const valid = values.filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0] ?? null;
}

/**
 * Build an explicit analytical provenance graph from recorded decision→edge refs.
 *
 * This engine NEVER infers a dependency. A decision is impacted by a conflict only
 * when one of its stored evidence refs exactly intersects one of the conflict's two
 * edges. Legacy hypotheses with no refs remain unbound rather than guessed into a
 * relationship. Canonical graph evolution may orphan old refs; those are surfaced
 * for review rather than silently dropped.
 */
export function analyzeInternalReasoningLineage(input: {
  graph: InternalGraphPayload;
  journal: InternalDecisionJournalEntry[];
  refs: InternalDecisionEvidenceRef[];
  conflicts: InternalEvidenceConflict[];
}): InternalReasoningLineageReport {
  const openJournal = input.journal.filter((entry) => entry.status === 'open');
  const edgeById = new Map(input.graph.edges.map((edge) => [edge.id, edge] as const));
  const refsByJournal = new Map<string, InternalDecisionEvidenceRef[]>();
  for (const ref of input.refs) {
    const list = refsByJournal.get(ref.journalId) ?? [];
    list.push(ref);
    refsByJournal.set(ref.journalId, list);
  }

  const openConflicts = input.conflicts.filter((conflict) => conflict.status === 'open');
  const conflictsByEdge = new Map<string, InternalEvidenceConflict[]>();
  for (const conflict of openConflicts) {
    for (const edgeId of [conflict.leftEdgeId, conflict.rightEdgeId]) {
      const list = conflictsByEdge.get(edgeId) ?? [];
      list.push(conflict);
      conflictsByEdge.set(edgeId, list);
    }
  }

  const decisions = openJournal.map<InternalReasoningDecisionLineage>((entry) => {
    const refs = refsByJournal.get(entry.id) ?? [];
    const edgeIds = [...new Set(refs.map((ref) => ref.edgeId))].sort();
    const liveEdges = edgeIds.flatMap((edgeId) => {
      const edge = edgeById.get(edgeId);
      return edge ? [edge] : [];
    });
    const orphaned = edgeIds.filter((edgeId) => !edgeById.has(edgeId));
    const conflictIds = [...new Set(edgeIds.flatMap((edgeId) => (conflictsByEdge.get(edgeId) ?? []).map((conflict) => conflict.id)))].sort();
    const conflictedEdgeIds = edgeIds.filter((edgeId) => (conflictsByEdge.get(edgeId)?.length ?? 0) > 0);
    const relationFamilies = [...new Set(liveEdges.map((edge) => edge.relation))].sort();

    const dependencyState: InternalReasoningDependencyState = refs.length === 0
      ? 'unbound'
      : orphaned.length > 0
        ? 'orphaned'
        : conflictIds.length > 0
          ? 'conflicted'
          : 'bound';
    const reasons: string[] = [];
    if (refs.length === 0) reasons.push('No explicit evidence refs are recorded; Beacon will not guess which graph edges this hypothesis depended on.');
    if (orphaned.length > 0) reasons.push(`${orphaned.length} recorded evidence ref${orphaned.length === 1 ? '' : 's'} no longer resolve in the current canonical graph.`);
    if (conflictIds.length > 0) reasons.push(`${conflictIds.length} unresolved operator-confirmed conflict${conflictIds.length === 1 ? '' : 's'} intersect recorded decision evidence.`);
    if (refs.length > 0 && orphaned.length === 0 && conflictIds.length === 0) reasons.push('All recorded decision evidence refs resolve in the current canonical graph with no confirmed conflict intersection.');

    return {
      journalId: entry.id,
      title: entry.title,
      decisionKind: entry.decisionKind,
      graphVersion: entry.graphVersion,
      dependencyState,
      refCount: edgeIds.length,
      liveRefCount: liveEdges.length,
      orphanedRefCount: orphaned.length,
      conflictedRefCount: conflictedEdgeIds.length,
      edgeIds,
      conflictIds,
      relationFamilies,
      oldestEvidenceAt: timestampMin(liveEdges.map((edge) => edge.firstSeenAt)),
      newestEvidenceAt: timestampMax(liveEdges.map((edge) => edge.lastSeenAt)),
      reasons,
    };
  }).sort((left, right) => {
    const rank: Record<InternalReasoningDependencyState, number> = { conflicted: 0, orphaned: 1, unbound: 2, bound: 3 };
    return rank[left.dependencyState] - rank[right.dependencyState] || left.title.localeCompare(right.title);
  });

  const decisionByRefEdge = new Map<string, Set<string>>();
  for (const decision of decisions) {
    for (const edgeId of decision.edgeIds) {
      const set = decisionByRefEdge.get(edgeId) ?? new Set<string>();
      set.add(decision.journalId);
      decisionByRefEdge.set(edgeId, set);
    }
  }
  const journalById = new Map(openJournal.map((entry) => [entry.id, entry] as const));
  const conflictBlastRadius = openConflicts.map<InternalConflictBlastRadius>((conflict) => {
    const impacted = new Set<string>([
      ...(decisionByRefEdge.get(conflict.leftEdgeId) ?? []),
      ...(decisionByRefEdge.get(conflict.rightEdgeId) ?? []),
    ]);
    const impactedJournalIds = [...impacted].sort();
    return {
      conflictId: conflict.id,
      reviewPriority: conflict.reviewPriority,
      edgeIds: [conflict.leftEdgeId, conflict.rightEdgeId],
      impactedJournalIds,
      impactedDecisionKinds: [...new Set(impactedJournalIds.flatMap((journalId) => {
        const entry = journalById.get(journalId);
        return entry ? [entry.decisionKind] : [];
      }))].sort(),
      impactedCount: impactedJournalIds.length,
    };
  }).sort((left, right) => right.impactedCount - left.impactedCount || right.reviewPriority - left.reviewPriority || left.conflictId.localeCompare(right.conflictId));

  return {
    generatedAt: new Date().toISOString(),
    graphVersion: input.graph.graphVersion,
    openDecisionCount: decisions.length,
    boundDecisionCount: decisions.filter((item) => item.dependencyState === 'bound').length,
    conflictedDecisionCount: decisions.filter((item) => item.dependencyState === 'conflicted').length,
    orphanedDecisionCount: decisions.filter((item) => item.dependencyState === 'orphaned').length,
    unboundDecisionCount: decisions.filter((item) => item.dependencyState === 'unbound').length,
    decisions,
    conflictBlastRadius,
    operatingRule: 'Reasoning Lineage uses only explicitly recorded decision→evidence references. It never guesses dependencies, never marks conflicted evidence false, and never converts analytical provenance into a score of people or organizations.',
  };
}
