export interface VenueCloseoutAuditEvent {
  eventType:
    | 'recommendation-admitted'
    | 'operator-decision'
    | 'intervention-applied'
    | 'intervention-observing'
    | 'intervention-measured'
    | 'intervention-reverted'
    | 'command-expired';
}

export interface VenueCloseoutMeasurement {
  effectScore: number;
  confidence: number;
}

export interface VenueEventCloseoutInput {
  eventId: string;
  venueKey: string;
  releaseId?: string | null;
  layoutVersion?: string | null;
  geometryHash?: string | null;
  policyVersion?: string | null;
  modelVersion?: string | null;
  closedAt: number;
  auditEvents: VenueCloseoutAuditEvent[];
  measurements: VenueCloseoutMeasurement[];
  servicePointIds: string[];
}

export interface VenueEventCloseout {
  eventId: string;
  venueKey: string;
  releaseId: string | null;
  layoutVersion: string | null;
  geometryHash: string | null;
  policyVersion: string | null;
  modelVersion: string | null;
  closedAt: number;
  auditEventCount: number;
  operatorDecisionCount: number;
  appliedInterventionCount: number;
  revertedInterventionCount: number;
  measuredInterventionCount: number;
  positiveInterventionCount: number;
  meanMeasuredEffect: number | null;
  positiveRate: number | null;
  meanMeasurementConfidence: number | null;
  servicePointCount: number;
  evidenceCoverage: number;
  summary: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Builds the durable aggregate summary that survives the live event. A closeout
 * does not decide whether the event was "good" or assign a social score. It
 * records how much operational evidence exists, how many interventions were
 * actually measured, and what those measured outcomes showed. A before/after
 * closeout is observational evidence, not causal proof.
 */
export function buildVenueEventCloseout(input: VenueEventCloseoutInput): VenueEventCloseout {
  const operatorDecisionCount = input.auditEvents.filter((item) => item.eventType === 'operator-decision').length;
  const appliedInterventionCount = input.auditEvents.filter((item) => item.eventType === 'intervention-applied').length;
  const revertedInterventionCount = input.auditEvents.filter((item) => item.eventType === 'intervention-reverted').length;
  const measurements = input.measurements
    .filter((item) => Number.isFinite(item.effectScore) && Number.isFinite(item.confidence))
    .map((item) => ({ effectScore: Math.max(-1, Math.min(1, item.effectScore)), confidence: clamp01(item.confidence) }));
  const measuredInterventionCount = measurements.length;
  const positiveInterventionCount = measurements.filter((item) => item.effectScore > 0.08).length;
  const meanMeasuredEffect = measuredInterventionCount === 0
    ? null
    : measurements.reduce((sum, item) => sum + item.effectScore, 0) / measuredInterventionCount;
  const positiveRate = measuredInterventionCount === 0 ? null : positiveInterventionCount / measuredInterventionCount;
  const meanMeasurementConfidence = measuredInterventionCount === 0
    ? null
    : measurements.reduce((sum, item) => sum + item.confidence, 0) / measuredInterventionCount;
  const servicePointCount = new Set(input.servicePointIds.filter(Boolean)).size;

  const evidenceSignals = [
    input.auditEvents.length > 0,
    operatorDecisionCount > 0 || appliedInterventionCount === 0,
    appliedInterventionCount === 0 || measuredInterventionCount > 0,
    input.layoutVersion != null && input.geometryHash != null,
    input.policyVersion != null && input.modelVersion != null,
  ];
  const evidenceCoverage = evidenceSignals.filter(Boolean).length / evidenceSignals.length;

  const summary = measuredInterventionCount === 0
    ? 'Event closed with operational history preserved, but no intervention has enough measured outcome evidence to characterize effect.'
    : `${measuredInterventionCount} measured intervention${measuredInterventionCount === 1 ? '' : 's'} preserved at closeout; ${positiveInterventionCount} showed a positive bounded before/after effect. These measurements remain observational rather than causal proof.`;

  return {
    eventId: input.eventId,
    venueKey: input.venueKey,
    releaseId: input.releaseId ?? null,
    layoutVersion: input.layoutVersion ?? null,
    geometryHash: input.geometryHash ?? null,
    policyVersion: input.policyVersion ?? null,
    modelVersion: input.modelVersion ?? null,
    closedAt: input.closedAt,
    auditEventCount: input.auditEvents.length,
    operatorDecisionCount,
    appliedInterventionCount,
    revertedInterventionCount,
    measuredInterventionCount,
    positiveInterventionCount,
    meanMeasuredEffect,
    positiveRate,
    meanMeasurementConfidence,
    servicePointCount,
    evidenceCoverage: clamp01(evidenceCoverage),
    summary,
  };
}
