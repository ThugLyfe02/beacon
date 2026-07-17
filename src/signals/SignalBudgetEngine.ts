export interface SignalBudget {
  eventId: string;
  userId: string;
  limit: number;
  used: number;
  resetsAt?: string | null;
}

export type SignalBudgetState = "available" | "low" | "final" | "exhausted";

export interface SignalBudgetEvaluation {
  remaining: number;
  utilization: number;
  state: SignalBudgetState;
  canSend: boolean;
  advisory: string;
}

export function evaluateSignalBudget(budget: SignalBudget): SignalBudgetEvaluation {
  const safeLimit = Math.max(0, Math.floor(budget.limit));
  const safeUsed = Math.max(0, Math.floor(budget.used));
  const remaining = Math.max(0, safeLimit - safeUsed);
  const utilization = safeLimit === 0 ? 100 : Math.min(100, Math.round((safeUsed / safeLimit) * 100));

  if (remaining === 0) {
    return {
      remaining,
      utilization,
      state: "exhausted",
      canSend: false,
      advisory: "Your high-intent signal budget is complete for this event. Existing mutuals and Office Hours remain available.",
    };
  }

  if (remaining === 1) {
    return {
      remaining,
      utilization,
      state: "final",
      canSend: true,
      advisory: "One high-intent signal remains. Use it where the outcome would materially matter.",
    };
  }

  if (utilization >= 50) {
    return {
      remaining,
      utilization,
      state: "low",
      canSend: true,
      advisory: `${remaining} high-intent signals remain. Beacon is protecting signal quality, not limiting ordinary discovery.`,
    };
  }

  return {
    remaining,
    utilization,
    state: "available",
    canSend: true,
    advisory: `${remaining} high-intent signals are available for this event.`,
  };
}

export interface SignalCandidate {
  targetId: string;
  distanceBucket: 0 | 1 | 2 | 3;
  roleFit: number;
  intentFit: number;
  mutualLikelihood: number;
  targetAvailability: number;
  eventTimePressure: number;
  alreadySignaled: boolean;
  blocked: boolean;
}

export interface SignalRecommendation {
  targetId: string;
  score: number;
  recommended: boolean;
  reason: string;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreSignalCandidate(candidate: SignalCandidate): SignalRecommendation {
  if (candidate.blocked || candidate.alreadySignaled || candidate.distanceBucket === 0) {
    return {
      targetId: candidate.targetId,
      score: 0,
      recommended: false,
      reason: candidate.blocked
        ? "This participant is unavailable."
        : candidate.alreadySignaled
        ? "A signal has already been sent."
        : "The opportunity is outside activation range.",
    };
  }

  const proximityWeight = candidate.distanceBucket === 3 ? 1 : candidate.distanceBucket === 2 ? 0.72 : 0.35;
  const score = Math.round(
    100 *
      (proximityWeight * 0.18 +
        clampUnit(candidate.roleFit) * 0.22 +
        clampUnit(candidate.intentFit) * 0.24 +
        clampUnit(candidate.mutualLikelihood) * 0.16 +
        clampUnit(candidate.targetAvailability) * 0.12 +
        clampUnit(candidate.eventTimePressure) * 0.08)
  );

  const recommended = score >= 68;
  const strongestDimension = [
    { label: "role alignment", value: candidate.roleFit },
    { label: "intent alignment", value: candidate.intentFit },
    { label: "mutual readiness", value: candidate.mutualLikelihood },
    { label: "current availability", value: candidate.targetAvailability },
  ].sort((a, b) => b.value - a.value)[0];

  return {
    targetId: candidate.targetId,
    score,
    recommended,
    reason: recommended
      ? `Strong ${strongestDimension.label} and active event context justify spending a scarce signal.`
      : `Preserve the signal unless the opportunity becomes more aligned or time-sensitive.`,
  };
}

export function rankSignalCandidates(candidates: SignalCandidate[]): SignalRecommendation[] {
  return candidates
    .map(scoreSignalCandidate)
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));
}
