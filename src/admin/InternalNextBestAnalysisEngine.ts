import type { InternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';
import type { InternalEvidenceDebtReport, InternalEvidenceDebtSurface } from './InternalEvidenceDebtEngine';
import type { InternalTargetRoutingPortfolio } from './InternalTargetRoutingEngine';
import type { InternalWatchtowerTriageResult } from './InternalWatchtowerTriageEngine';

export type InternalAnalysisCapability = 'graph_read' | 'graph_manage' | 'graph_restricted' | 'graph_export';

export type InternalAnalysisDestination =
  | InternalEvidenceDebtSurface
  | 'InternalEvidenceDebt'
  | 'InternalGraphHealth'
  | 'InternalPatternQueryLab'
  | 'InternalWatchtower'
  | 'InternalMachineRegistry'
  | 'InternalEpochLab'
  | 'InternalHandoffLab';

export interface InternalNextAnalysisAction {
  id: string;
  title: string;
  category: 'incident' | 'verification' | 'routing' | 'epistemic' | 'exploration' | 'memory';
  priority: number;
  expectedInformationGain: number;
  destination: InternalAnalysisDestination;
  requiredCapability: InternalAnalysisCapability;
  rationale: string[];
  operatingConstraint: string;
}

export interface InternalNextAnalysisPlan {
  generatedAt: string;
  actions: InternalNextAnalysisAction[];
  operatingRule: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function capabilityAvailable(
  required: InternalAnalysisCapability,
  capabilities: ReadonlySet<InternalAnalysisCapability>,
): boolean {
  if (required === 'graph_read') {
    return capabilities.has('graph_read')
      || capabilities.has('graph_manage')
      || capabilities.has('graph_restricted')
      || capabilities.has('graph_export');
  }
  return capabilities.has(required);
}

function addUnique(
  map: Map<string, InternalNextAnalysisAction>,
  action: InternalNextAnalysisAction,
): void {
  const key = `${action.destination}:${action.category}`;
  const existing = map.get(key);
  if (!existing || action.priority > existing.priority) map.set(key, action);
}

/**
 * Rank the next analytical move by expected information gain and evidence debt.
 * This engine recommends workbench transitions only. It never ranks people, sends
 * messages, creates introductions, mutates the graph, or authorizes social action.
 */
export function buildInternalNextBestAnalysisPlan(input: {
  epistemicHealth: InternalGraphEpistemicHealth;
  evidenceDebt: InternalEvidenceDebtReport;
  watchtowerTriage?: InternalWatchtowerTriageResult | null;
  routingPortfolio?: InternalTargetRoutingPortfolio | null;
  capabilities: ReadonlySet<InternalAnalysisCapability>;
}): InternalNextAnalysisPlan {
  const actions = new Map<string, InternalNextAnalysisAction>();
  const health = input.epistemicHealth;
  const triage = input.watchtowerTriage ?? null;
  const routing = input.routingPortfolio ?? null;

  for (const incident of triage?.incidents ?? []) {
    if (incident.openEventCount <= 0) continue;
    const severityWeight = incident.severity === 'critical'
      ? 10
      : incident.severity === 'high'
        ? 8.6
        : incident.severity === 'medium'
          ? 6.5
          : 4.8;
    const requiredCapability: InternalAnalysisCapability = incident.recommendedReviewSurface === 'InternalMachineRegistry'
      || incident.recommendedReviewSurface === 'InternalTargetRouting'
      || incident.recommendedReviewSurface === 'InternalWatchtower'
      ? 'graph_manage'
      : 'graph_read';
    if (!capabilityAvailable(requiredCapability, input.capabilities)) continue;
    addUnique(actions, {
      id: `incident:${incident.id}`,
      title: `Review ${incident.family.replaceAll('_', ' ')} incident`,
      category: 'incident',
      priority: severityWeight,
      expectedInformationGain: clamp01(0.12 + incident.score / 80),
      destination: incident.recommendedReviewSurface,
      requiredCapability,
      rationale: [
        `${incident.openEventCount} unacknowledged correlated signal${incident.openEventCount === 1 ? '' : 's'}`,
        ...incident.reasons.slice(0, 3),
      ],
      operatingConstraint: 'Incident severity is review urgency for graph evidence, never a person/entity risk score.',
    });
  }

  for (const debt of input.evidenceDebt.items.slice(0, 8)) {
    const requiredCapability: InternalAnalysisCapability = debt.recommendedSurface === 'InternalEntityResolutionLab'
      || debt.recommendedSurface === 'InternalTargetRouting'
      || debt.recommendedSurface === 'InternalDecisionJournal'
      ? 'graph_manage'
      : 'graph_read';
    if (!capabilityAvailable(requiredCapability, input.capabilities)) continue;
    addUnique(actions, {
      id: `debt:${debt.id}`,
      title: debt.title,
      category: 'verification',
      priority: Math.min(10, debt.priority + debt.expectedAuthorityGain * 4),
      expectedInformationGain: clamp01(debt.expectedAuthorityGain * 1.8 + debt.priority / 40),
      destination: debt.recommendedSurface,
      requiredCapability,
      rationale: [
        debt.summary,
        ...debt.reasons.slice(0, 3),
        `estimated recoverable analytical authority ~${Math.round(debt.expectedAuthorityGain * 100)}%`,
      ],
      operatingConstraint: 'Resolve uncertainty with first-party evidence or explicit caution; do not manufacture certainty through external enrichment.',
    });
  }

  if (health.band === 'degraded' || health.band === 'fragile') {
    addUnique(actions, {
      id: `health:${health.band}`,
      title: health.band === 'degraded' ? 'Repair evidence foundation before escalation' : 'Stabilize fragile evidence before intervention review',
      category: 'epistemic',
      priority: health.band === 'degraded' ? 9.8 : 8.5,
      expectedInformationGain: clamp01(1 - health.score),
      destination: 'InternalEvidenceDebt',
      requiredCapability: 'graph_read',
      rationale: [
        `graph epistemic health is ${health.band} at ${Math.round(health.score * 100)}%`,
        ...health.warnings.slice(0, 4),
      ],
      operatingConstraint: 'Low graph health reduces analytical authority; it never lowers a human score.',
    });
  } else if (health.ambiguousEdgeRatio >= 0.08 || health.staleEdgeRatio >= 0.15) {
    addUnique(actions, {
      id: 'health:evidence-first-lens',
      title: 'Reframe the scene through an evidence-first Perspective',
      category: 'epistemic',
      priority: 6.6,
      expectedInformationGain: clamp01(health.ambiguousEdgeRatio + health.staleEdgeRatio),
      destination: 'InternalPerspectiveLab',
      requiredCapability: 'graph_read',
      rationale: [
        `${Math.round(health.ambiguousEdgeRatio * 100)}% ambiguous edges`,
        `${Math.round(health.staleEdgeRatio * 100)}% stale edges`,
        'a stricter Perspective tests whether conclusions survive removal of weaker evidence',
      ],
      operatingConstraint: 'Perspectives may hide evidence from view but never change canonical truth.',
    });
  }

  if (routing && routing.routes.length > 0) {
    if (routing.structuralSinglePointNodeIds.length > 0 || routing.routeDiversity < 0.42) {
      addUnique(actions, {
        id: 'routing:independence',
        title: 'Test whether target reachability survives route independence',
        category: 'routing',
        priority: 8.1,
        expectedInformationGain: clamp01(0.16 + (1 - routing.routeDiversity) * 0.35),
        destination: 'InternalTargetRouting',
        requiredCapability: 'graph_manage',
        rationale: [
          `route diversity ${Math.round(routing.routeDiversity * 100)}%`,
          `${routing.structuralSinglePointNodeIds.length} shared structural bottleneck${routing.structuralSinglePointNodeIds.length === 1 ? '' : 's'}`,
          'multiple displayed paths can still represent one underlying dependency',
        ],
        operatingConstraint: 'Reachability does not predict consent or authorize an introduction.',
      });
    } else if (routing.routes[0]?.confidenceFloor !== 'VERIFIED') {
      addUnique(actions, {
        id: 'routing:confidence-floor',
        title: 'Inspect the weakest evidence on the leading target route',
        category: 'routing',
        priority: 7.2,
        expectedInformationGain: 0.16,
        destination: 'InternalTransformLab',
        requiredCapability: 'graph_read',
        rationale: [
          `best route confidence floor is ${routing.routes[0]?.confidenceFloor ?? 'unknown'}`,
          'route-level confidence is limited by its weakest evidence edge',
        ],
        operatingConstraint: 'A structurally good route remains only an evidence chain until human review.',
      });
    }
  }

  if (actions.size < 5) {
    addUnique(actions, {
      id: 'explore:pattern-grammar',
      title: 'Ask a structural question with Pattern Grammar',
      category: 'exploration',
      priority: 4.6,
      expectedInformationGain: 0.12,
      destination: 'InternalPatternQueryLab',
      requiredCapability: 'graph_read',
      rationale: [
        'bounded graph-pattern search can reveal repeatable structures without manual pivoting',
        'the grammar cannot execute arbitrary Cypher or perform external enrichment',
      ],
      operatingConstraint: 'Pattern matches are structural evidence views, not predictions or identity enrichment.',
    });
  }

  if (capabilityAvailable('graph_manage', input.capabilities) && health.band === 'strong' && (triage?.openIncidentCount ?? 0) === 0) {
    addUnique(actions, {
      id: 'memory:hypothesis',
      title: 'Seal a falsifiable hypothesis before the graph changes again',
      category: 'memory',
      priority: 5.1,
      expectedInformationGain: 0.1,
      destination: 'InternalDecisionJournal',
      requiredCapability: 'graph_manage',
      rationale: [
        'current evidence health is strong',
        'recording a disconfirming condition now improves later calibration of the analytical method',
      ],
      operatingConstraint: 'Journal conclusions remain operator memory and never become verified graph evidence automatically.',
    });
  }

  const ranked = [...actions.values()]
    .filter((action) => capabilityAvailable(action.requiredCapability, input.capabilities))
    .sort((left, right) => right.priority - left.priority || right.expectedInformationGain - left.expectedInformationGain || left.id.localeCompare(right.id))
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    actions: ranked,
    operatingRule: 'Next Best Analysis ranks evidence workbench transitions by expected information gain. It never recommends social action, scores people, or changes canonical graph truth.',
  };
}
