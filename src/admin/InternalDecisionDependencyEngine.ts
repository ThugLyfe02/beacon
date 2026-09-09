import type { InternalEvidenceConflict } from './internalEvidenceConflict.service';
import type { InternalDecisionEvidenceRef } from './internalDecisionEvidenceRefs.service';

export interface InternalDecisionConflictDependency {
  journalId: string;
  conflictIds: string[];
  conflictedEdgeIds: string[];
  maxReviewPriority: number;
  reasons: string[];
}

export interface InternalDecisionDependencyReport {
  generatedAt: string;
  impactedJournalIds: string[];
  dependencies: InternalDecisionConflictDependency[];
  operatingRule: string;
}

/**
 * Join explicit decision-edge refs to explicit operator-confirmed conflicts.
 *
 * This engine intentionally does nothing for hypotheses without recorded refs.
 * Absence of a dependency reference is not evidence of independence; those older
 * hypotheses remain governed by ordinary graph-version/evidence staleness rules.
 */
export function analyzeInternalDecisionConflictDependencies(input: {
  refs: readonly InternalDecisionEvidenceRef[];
  conflicts: readonly InternalEvidenceConflict[];
}): InternalDecisionDependencyReport {
  const openConflicts = input.conflicts.filter((conflict) => conflict.status === 'open');
  const conflictByEdge = new Map<string, InternalEvidenceConflict[]>();
  for (const conflict of openConflicts) {
    for (const edgeId of [conflict.leftEdgeId, conflict.rightEdgeId]) {
      const bucket = conflictByEdge.get(edgeId) ?? [];
      bucket.push(conflict);
      conflictByEdge.set(edgeId, bucket);
    }
  }

  const byJournal = new Map<string, {
    conflicts: Map<string, InternalEvidenceConflict>;
    edges: Set<string>;
  }>();
  for (const ref of input.refs) {
    const conflicts = conflictByEdge.get(ref.edgeId) ?? [];
    if (conflicts.length === 0) continue;
    const state = byJournal.get(ref.journalId) ?? { conflicts: new Map(), edges: new Set() };
    state.edges.add(ref.edgeId);
    for (const conflict of conflicts) state.conflicts.set(conflict.id, conflict);
    byJournal.set(ref.journalId, state);
  }

  const dependencies: InternalDecisionConflictDependency[] = [...byJournal.entries()].map(([journalId, state]) => {
    const conflicts = [...state.conflicts.values()].sort((a, b) => b.reviewPriority - a.reviewPriority || a.id.localeCompare(b.id));
    return {
      journalId,
      conflictIds: conflicts.map((conflict) => conflict.id),
      conflictedEdgeIds: [...state.edges].sort(),
      maxReviewPriority: conflicts.reduce((maximum, conflict) => Math.max(maximum, conflict.reviewPriority), 0),
      reasons: [
        `${state.edges.size} recorded decision evidence edge${state.edges.size === 1 ? '' : 's'} intersect ${conflicts.length} open operator-confirmed conflict${conflicts.length === 1 ? '' : 's'}`,
        `highest conflict review priority ${conflicts.reduce((maximum, conflict) => Math.max(maximum, conflict.reviewPriority), 0)}/5`,
        'dependency means the hypothesis used conflicted evidence and should be revalidated; it does not mean the hypothesis or either edge is false',
      ],
    };
  }).sort((a, b) => b.maxReviewPriority - a.maxReviewPriority || a.journalId.localeCompare(b.journalId));

  return {
    generatedAt: new Date().toISOString(),
    impactedJournalIds: dependencies.map((item) => item.journalId),
    dependencies,
    operatingRule: 'Decision conflict dependency uses explicit edge references only. It never infers hidden dependencies, declares a hypothesis false, or changes graph truth.',
  };
}
