export interface SpatialPrivacyBudgetInput {
  activeContributors: number;
  minimumCohortSize?: number;
  queryCount: number;
  maxQueryCount?: number;
  epsilonBudget?: number;
}

export interface SpatialPrivacyBudgetState {
  releaseAllowed: boolean;
  cohortSatisfied: boolean;
  budgetRemaining: number;
  confidenceMultiplier: number;
  explanation: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Lightweight policy boundary for aggregate venue analytics. It does not claim
 * formal differential privacy by itself; instead it prevents small-cohort or
 * over-queried releases and leaves a clean seam for a server-side DP mechanism.
 */
export function buildSpatialPrivacyBudget(input: SpatialPrivacyBudgetInput): SpatialPrivacyBudgetState {
  const minimumCohortSize = Math.max(3, input.minimumCohortSize ?? 8);
  const maxQueryCount = Math.max(1, input.maxQueryCount ?? 24);
  const epsilonBudget = Math.max(0.1, input.epsilonBudget ?? 2);
  const cohortSatisfied = input.activeContributors >= minimumCohortSize;
  const budgetFraction = clamp01(1 - input.queryCount / maxQueryCount);
  const budgetRemaining = epsilonBudget * budgetFraction;
  const releaseAllowed = cohortSatisfied && budgetRemaining > 0.08;
  const confidenceMultiplier = releaseAllowed ? clamp01(0.65 + budgetFraction * 0.35) : 0;

  return {
    releaseAllowed,
    cohortSatisfied,
    budgetRemaining,
    confidenceMultiplier,
    explanation: !cohortSatisfied
      ? `Aggregate spatial release is suppressed until at least ${minimumCohortSize} contributors support the cohort.`
      : releaseAllowed
        ? 'Aggregate venue analytics remain inside the configured privacy budget; server-side noise can be applied before external release.'
        : 'Aggregate venue analytics are temporarily suppressed because the configured query budget is exhausted.',
  };
}
