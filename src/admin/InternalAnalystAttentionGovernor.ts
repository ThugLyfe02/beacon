import type { InternalNextAnalysisPlan } from './InternalNextBestAnalysisEngine';
import type { InternalAgentMission } from './InternalGraphStrategyEngine';
import type { InternalWatchtowerTriageResult } from './InternalWatchtowerTriageEngine';
import type { InternalEvidenceDebtReport } from './InternalEvidenceDebtEngine';

export type InternalAttentionSource = 'next_analysis' | 'watchtower' | 'sentinel' | 'evidence_debt';

export interface InternalAttentionThread {
  id: string;
  source: InternalAttentionSource;
  title: string;
  priority: number;
  preemptive: boolean;
  destination: string | null;
  rationale: string[];
}

export interface InternalAttentionBudget {
  generatedAt: string;
  primary: InternalAttentionThread | null;
  supporting: InternalAttentionThread[];
  later: InternalAttentionThread[];
  suppressedCount: number;
  operatingRule: string;
}

function addThread(map: Map<string, InternalAttentionThread>, thread: InternalAttentionThread): void {
  const key = thread.destination ? `${thread.destination}:${thread.source}` : thread.id;
  const existing = map.get(key);
  if (!existing || thread.priority > existing.priority) map.set(key, thread);
}

/**
 * Limits simultaneous cognitive load to one primary analytical thread plus two
 * supporting threads. This is a presentation policy only: it never removes graph
 * evidence, changes mission truth, ranks human worth, or executes any action.
 */
export function buildInternalAnalystAttentionBudget(input: {
  nextAnalysis: InternalNextAnalysisPlan;
  watchtowerTriage?: InternalWatchtowerTriageResult | null;
  evidenceDebt: InternalEvidenceDebtReport;
  missions: InternalAgentMission[];
}): InternalAttentionBudget {
  const threads = new Map<string, InternalAttentionThread>();

  for (const action of input.nextAnalysis.actions.slice(0, 8)) {
    addThread(threads, {
      id: `next:${action.id}`,
      source: 'next_analysis',
      title: action.title,
      priority: action.priority,
      preemptive: false,
      destination: action.destination,
      rationale: action.rationale.slice(0, 4),
    });
  }

  for (const incident of input.watchtowerTriage?.incidents ?? []) {
    if (incident.openEventCount <= 0) continue;
    const preemptive = incident.severity === 'critical';
    addThread(threads, {
      id: `incident:${incident.id}`,
      source: 'watchtower',
      title: incident.title,
      priority: (preemptive ? 12 : incident.severity === 'high' ? 9.2 : 6.4),
      preemptive,
      destination: incident.recommendedReviewSurface,
      rationale: [incident.summary, ...incident.reasons.slice(0, 3)],
    });
  }

  for (const mission of input.missions.filter((item) => item.agent === 'Sentinel').slice(0, 4)) {
    const epistemicPreemption = /degraded|fragile|block|safety|evidence/i.test(`${mission.title} ${mission.thesis}`);
    addThread(threads, {
      id: `sentinel:${mission.id}`,
      source: 'sentinel',
      title: mission.title,
      priority: Math.max(7.5, mission.priority + (epistemicPreemption ? 2.2 : 0)),
      preemptive: epistemicPreemption,
      destination: 'InternalEvidenceDebt',
      rationale: [mission.thesis, ...mission.evidence.slice(0, 3)],
    });
  }

  for (const debt of input.evidenceDebt.items.filter((item) => item.priority >= 8).slice(0, 4)) {
    addThread(threads, {
      id: `debt:${debt.id}`,
      source: 'evidence_debt',
      title: debt.title,
      priority: debt.priority,
      preemptive: debt.kind === 'critical_bridge_weakness',
      destination: debt.recommendedSurface,
      rationale: [debt.summary, ...debt.reasons.slice(0, 3)],
    });
  }

  const ranked = [...threads.values()].sort((left, right) =>
    Number(right.preemptive) - Number(left.preemptive)
    || right.priority - left.priority
    || left.id.localeCompare(right.id));

  const primary = ranked[0] ?? null;
  const supporting = ranked.slice(1, 3);
  const later = ranked.slice(3, 10);

  return {
    generatedAt: new Date().toISOString(),
    primary,
    supporting,
    later,
    suppressedCount: Math.max(0, ranked.length - 10),
    operatingRule: 'Attention Governor permits one primary analytical thread and at most two supporting threads. Critical evidence/safety conditions may preempt; novelty, popularity, and human-value inference never do.',
  };
}
