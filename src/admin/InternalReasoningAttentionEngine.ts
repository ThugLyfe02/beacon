import type {
  InternalNextAnalysisAction,
  InternalNextAnalysisPlan,
} from './InternalNextBestAnalysisEngine';
import type { InternalReasoningLineageReport } from './InternalReasoningLineageEngine';

function addOrReplace(actions: Map<string, InternalNextAnalysisAction>, action: InternalNextAnalysisAction): void {
  const existing = actions.get(action.id);
  if (!existing || action.priority > existing.priority) actions.set(action.id, action);
}

/**
 * Add explicit analytical-provenance remediation to an existing Next Best Analysis
 * plan. This layer does not alter canonical graph truth or infer missing decision
 * dependencies; it only prioritizes review of lineage state already recorded.
 */
export function augmentInternalNextAnalysisWithReasoningLineage(input: {
  plan: InternalNextAnalysisPlan;
  lineage: InternalReasoningLineageReport;
  graphManageAvailable: boolean;
}): InternalNextAnalysisPlan {
  if (!input.graphManageAvailable) return input.plan;
  const actions = new Map(input.plan.actions.map((action) => [action.id, action] as const));

  if (input.lineage.conflictedDecisionCount > 0) {
    addOrReplace(actions, {
      id: 'reasoning:conflicted-decisions',
      title: 'Reconcile evidence conflicts that intersect active hypotheses',
      category: 'verification',
      priority: 9.7,
      expectedInformationGain: Math.min(0.52, 0.18 + input.lineage.conflictedDecisionCount * 0.07),
      destination: 'InternalReasoningLineage' as never,
      requiredCapability: 'graph_manage',
      rationale: [
        `${input.lineage.conflictedDecisionCount} open hypothesis${input.lineage.conflictedDecisionCount === 1 ? '' : 'es'} have exact evidence refs intersecting unresolved conflicts`,
        'these are dependency-specific revalidation obligations, not broad distrust of the event graph',
      ],
      operatingConstraint: 'Conflict intersection means revalidate recorded analytical dependencies. It never means either evidence edge or the hypothesis is automatically false.',
    });
  }

  if (input.lineage.orphanedDecisionCount > 0) {
    addOrReplace(actions, {
      id: 'reasoning:orphaned-refs',
      title: 'Repair decision evidence refs orphaned by canonical graph evolution',
      category: 'memory',
      priority: 8.8,
      expectedInformationGain: Math.min(0.4, 0.14 + input.lineage.orphanedDecisionCount * 0.06),
      destination: 'InternalReasoningLineage' as never,
      requiredCapability: 'graph_manage',
      rationale: [
        `${input.lineage.orphanedDecisionCount} open hypothesis${input.lineage.orphanedDecisionCount === 1 ? '' : 'es'} retain edge refs that no longer resolve in the current canonical graph`,
        'the provenance chain must be repaired or explicitly retired before the old analytical baseline is treated as current',
      ],
      operatingConstraint: 'Orphaned refs are analytical-memory debt. Beacon must not silently remap them to new edges.',
    });
  }

  if (input.lineage.unboundDecisionCount > 0) {
    addOrReplace(actions, {
      id: 'reasoning:unbound-legacy',
      title: 'Bind important legacy hypotheses to exact evidence only when support is known',
      category: 'memory',
      priority: 5.9,
      expectedInformationGain: Math.min(0.24, 0.08 + input.lineage.unboundDecisionCount * 0.025),
      destination: 'InternalReasoningLineage' as never,
      requiredCapability: 'graph_manage',
      rationale: [
        `${input.lineage.unboundDecisionCount} open legacy hypothesis${input.lineage.unboundDecisionCount === 1 ? '' : 'es'} have no explicit edge dependencies`,
        'unbound decisions cannot participate in exact conflict blast-radius analysis',
      ],
      operatingConstraint: 'Legacy binding requires explicit operator confirmation and current canonical graph-version compatibility; no dependency may be guessed.',
    });
  }

  const ranked = [...actions.values()]
    .sort((left, right) => right.priority - left.priority || right.expectedInformationGain - left.expectedInformationGain || left.id.localeCompare(right.id))
    .slice(0, 10);
  return {
    ...input.plan,
    generatedAt: new Date().toISOString(),
    actions: ranked,
    operatingRule: `${input.plan.operatingRule} Reasoning-lineage debt may preempt generic exploration only when it is supported by explicit recorded decision→evidence refs.`,
  };
}
