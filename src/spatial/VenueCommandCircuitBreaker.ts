export type VenueCircuitBreakerState = 'closed' | 'open' | 'probe';
export type VenueCircuitAuthority = 'normal' | 'review-only' | 'blocked';

export interface VenueCircuitObservation {
  commandId: string;
  observedAt: number;
  outcome: 'positive' | 'neutral' | 'negative' | 'reverted';
  confidence: number;
  effectScore?: number;
}

export interface VenueCommandCircuitBreakerInput {
  commandId: string;
  observations: VenueCircuitObservation[];
  serviceObjectiveScore: number;
  previousState?: VenueCircuitBreakerState;
  openedAt?: number;
  now?: number;
  evaluationWindowMs?: number;
  minimumOpenMs?: number;
}

export interface VenueCommandCircuitBreakerResult {
  commandId: string;
  state: VenueCircuitBreakerState;
  authority: VenueCircuitAuthority;
  evaluatedCount: number;
  highConfidenceCount: number;
  negativeCount: number;
  revertedCount: number;
  positiveCount: number;
  negativeRate: number;
  shouldRecordOpenAt: boolean;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Fast failure containment for one recommendation class. Long-horizon measured
 * reliability answers whether a command is generally useful; this breaker asks a
 * different question: has this command started failing badly enough *right now*
 * that Beacon should stop granting action-ready authority before the historical
 * reliability score has time to move?
 *
 * Opening the breaker blocks only new action-ready authority. It does not hide
 * venue truth, rewrite prior evidence, or automatically undo a physical change.
 */
export function evaluateVenueCommandCircuitBreaker(
  input: VenueCommandCircuitBreakerInput,
): VenueCommandCircuitBreakerResult {
  const now = input.now ?? Date.now();
  const evaluationWindowMs = Math.max(5 * 60_000, input.evaluationWindowMs ?? 30 * 60_000);
  const minimumOpenMs = Math.max(2 * 60_000, input.minimumOpenMs ?? 10 * 60_000);
  const serviceObjectiveScore = clamp01(input.serviceObjectiveScore);

  const recent = input.observations
    .filter((item) => item.commandId === input.commandId)
    .filter((item) => item.observedAt <= now && now - item.observedAt <= evaluationWindowMs)
    .sort((a, b) => b.observedAt - a.observedAt);
  const highConfidence = recent.filter((item) => clamp01(item.confidence) >= 0.62);
  const negativeCount = highConfidence.filter((item) => item.outcome === 'negative').length;
  const revertedCount = highConfidence.filter((item) => item.outcome === 'reverted').length;
  const positiveCount = highConfidence.filter((item) => item.outcome === 'positive').length;
  const negativeRate = highConfidence.length === 0
    ? 0
    : (negativeCount + revertedCount) / highConfidence.length;

  const rapidFailure = highConfidence.length >= 3
    && negativeCount + revertedCount >= 2
    && negativeRate >= 0.6;
  const repeatedReversion = revertedCount >= 2;
  const serviceCollapse = serviceObjectiveScore < 0.38;
  const currentlyOpen = input.previousState === 'open';
  const openAge = input.openedAt === undefined ? 0 : Math.max(0, now - input.openedAt);

  const reasons: string[] = [];
  if (rapidFailure) reasons.push('recent high-confidence outcomes show a concentrated failure pattern');
  if (repeatedReversion) reasons.push('operators reverted this command class repeatedly inside the current evaluation window');
  if (serviceCollapse) reasons.push('venue operations service health is below the circuit-breaker floor');

  let state: VenueCircuitBreakerState = 'closed';
  if (rapidFailure || repeatedReversion || serviceCollapse) {
    state = 'open';
  } else if (currentlyOpen) {
    if (openAge < minimumOpenMs) {
      state = 'open';
      reasons.push('minimum breaker hold period has not elapsed');
    } else {
      state = 'probe';
      reasons.push('hold period elapsed; one explicitly reviewed probe may gather fresh measured evidence');
    }
  } else if (input.previousState === 'probe') {
    const probeEvidence = highConfidence.slice(0, 2);
    const probePositive = probeEvidence.filter((item) => item.outcome === 'positive').length;
    const probeBad = probeEvidence.some((item) => item.outcome === 'negative' || item.outcome === 'reverted');
    if (probeBad) {
      state = 'open';
      reasons.push('probe produced a negative or reverted outcome');
    } else if (probeEvidence.length >= 2 && probePositive === probeEvidence.length) {
      state = 'closed';
      reasons.push('two recent high-confidence positive probe outcomes support closing the breaker');
    } else {
      state = 'probe';
      reasons.push('probe evidence is not yet sufficient to restore normal authority');
    }
  }

  if (state === 'closed' && reasons.length === 0) {
    reasons.push('no recent failure concentration justifies suppressing this command class');
  }

  return {
    commandId: input.commandId,
    state,
    authority: state === 'open' ? 'blocked' : state === 'probe' ? 'review-only' : 'normal',
    evaluatedCount: recent.length,
    highConfidenceCount: highConfidence.length,
    negativeCount,
    revertedCount,
    positiveCount,
    negativeRate: clamp01(negativeRate),
    shouldRecordOpenAt: state === 'open' && input.previousState !== 'open',
    reasons,
  };
}
