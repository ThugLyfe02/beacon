import type { InternalGraphEdge, InternalGraphPayload } from './InternalGraphEngine';
import { analyzeInternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';
import type { InternalEvidenceDebtItem } from './InternalEvidenceDebtEngine';
import {
  buildInternalTargetRoutingPortfolio,
  type InternalTargetRoutingPortfolio,
} from './InternalTargetRoutingEngine';
import type { InternalBridgePattern } from './InternalGraphStrategyEngine';

export type InternalInformationScenarioKind = 'confirm' | 'disconfirm';

export interface InternalInformationScenarioDelta {
  kind: InternalInformationScenarioKind;
  healthDelta: number;
  structuralDependenceDelta: number;
  routeCountDelta: number;
  routeDiversityDelta: number;
  sharedBottleneckDelta: number;
  verifiedEdgeRatioDelta: number;
  ambiguousEdgeRatioDelta: number;
  summary: string[];
}

export interface InternalValueOfInformationResult {
  generatedAt: string;
  graphVersion: string;
  debtId: string;
  simulatable: boolean;
  informationValue: number;
  sensitivitySpan: number;
  confirmation: InternalInformationScenarioDelta | null;
  disconfirmation: InternalInformationScenarioDelta | null;
  conclusionSensitivity: string[];
  operatingRule: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function clonePayload(payload: InternalGraphPayload): InternalGraphPayload {
  return {
    ...payload,
    nodes: payload.nodes.map((node) => ({ ...node, attributes: { ...node.attributes } })),
    edges: payload.edges.map((edge) => ({ ...edge, evidence: { ...edge.evidence } })),
  };
}

function confirmEdge(edge: InternalGraphEdge, nowIso: string): InternalGraphEdge {
  return {
    ...edge,
    confidence: 'VERIFIED',
    evidenceCount: Math.max(2, edge.evidenceCount),
    lastSeenAt: nowIso,
    evidence: {
      ...edge.evidence,
      counterfactualScenario: 'confirmed_for_value_of_information',
    },
  };
}

function scenarioPayload(input: {
  payload: InternalGraphPayload;
  debt: InternalEvidenceDebtItem;
  kind: InternalInformationScenarioKind;
  now: number;
}): InternalGraphPayload | null {
  if (input.debt.edgeIds.length === 0) return null;
  const targetEdges = new Set(input.debt.edgeIds);
  const existingCount = input.payload.edges.filter((edge) => targetEdges.has(edge.id)).length;
  if (existingCount === 0) return null;

  const next = clonePayload(input.payload);
  if (input.kind === 'confirm') {
    const nowIso = new Date(input.now).toISOString();
    next.edges = next.edges.map((edge) => targetEdges.has(edge.id) ? confirmEdge(edge, nowIso) : edge);
  } else {
    next.edges = next.edges.filter((edge) => !targetEdges.has(edge.id));
  }
  next.edgeCount = next.edges.length;
  next.graphVersion = `${input.payload.graphVersion}:voi:${input.kind}:${input.debt.id}`;
  return next;
}

function routingFor(input: {
  payload: InternalGraphPayload;
  sourceNodeId?: string | null;
  targetQuery?: string | null;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
}): InternalTargetRoutingPortfolio | null {
  if (!input.sourceNodeId || !input.targetQuery?.trim() || !input.suppressions) return null;
  return buildInternalTargetRoutingPortfolio({
    payload: input.payload,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery.trim(),
    patterns: input.patterns ?? [],
    suppressions: input.suppressions,
    maxHops: 6,
    maxRoutes: 8,
  });
}

function delta(input: {
  baseline: InternalGraphPayload;
  scenario: InternalGraphPayload;
  baselineRouting: InternalTargetRoutingPortfolio | null;
  sourceNodeId?: string | null;
  targetQuery?: string | null;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
  kind: InternalInformationScenarioKind;
  now: number;
}): InternalInformationScenarioDelta {
  const baselineHealth = analyzeInternalGraphEpistemicHealth(input.baseline, input.now);
  const scenarioHealth = analyzeInternalGraphEpistemicHealth(input.scenario, input.now);
  const baselineForensics = analyzeInternalGraphForensics(input.baseline);
  const scenarioForensics = analyzeInternalGraphForensics(input.scenario);
  const scenarioRouting = routingFor({
    payload: input.scenario,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery,
    patterns: input.patterns,
    suppressions: input.suppressions,
  });
  const routeCountDelta = (scenarioRouting?.routes.length ?? 0) - (input.baselineRouting?.routes.length ?? 0);
  const routeDiversityDelta = (scenarioRouting?.routeDiversity ?? 0) - (input.baselineRouting?.routeDiversity ?? 0);
  const sharedBottleneckDelta = (scenarioRouting?.structuralSinglePointNodeIds.length ?? 0)
    - (input.baselineRouting?.structuralSinglePointNodeIds.length ?? 0);
  const healthDelta = scenarioHealth.score - baselineHealth.score;
  const structuralDependenceDelta = scenarioForensics.structuralDependence - baselineForensics.structuralDependence;
  const verifiedEdgeRatioDelta = scenarioHealth.verifiedEdgeRatio - baselineHealth.verifiedEdgeRatio;
  const ambiguousEdgeRatioDelta = scenarioHealth.ambiguousEdgeRatio - baselineHealth.ambiguousEdgeRatio;

  const summary = [
    `epistemic health ${healthDelta >= 0 ? '+' : ''}${Math.round(healthDelta * 100)} points`,
    `structural dependence ${structuralDependenceDelta >= 0 ? '+' : ''}${Math.round(structuralDependenceDelta * 100)} points`,
    ...(input.baselineRouting || scenarioRouting
      ? [
          `route count ${routeCountDelta >= 0 ? '+' : ''}${routeCountDelta}`,
          `route diversity ${routeDiversityDelta >= 0 ? '+' : ''}${Math.round(routeDiversityDelta * 100)} points`,
          `shared bottlenecks ${sharedBottleneckDelta >= 0 ? '+' : ''}${sharedBottleneckDelta}`,
        ]
      : []),
  ];

  return {
    kind: input.kind,
    healthDelta,
    structuralDependenceDelta,
    routeCountDelta,
    routeDiversityDelta,
    sharedBottleneckDelta,
    verifiedEdgeRatioDelta,
    ambiguousEdgeRatioDelta,
    summary,
  };
}

/**
 * Bracket the downstream analytical impact of resolving one evidence obligation.
 * `confirm` and `disconfirm` are explicit counterfactuals, not predictions or writes.
 * The engine does not estimate the probability of either scenario and therefore
 * must not be presented as expected real-world outcome or human-value scoring.
 */
export function simulateInternalValueOfInformation(input: {
  payload: InternalGraphPayload;
  debt: InternalEvidenceDebtItem;
  sourceNodeId?: string | null;
  targetQuery?: string | null;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
  now?: number;
}): InternalValueOfInformationResult {
  const now = input.now ?? Date.now();
  const baselineRouting = routingFor({
    payload: input.payload,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery,
    patterns: input.patterns,
    suppressions: input.suppressions,
  });
  const confirmed = scenarioPayload({ payload: input.payload, debt: input.debt, kind: 'confirm', now });
  const disconfirmed = scenarioPayload({ payload: input.payload, debt: input.debt, kind: 'disconfirm', now });
  if (!confirmed || !disconfirmed) {
    return {
      generatedAt: new Date(now).toISOString(),
      graphVersion: input.payload.graphVersion,
      debtId: input.debt.id,
      simulatable: false,
      informationValue: 0,
      sensitivitySpan: 0,
      confirmation: null,
      disconfirmation: null,
      conclusionSensitivity: [
        'This obligation is contextual or route-structural rather than edge-specific, so Beacon will not invent a hypothetical relationship to simulate it.',
      ],
      operatingRule: 'Value of Information uses non-persistent counterfactual graph states to measure conclusion sensitivity. It never writes evidence, predicts which scenario is true, or instructs external enrichment.',
    };
  }

  const confirmation = delta({
    baseline: input.payload,
    scenario: confirmed,
    baselineRouting,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery,
    patterns: input.patterns,
    suppressions: input.suppressions,
    kind: 'confirm',
    now,
  });
  const disconfirmation = delta({
    baseline: input.payload,
    scenario: disconfirmed,
    baselineRouting,
    sourceNodeId: input.sourceNodeId,
    targetQuery: input.targetQuery,
    patterns: input.patterns,
    suppressions: input.suppressions,
    kind: 'disconfirm',
    now,
  });

  const sensitivityTerms = [
    Math.abs(confirmation.healthDelta - disconfirmation.healthDelta),
    Math.abs(confirmation.structuralDependenceDelta - disconfirmation.structuralDependenceDelta),
    Math.abs(confirmation.routeDiversityDelta - disconfirmation.routeDiversityDelta),
    Math.min(1, Math.abs(confirmation.routeCountDelta - disconfirmation.routeCountDelta) / 4),
    Math.min(1, Math.abs(confirmation.sharedBottleneckDelta - disconfirmation.sharedBottleneckDelta) / 3),
  ];
  const sensitivitySpan = clamp01(sensitivityTerms.reduce((sum, value) => sum + value, 0) / sensitivityTerms.length);
  const informationValue = clamp01(
    sensitivitySpan * 0.7
      + clamp01(input.debt.priority / 10) * 0.18
      + input.debt.expectedAuthorityGain * 0.12,
  );

  const conclusionSensitivity: string[] = [];
  if (confirmation.routeCountDelta !== disconfirmation.routeCountDelta) {
    conclusionSensitivity.push('Target reachability changes depending on whether this evidence is confirmed or removed.');
  }
  if (Math.abs(confirmation.structuralDependenceDelta - disconfirmation.structuralDependenceDelta) >= 0.05) {
    conclusionSensitivity.push('Broker/fragility interpretation is materially sensitive to this evidence obligation.');
  }
  if (Math.abs(confirmation.healthDelta - disconfirmation.healthDelta) >= 0.04) {
    conclusionSensitivity.push('The graph evidence-health conclusion materially changes across the two bracketed scenarios.');
  }
  if (Math.abs(confirmation.routeDiversityDelta - disconfirmation.routeDiversityDelta) >= 0.08) {
    conclusionSensitivity.push('Route independence is materially sensitive to this evidence obligation.');
  }
  if (conclusionSensitivity.length === 0) {
    conclusionSensitivity.push('Resolving this evidence would improve certainty, but the major topology/routing conclusions appear comparatively insensitive to it.');
  }

  return {
    generatedAt: new Date(now).toISOString(),
    graphVersion: input.payload.graphVersion,
    debtId: input.debt.id,
    simulatable: true,
    informationValue,
    sensitivitySpan,
    confirmation,
    disconfirmation,
    conclusionSensitivity,
    operatingRule: 'Value of Information brackets confirm-vs-disconfirm counterfactuals without assigning probabilities. It ranks analytical sensitivity only, never human worth, real-world outcome probability, or permission to act.',
  };
}
