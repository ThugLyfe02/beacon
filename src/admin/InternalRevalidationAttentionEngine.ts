import type { InternalNextAnalysisAction, InternalNextAnalysisPlan } from './InternalNextBestAnalysisEngine';
import type { InternalReasoningRevalidationObligation } from './internalReasoningRevalidation.service';

function addOrReplace(actions: Map<string, InternalNextAnalysisAction>, action: InternalNextAnalysisAction): void {
  const existing = actions.get(action.id);
  if (!existing || action.priority > existing.priority) actions.set(action.id, action);
}

/**
 * Promote durable artifact-revalidation obligations into Next Best Analysis.
 * Priority is analytical review urgency only. This layer cannot resolve the task,
 * alter the referenced artifact, mutate graph truth, or authorize external action.
 */
export function augmentInternalNextAnalysisWithRevalidation(input: {
  plan: InternalNextAnalysisPlan;
  obligations: InternalReasoningRevalidationObligation[];
  graphManageAvailable: boolean;
}): InternalNextAnalysisPlan {
  if (!input.graphManageAvailable) return input.plan;
  const active = input.obligations.filter((item) => item.status !== 'resolved');
  if (active.length === 0) return input.plan;
  const actions = new Map(input.plan.actions.map((action) => [action.id, action] as const));
  const p5 = active.filter((item) => item.priority === 5).length;
  const p4 = active.filter((item) => item.priority === 4).length;
  const conflicts = active.filter((item) => item.reasonKind === 'evidence_conflict').length;
  const topPriority = Math.max(...active.map((item) => item.priority));
  const oldest = active
    .map((item) => Date.parse(item.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] ?? Date.now();
  const ageDays = Math.max(0, (Date.now() - oldest) / 86_400_000);

  addOrReplace(actions, {
    id: 'reasoning:durable-revalidation',
    title: topPriority >= 4
      ? 'Clear high-priority reasoning revalidation debt before new exploration'
      : 'Review outstanding analytical revalidation obligations',
    category: 'verification',
    priority: Math.min(10, 6.6 + topPriority * 0.65 + Math.min(0.6, ageDays / 30)),
    expectedInformationGain: Math.min(0.58, 0.16 + active.length * 0.025 + (p5 * 0.08) + (p4 * 0.04)),
    destination: 'InternalReasoningRevalidation',
    requiredCapability: 'graph_manage',
    rationale: [
      `${active.length} durable analytical revalidation obligation${active.length === 1 ? '' : 's'} remain active`,
      ...(p5 > 0 ? [`${p5} P5 obligation${p5 === 1 ? '' : 's'} require explicit review`] : []),
      ...(p4 > 0 ? [`${p4} P4 obligation${p4 === 1 ? '' : 's'} remain unresolved`] : []),
      ...(conflicts > 0 ? [`${conflicts} obligation${conflicts === 1 ? '' : 's'} originate from exact evidence-conflict dependencies`] : []),
      ...(ageDays >= 14 ? [`oldest active obligation is ~${Math.round(ageDays)} days old`] : []),
    ],
    operatingConstraint: 'Revalidation priority is review urgency for analytical artifacts. Resolving the task records that review occurred; it never makes the artifact true, changes graph evidence, or authorizes social action.',
  });

  const ranked = [...actions.values()]
    .sort((left, right) => right.priority - left.priority || right.expectedInformationGain - left.expectedInformationGain || left.id.localeCompare(right.id))
    .slice(0, 10);
  return {
    ...input.plan,
    generatedAt: new Date().toISOString(),
    actions: ranked,
    operatingRule: `${input.plan.operatingRule} Durable reasoning-revalidation obligations may preempt generic exploration until an operator records review completion.`,
  };
}
