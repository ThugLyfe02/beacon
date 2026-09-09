import type { InternalDecisionCalibrationReport } from './InternalDecisionCalibrationEngine';
import type { InternalEvidenceDebtReport } from './InternalEvidenceDebtEngine';
import type { InternalAgenticTimelineReport } from './InternalAgenticTimelineEngine';
import type { InternalTargetRoutingPortfolio } from './InternalTargetRoutingEngine';
import type { InternalAnalyticalRetrospectiveReport } from './InternalAnalyticalRetrospectiveEngine';

export type InternalMethodDebtKind =
  | 'historical_overconfidence'
  | 'temporal_blindness'
  | 'verification_discipline'
  | 'route_independence'
  | 'escalation_discipline'
  | 'retrospective_failure_signature';

export interface InternalMethodDebtItem {
  id: string;
  kind: InternalMethodDebtKind;
  title: string;
  priority: number;
  maturity: 'nascent' | 'emerging' | 'maturing' | 'established';
  reasons: string[];
  remediation: string[];
  recommendedSurface:
    | 'InternalDecisionCalibration'
    | 'InternalDecisionRetrospective'
    | 'InternalAgenticTimeline'
    | 'InternalEvidenceDebt'
    | 'InternalTargetRouting'
    | 'InternalDecisionJournal';
}

