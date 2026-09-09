import type { InternalAdaptiveAgentRun } from './InternalAdaptiveAgentOrchestrator';
import {
  getInternalDecisionCalibrationAdjustment,
  type InternalDecisionCalibrationReport,
} from './InternalDecisionCalibrationEngine';
import { analyzeInternalRouteTemporalCoherence } from './InternalAgenticTimelineEngine';
import type { InternalWatchtowerTriageResult } from './InternalWatchtowerTriageEngine';

export type InternalOperatorDecisionKind =
  | 'analysis_review'
  | 'target_route_review'
  | 'intervention_review'
  | 'restricted_forensics_review'
  | 'portable_export_review';

export type InternalOperatorAdmissionState =
  | 'admitted_to_review'
  | 'review_with_caution'
  | 'evidence_remediation_required'
  | 'capability_required'
  | 'safety_blocked';

export interface InternalOperatorDecisionAdmission {
  kind: InternalOperatorDecisionKind;
  state: InternalOperatorAdmissionState;
  authority: number;
  title: string;
  reasons: string[];
  requiredRemediation: string[];
  operatingRule: string;
}

export interface InternalOperatorDecisionAdmissionSet {
  generatedAt: string;
  admissions: InternalOperatorDecisionAdmission[];
  lowestAuthority: number;
  blockedCount: number;
  remediationCount: number;
  operatingRule: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function baseAuthority(run: InternalAdaptiveAgentRun): number {
  return clamp01(run.epistemicHealth.score * run.confidenceMultiplier);
}

function highUrgencyIncidentCount(triage: InternalWatchtowerTriageResult | null): number {
  return triage?.incidents.filter((incident) =>
    incident.openEventCount > 0 && (incident.severity === 'high' || incident.severity === 'critical')).length ?? 0;
}

function stateForAuthority(authority: number): InternalOperatorAdmissionState {
  if (authority >= 0.75) return 'admitted_to_review';
  if (authority >= 0.56) return 'review_with_caution';
  return 'evidence_remediation_required';
}

function makeAdmission(input: {
  kind: InternalOperatorDecisionKind;
  title: string;
  authority: number;
  reasons: string[];
  remediation: string[];
  forcedState?: InternalOperatorAdmissionState;
}): InternalOperatorDecisionAdmission {
  const authority = clamp01(input.authority);
  const state = input.forcedState ?? stateForAuthority(authority);
  return {
    kind: input.kind,
    state,
    authority,
    title: input.title,
    reasons: input.reasons,
    requiredRemediation: input.remediation,
    operatingRule: 'Admission means eligible for operator review only. It never authorizes outreach, relationship mutation, restricted disclosure, export sharing, or any other external action.',
  };
}

/**
 * Evidence/capability admission policy for operator review surfaces.
 *
 * Inputs may only reduce analytical authority. This engine cannot grant a server
 * capability, override a block/suppression boundary, or execute an intervention.
 * Historical calibration and temporal coherence are conservative modifiers only:
 * neither can create authority that current evidence does not already support.
 */
export function evaluateInternalOperatorDecisionAdmission(input: {
  adaptiveRun: InternalAdaptiveAgentRun;
  watchtowerTriage?: InternalWatchtowerTriageResult | null;
  decisionCalibration?: InternalDecisionCalibrationReport | null;
  suppressionsEstablished: boolean;
  capabilities: {
    manage: boolean;
    restricted: boolean;
    export: boolean;
  };
}): InternalOperatorDecisionAdmissionSet {
  const run = input.adaptiveRun;
  const health = run.epistemicHealth;
  const base = baseAuthority(run);
  const highUrgency = highUrgencyIncidentCount(input.watchtowerTriage ?? null);
  const incidentPenalty = Math.min(0.22, highUrgency * 0.06);
  const healthReasons = [
    `graph epistemic health ${health.band} at ${Math.round(health.score * 100)}%`,
    `adaptive confidence multiplier ${run.confidenceMultiplier.toFixed(2)}`,
    ...(highUrgency > 0 ? [`${highUrgency} open high/critical Watchtower incident${highUrgency === 1 ? '' : 's'} reduce review authority`] : []),
  ];
  const healthRemediation = [
    ...(health.band === 'fragile' || health.band === 'degraded'
      ? ['Improve stale/ambiguous/repeated evidence until graph health returns to usable or strong.']
      : []),
    ...(highUrgency > 0 ? ['Review high/critical Watchtower incidents and their evidence surfaces before escalating decisions.'] : []),
  ];

  const calibrationFor = (kind: InternalOperatorDecisionKind) =>
    getInternalDecisionCalibrationAdjustment(input.decisionCalibration ?? null, kind);
  const admissions: InternalOperatorDecisionAdmission[] = [];

  const analysisCalibration = calibrationFor('analysis_review');
  admissions.push(makeAdmission({
    kind: 'analysis_review',
    title: 'General graph analysis',
    authority: Math.max(0.42, base - incidentPenalty * 0.45 - analysisCalibration.penalty),
    reasons: [
      ...healthReasons,
      ...analysisCalibration.reasons,
      'analysis remains available even when evidence is weak so operators can investigate why',
    ],
    remediation: healthRemediation,
    forcedState: health.band === 'degraded' ? 'review_with_caution' : undefined,
  }));

  const route = run.routingPortfolio?.routes[0] ?? null;
  const temporal = route ? analyzeInternalRouteTemporalCoherence(route) : null;
  const routeCalibration = calibrationFor('target_route_review');
  const rawRouteAuthority = route
    ? clamp01(
        base * 0.52
        + route.evidenceQuality * 0.18
        + route.verifiedEdgeRatio * 0.12
        + route.freshness * 0.08
        + run.routingPortfolio!.routeDiversity * 0.1
        - Math.min(0.18, route.articulationExposure * 0.05 + route.graphBridgeExposure * 0.04)
        - incidentPenalty,
      )
    : 0;
  const temporalMultiplier = temporal ? 0.82 + temporal.overlapScore * 0.18 : 1;
  const routeAuthority = clamp01(rawRouteAuthority * temporalMultiplier - routeCalibration.penalty);
  const routeSafetyBlocked = !input.suppressionsEstablished;
  admissions.push(makeAdmission({
    kind: 'target_route_review',
    title: 'Target-route review',
    authority: routeAuthority,
    reasons: route
      ? [
          ...healthReasons,
          ...routeCalibration.reasons,
          `${Math.round(route.verifiedEdgeRatio * 100)}% verified route edges; confidence floor ${route.confidenceFloor.toLowerCase()}`,
          `${Math.round(run.routingPortfolio!.routeDiversity * 100)}% route diversity across ${run.routingPortfolio!.routes.length} selected alternatives`,
          `${run.routingPortfolio!.structuralSinglePointNodeIds.length} shared structural bottleneck${run.routingPortfolio!.structuralSinglePointNodeIds.length === 1 ? '' : 's'}`,
          ...(temporal ? [`temporal coherence ${Math.round(temporal.overlapScore * 100)}%; ${temporal.hasSharedObservationWindow ? 'route edges share a retained observation window' : `no shared retained window, nearest aggregate gap ~${Math.round(temporal.nearestGapDays)} days`}`] : []),
        ]
      : [...healthReasons, ...routeCalibration.reasons, 'no target-route portfolio is currently available'],
    remediation: [
      ...healthRemediation,
      ...(!route ? ['Specify a target ecosystem and produce at least one block-safe evidence route.'] : []),
      ...(route?.confidenceFloor === 'AMBIGUOUS' ? ['Replace or manually validate ambiguous route evidence before escalation.'] : []),
      ...(run.routingPortfolio && run.routingPortfolio.routeDiversity < 0.25 ? ['Seek an independent route so the conclusion is not dominated by one evidence chain.'] : []),
      ...(temporal && !temporal.hasSharedObservationWindow ? ['Review Agentic Timeline before treating this structural route as contemporaneously supported.'] : []),
      ...(!input.suppressionsEstablished ? ['Re-establish authoritative block/suppression truth before any route can enter review.'] : []),
    ],
    forcedState: routeSafetyBlocked ? 'safety_blocked' : undefined,
  }));

  const interventionCalibration = calibrationFor('intervention_review');
  const temporalPenalty = temporal && !temporal.hasSharedObservationWindow
    ? Math.min(0.12, 0.04 + temporal.nearestGapDays / 3650)
    : 0;
  const interventionAuthority = clamp01(
    Math.min(base, route ? routeAuthority : base * 0.72)
    - incidentPenalty
    - interventionCalibration.penalty
    - temporalPenalty
    - (health.band === 'fragile' ? 0.12 : health.band === 'degraded' ? 0.25 : 0),
  );
  admissions.push(makeAdmission({
    kind: 'intervention_review',
    title: 'Human-mediated intervention review',
    authority: interventionAuthority,
    reasons: [
      ...healthReasons,
      ...interventionCalibration.reasons,
      'intervention review is intentionally stricter than analysis or route inspection',
      ...(route ? [`best available route confidence floor is ${route.confidenceFloor.toLowerCase()}`] : ['no target route is required for non-routing interventions']),
      ...(temporal && !temporal.hasSharedObservationWindow ? ['route-dependent evidence does not share one retained observation window, reducing point-in-time authority'] : []),
    ],
    remediation: [
      ...healthRemediation,
      ...(route?.confidenceFloor === 'AMBIGUOUS' ? ['Do not elevate a route-dependent intervention until ambiguous evidence is resolved.'] : []),
      ...(temporal && !temporal.hasSharedObservationWindow ? ['Resolve temporal-coherence debt or explicitly record a historical-only route interpretation before intervention review.'] : []),
      ...(!input.suppressionsEstablished ? ['Re-establish authoritative suppression truth.'] : []),
    ],
    forcedState: !input.suppressionsEstablished
      ? 'safety_blocked'
      : !input.capabilities.manage
        ? 'capability_required'
        : health.band === 'degraded'
          ? 'evidence_remediation_required'
          : undefined,
  }));

  const restrictedCalibration = calibrationFor('restricted_forensics_review');
  admissions.push(makeAdmission({
    kind: 'restricted_forensics_review',
    title: 'Restricted-forensics review',
    authority: clamp01(base - incidentPenalty * 0.4 - restrictedCalibration.penalty),
    reasons: [
      ...healthReasons,
      ...restrictedCalibration.reasons,
      input.capabilities.restricted ? 'exact restricted capability is currently active' : 'restricted capability is not active',
    ],
    remediation: input.capabilities.restricted
      ? healthRemediation
      : ['Obtain an authorized standing or service-issued time-bounded graph_restricted capability before restricted evidence can be reviewed.'],
    forcedState: input.capabilities.restricted ? undefined : 'capability_required',
  }));

  const exportCalibration = calibrationFor('portable_export_review');
  admissions.push(makeAdmission({
    kind: 'portable_export_review',
    title: 'Portable graph export review',
    authority: clamp01(base - incidentPenalty * 0.25 - exportCalibration.penalty),
    reasons: [
      ...healthReasons,
      ...exportCalibration.reasons,
      input.capabilities.export ? 'exact graph_export capability is currently active' : 'graph_export capability is not active',
      'portable export remains pseudonymous-by-default and requires a server receipt before sharing',
    ],
    remediation: input.capabilities.export
      ? healthRemediation
      : ['Obtain an authorized standing or service-issued time-bounded graph_export capability before export review.'],
    forcedState: input.capabilities.export ? undefined : 'capability_required',
  }));

  return {
    generatedAt: new Date().toISOString(),
    admissions,
    lowestAuthority: admissions.reduce((minimum, admission) => Math.min(minimum, admission.authority), 1),
    blockedCount: admissions.filter((admission) => admission.state === 'safety_blocked' || admission.state === 'capability_required').length,
    remediationCount: admissions.filter((admission) => admission.state === 'evidence_remediation_required').length,
    operatingRule: 'Decision admission governs whether evidence may enter operator review. Current evidence sets the ceiling; historical calibration and temporal coherence may only reduce authority. Admission cannot grant capabilities, override blocks, or execute actions.',
  };
}
