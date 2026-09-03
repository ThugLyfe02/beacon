export type VenueErrorBudgetState = 'healthy' | 'watch' | 'exhausted';

export interface VenueServiceSample {
  observedAt: number;
  availability: number;
  freshness: number;
  recommendationLatency: number;
  controlHeadroom: number;
  objectiveScore: number;
}

export interface VenueServiceErrorBudgetInput {
  samples: VenueServiceSample[];
  now?: number;
  fastWindowMs?: number;
  slowWindowMs?: number;
  objectiveFloor?: number;
  allowedBadFraction?: number;
}

export interface VenueServiceErrorBudgetState {
  state: VenueErrorBudgetState;
  fastWindowSampleCount: number;
  slowWindowSampleCount: number;
  fastBadFraction: number;
  slowBadFraction: number;
  fastBurnRate: number;
  slowBurnRate: number;
  remainingBudgetFraction: number;
  authorityMultiplier: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function badFraction(samples: VenueServiceSample[], floor: number): number {
  if (samples.length === 0) return 0;
  const bad = samples.filter((sample) =>
    sample.objectiveScore < floor
    || sample.availability < 0.5
    || sample.freshness < 0.45,
  ).length;
  return bad / samples.length;
}

/**
 * Adds time to Beacon's SLO reasoning. A point-in-time service score can recover
 * immediately after a transient failure even when the control plane has been
 * unreliable for most of the last hour. Error-budget burn keeps recent history
 * visible and reduces recommendation authority when poor service is sustained.
 *
 * This budget governs decision-service authority, not attendee visibility or
 * venue truth. Exhausting it cannot hide people or erase telemetry.
 */
export function evaluateVenueServiceErrorBudget(
  input: VenueServiceErrorBudgetInput,
): VenueServiceErrorBudgetState {
  const now = input.now ?? Date.now();
  const fastWindowMs = Math.max(2 * 60_000, input.fastWindowMs ?? 10 * 60_000);
  const slowWindowMs = Math.max(fastWindowMs, input.slowWindowMs ?? 60 * 60_000);
  const objectiveFloor = clamp01(input.objectiveFloor ?? 0.68);
  const allowedBadFraction = Math.max(0.01, Math.min(0.5, input.allowedBadFraction ?? 0.1));

  const eligible = input.samples
    .filter((sample) => sample.observedAt <= now && now - sample.observedAt <= slowWindowMs)
    .sort((a, b) => a.observedAt - b.observedAt);
  const fast = eligible.filter((sample) => now - sample.observedAt <= fastWindowMs);
  const fastBadFraction = badFraction(fast, objectiveFloor);
  const slowBadFraction = badFraction(eligible, objectiveFloor);
  const fastBurnRate = fastBadFraction / allowedBadFraction;
  const slowBurnRate = slowBadFraction / allowedBadFraction;
  const remainingBudgetFraction = clamp01(1 - slowBadFraction / allowedBadFraction);

  const enoughFastEvidence = fast.length >= 3;
  const enoughSlowEvidence = eligible.length >= 6;
  const reasons: string[] = [];
  let state: VenueErrorBudgetState = 'healthy';

  if (
    (enoughFastEvidence && fastBurnRate >= 2.5)
    || (enoughSlowEvidence && slowBurnRate >= 1.35)
  ) {
    state = 'exhausted';
    if (fastBurnRate >= 2.5) reasons.push('recent venue-operations failures are consuming the service error budget at a fast-burn rate');
    if (slowBurnRate >= 1.35) reasons.push('sustained venue-operations reliability is outside the configured error budget');
  } else if (
    (enoughFastEvidence && fastBurnRate >= 1)
    || (enoughSlowEvidence && slowBurnRate >= 0.7)
  ) {
    state = 'watch';
    reasons.push('venue-operations reliability is consuming enough budget to reduce control authority');
  }

  if (eligible.length === 0) {
    reasons.push('no service-history samples are available; the error budget remains non-authoritative');
  } else if (state === 'healthy' && reasons.length === 0) {
    reasons.push('recent service reliability is inside the configured operating budget');
  }

  const authorityMultiplier = state === 'exhausted'
    ? 0
    : state === 'watch'
      ? clamp01(0.45 + remainingBudgetFraction * 0.35)
      : clamp01(0.85 + remainingBudgetFraction * 0.15);

  return {
    state,
    fastWindowSampleCount: fast.length,
    slowWindowSampleCount: eligible.length,
    fastBadFraction: clamp01(fastBadFraction),
    slowBadFraction: clamp01(slowBadFraction),
    fastBurnRate: Math.max(0, fastBurnRate),
    slowBurnRate: Math.max(0, slowBurnRate),
    remainingBudgetFraction,
    authorityMultiplier,
    reasons,
  };
}