export interface InternalMethodDebtReport {
  generatedAt: string;
  items: InternalMethodDebtItem[];
  topPriority: number;
  operatingRule: string;
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function calibrationOverconfidence(
  report: InternalDecisionCalibrationReport,
): InternalMethodDebtItem[] {
  return report.byDecisionKind
    .filter((bucket) => bucket.resolvedCount >= 3 && bucket.calibrationGap >= 0.12)
    .map((bucket) => ({
      id: `calibration:${bucket.key}`,
      kind: 'historical_overconfidence' as const,
      title: `Historical overconfidence in ${bucket.label}`,
      priority: clampPriority(5.4 + bucket.calibrationGap * 12 + Math.min(1.4, bucket.resolvedCount / 20)),
      maturity: bucket.maturity,
      reasons: [
        `${bucket.resolvedCount} resolved falsifiable hypotheses in this method class`,
        `admission authority exceeded later evidence support by ${Math.round(bucket.calibrationGap * 100)} points`,
        `conservative posterior support floor ${Math.round(bucket.conservativeSupportFloor * 100)}%`,
      ],
      remediation: [
        'Review invalidated/weakened hypotheses before sealing a new decision of this class.',
        'Use current evidence debt and temporal coherence as explicit disconfirming checks.',
        'Do not compensate for past overconfidence by lowering person/entity scores; calibrate the analytical method only.',
      ],
      recommendedSurface: 'InternalDecisionCalibration' as const,
    }));
}

/**
 * Method Debt describes repeated weaknesses in Beacon/operator analytical process.
 * It never scores a person/entity and never modifies canonical graph truth. Current
 * evidence remains authoritative; method history only decides what analysis should
 * receive more scrutiny next.
 */
export function analyzeInternalMethodDebt(input: {
  calibration: InternalDecisionCalibrationReport;
  evidenceDebt: InternalEvidenceDebtReport;
  timeline: InternalAgenticTimelineReport;
  routingPortfolio?: InternalTargetRoutingPortfolio | null;
  retrospectives?: InternalAnalyticalRetrospectiveReport | null;
}): InternalMethodDebtReport {
  const items: InternalMethodDebtItem[] = [...calibrationOverconfidence(input.calibration)];
  const routingCalibration = input.calibration.byDecisionKind.find((item) => item.key === 'target_route_review');
  const interventionCalibration = input.calibration.byDecisionKind.find((item) => item.key === 'intervention_review');
  const routing = input.routingPortfolio ?? null;

  for (const signature of input.retrospectives?.strongestAssociations ?? []) {
    if (signature.sampleSize < 3 || signature.maturity === 'nascent' || signature.priority < 6) continue;
    items.push({
      id: `retrospective:${signature.key}`,
      kind: 'retrospective_failure_signature',
      title: `Retrospective method signal: ${signature.label}`,
      priority: clampPriority(signature.priority + signature.conservativeAdverseFloor * 0.9),
      maturity: signature.maturity,
      reasons: [
        ...signature.reasons.slice(0, 4),
        'This condition repeatedly co-occurred with later weakened/invalidated hypotheses and deserves explicit scrutiny before similar decisions.',
      ],
      remediation: [
        'Review the retrospective sample and its disconfirming evidence before a similar decision class advances.',
        'Use the recommended evidence surface to test whether the same condition is present now.',
      ],
      recommendedSurface: 'InternalDecisionRetrospective',
    });
  }

  if (
    input.timeline.chronologyGapCount > 0
    && ((routingCalibration?.calibrationGap ?? 0) >= 0.08 || (interventionCalibration?.calibrationGap ?? 0) >= 0.08)
  ) {
    items.push({
      id: 'method:temporal-blindness',
      kind: 'temporal_blindness',
      title: 'Temporal coherence deserves mandatory review before escalation',
      priority: clampPriority(7.4 + Math.min(1.8, input.timeline.chronologyGapCount / 4)),
      maturity: routingCalibration?.maturity ?? interventionCalibration?.maturity ?? 'nascent',
      reasons: [
        `${input.timeline.chronologyGapCount} retained relationship progression${input.timeline.chronologyGapCount === 1 ? '' : 's'} contain observation-order gaps`,
        'routing/intervention method history shows at least mild overconfidence',
        'historical structural connectivity can otherwise be mistaken for contemporaneous support',
      ],
      remediation: [
        'Open Agentic Timeline before route/intervention review.',
        'Record historical-only interpretations explicitly when no shared observation window exists.',
      ],
      recommendedSurface: 'InternalAgenticTimeline',
    });
  }

  const criticalVerificationDebt = input.evidenceDebt.items.filter((item) =>
    item.kind === 'critical_bridge_weakness'
    || item.kind === 'ambiguous_evidence'
    || item.kind === 'derived_critical_evidence'
    || item.kind === 'operator_confirmed_conflict');
  if (criticalVerificationDebt.length >= 2) {
    const conflictCount = criticalVerificationDebt.filter((item) => item.kind === 'operator_confirmed_conflict').length;
    items.push({
      id: 'method:verification-discipline',
      kind: 'verification_discipline',
      title: conflictCount > 0
        ? 'Critical conclusions repeatedly accumulate weak or conflicting evidence'
        : 'Critical conclusions are repeatedly leaning on weak evidence',
      priority: clampPriority(
        7
        + criticalVerificationDebt.slice(0, 6).reduce((sum, item) => sum + item.expectedAuthorityGain, 0) * 8
        + Math.min(1, conflictCount * 0.25),
      ),
      maturity: conflictCount >= 3 ? 'maturing' : 'emerging',
      reasons: [
        `${criticalVerificationDebt.length} high-leverage verification/reconciliation obligations remain in the current graph`,
        ...(conflictCount > 0 ? [`${conflictCount} operator-confirmed evidence conflict${conflictCount === 1 ? '' : 's'} remain unresolved`] : []),
        'weak or unresolved evidence sits on structures that influence several downstream conclusions',
      ],
      remediation: [
        'Clear critical Evidence Debt before adding new exploratory breadth.',
        ...(conflictCount > 0 ? ['Reconcile operator-confirmed conflicts without deleting either source edge or forcing a synthetic winner.'] : []),
        'Prefer verified/repeated first-party evidence to additional external context.',
      ],
      recommendedSurface: 'InternalEvidenceDebt',
    });
  }

  if (routing && routing.routes.length > 1 && (routing.routeDiversity < 0.42 || routing.structuralSinglePointNodeIds.length > 0)) {
    const priority = clampPriority(
      6.8
      + (1 - routing.routeDiversity) * 1.8
      + Math.min(1.2, routing.structuralSinglePointNodeIds.length * 0.35)
      + Math.max(0, (routingCalibration?.calibrationGap ?? 0)) * 5,
    );
    items.push({
      id: 'method:route-independence',
      kind: 'route_independence',
      title: 'Route plurality is not yet route independence',
      priority,
      maturity: routingCalibration?.maturity ?? 'nascent',
      reasons: [
        `route diversity ${Math.round(routing.routeDiversity * 100)}%`,
        `${routing.structuralSinglePointNodeIds.length} shared bottleneck${routing.structuralSinglePointNodeIds.length === 1 ? '' : 's'}`,
        ...(routingCalibration && routingCalibration.resolvedCount >= 3
          ? [`routing calibration gap ${Math.round(routingCalibration.calibrationGap * 100)} points across ${routingCalibration.resolvedCount} resolved hypotheses`]
          : []),
      ],
      remediation: [
        'Seek structurally independent routes before interpreting multiple paths as redundancy.',
        'If independence is unavailable, preserve the single-point dependency explicitly in the hypothesis.',
      ],
      recommendedSurface: 'InternalTargetRouting',
    });
  }

  const remediationBuckets = input.calibration.byAdmissionState.filter((bucket) =>
    bucket.key === 'evidence_remediation_required' && bucket.resolvedCount >= 3 && bucket.calibrationGap > 0.08);
  if (remediationBuckets.length > 0) {
    const bucket = remediationBuckets[0]!;
    items.push({
      id: 'method:escalation-discipline',
      kind: 'escalation_discipline',
      title: 'Evidence-remediation states have historically been treated too aggressively',
      priority: clampPriority(6.4 + bucket.calibrationGap * 10),
      maturity: bucket.maturity,
      reasons: [
        `${bucket.resolvedCount} resolved hypotheses began in evidence-remediation-required state`,
        `historical authority exceeded later support by ${Math.round(bucket.calibrationGap * 100)} points`,
      ],
      remediation: [
        'Treat remediation-required as an investigation state, not a near-approval state.',
        'Seal the next hypothesis with an explicit evidence obligation before escalation.',
      ],
      recommendedSurface: 'InternalDecisionJournal',
    });
  }

  items.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return {
    generatedAt: new Date().toISOString(),
    items: items.slice(0, 20),
    topPriority: items[0]?.priority ?? 0,
    operatingRule: 'Method Debt ranks weaknesses in analytical process, calibration, retrospective decision conditions, and unresolved evidence-reconciliation discipline—never people or organizations. It changes what deserves scrutiny next, not canonical evidence or social authority.',
  };
}
