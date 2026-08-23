import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';
import type { RecommendationReliability } from './VenueRecommendationReliability';
import type { ZoneEnvelopeAssessment } from './VenueOperatingEnvelope';
import type { VenueConfidenceAssessment } from './VenueConfidencePolicy';
import type { InterventionGuardDecision } from './VenueInterventionGuard';

export type OperatorDecisionClass = 'observe' | 'review' | 'actionable' | 'blocked';

export interface VenueOperationsDecision {
  commandId: string;
  decisionClass: OperatorDecisionClass;
  publishToOperator: boolean;
  allowAction: boolean;
  rationale: string[];
  confidence: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Final policy seam before an organizer-facing command becomes actionable.
 * This keeps recommendation generation separate from operational permission.
 */
export function evaluateVenueOperationsDecision(input: {
  command: OrganizerCommand;
  guard: InterventionGuardDecision;
  reliability?: RecommendationReliability;
  envelopeAssessments: ZoneEnvelopeAssessment[];
  freshness: VenueConfidenceAssessment[];
}): VenueOperationsDecision {
  const rationale: string[] = [];
  const relevantEnvelopes = input.envelopeAssessments.filter((item) => input.command.targetZoneIds.includes(item.zoneId));
  const relevantFreshness = input.freshness;
  const stale = relevantFreshness.some((item) => item.stale);
  const outsideEnvelope = relevantEnvelopes.some((item) => item.state === 'outside-envelope');
  const strained = relevantEnvelopes.some((item) => item.state === 'strained');
  const reliability = input.reliability;

  if (!input.guard.allowed) rationale.push(...input.guard.reasons);
  if (stale) rationale.push('One or more supporting spatial observations are stale.');
  if (outsideEnvelope) rationale.push('At least one target zone is outside its configured operating envelope.');
  else if (strained) rationale.push('At least one target zone is operating under strain.');
  if (reliability?.status === 'weak') rationale.push('Historical measured outcomes for this command class are weak.');
  if (reliability?.status === 'reliable') rationale.push('Historical measured outcomes support this command class.');

  const confidence = clamp01(
    input.command.confidence
      * (stale ? 0.55 : 1)
      * (reliability ? 0.7 + reliability.reliability * 0.3 : 0.85),
  );

  if (!input.guard.allowed || stale) {
    return {
      commandId: input.command.id,
      decisionClass: 'blocked',
      publishToOperator: true,
      allowAction: false,
      rationale,
      confidence,
    };
  }

  if (confidence < 0.55 || reliability?.status === 'weak') {
    rationale.push('The command is visible for operator review but does not clear the action threshold.');
    return {
      commandId: input.command.id,
      decisionClass: 'review',
      publishToOperator: true,
      allowAction: false,
      rationale,
      confidence,
    };
  }

  if (outsideEnvelope || strained || reliability?.status === 'reliable') {
    rationale.push('The command clears confidence, freshness, and operational guardrails.');
    return {
      commandId: input.command.id,
      decisionClass: 'actionable',
      publishToOperator: true,
      allowAction: true,
      rationale,
      confidence,
    };
  }

  rationale.push('The venue remains within its operating envelope; continued observation is preferred.');
  return {
    commandId: input.command.id,
    decisionClass: 'observe',
    publishToOperator: false,
    allowAction: false,
    rationale,
    confidence,
  };
}
