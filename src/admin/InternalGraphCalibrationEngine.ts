import type { InternalBridgePattern } from './InternalGraphStrategyEngine';

export interface InternalBridgePatternPosterior {
  connectorKind: string;
  sampleSize: number;
  observedOutcomeRate: number;
  posteriorOutcomeMean: number;
  outcomeLowerBound90: number;
  observedCompletedRate: number;
  posteriorCompletedMean: number;
  completedLowerBound90: number;
  evidenceMaturity: number;
  conservativeValueScore: number;
  priorMean: number;
  interpretation: string[];
}

export interface InternalBridgeCalibrationModel {
  generatedAt: string;
  priorOutcomeMean: number;
  priorCompletedMean: number;
  priorStrength: number;
  patterns: InternalBridgePatternPosterior[];
  caveat: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function pooledRate(patterns: InternalBridgePattern[], selector: (pattern: InternalBridgePattern) => number): number {
  let successes = 0;
  let total = 0;
  for (const pattern of patterns) {
    const n = Math.max(0, pattern.sampleSize);
    successes += clamp01(selector(pattern)) * n;
    total += n;
  }
  return total > 0 ? successes / total : 0.12;
}

function posterior(
  observedRate: number,
  sampleSize: number,
  priorMean: number,
  priorStrength: number,
): { mean: number; lower90: number } {
  const n = Math.max(0, sampleSize);
  const observedSuccess = clamp01(observedRate) * n;
  const alphaPrior = Math.max(0.5, priorMean * priorStrength);
  const betaPrior = Math.max(0.5, (1 - priorMean) * priorStrength);
  const alpha = alphaPrior + observedSuccess;
  const beta = betaPrior + Math.max(0, n - observedSuccess);
  const mean = alpha / (alpha + beta);
  // Beta posterior normal approximation. This is intentionally conservative and
  // deterministic; it is used for ranking evidence maturity, not causal claims.
  const variance = (alpha * beta) / (((alpha + beta) ** 2) * (alpha + beta + 1));
  const lower90 = clamp01(mean - 1.644854 * Math.sqrt(Math.max(0, variance)));
  return { mean: clamp01(mean), lower90 };
}

/**
 * Empirical-Bayes shrinkage for historical bridge archetypes.
 *
 * Raw rates are not allowed to dominate when n is small. Every connector kind is
 * shrunk toward the pooled Beacon prior, and ranking uses the conservative lower
 * bound rather than the point estimate. This prevents three lucky bridges from
 * becoming an autonomous-system "truth".
 */
export function calibrateInternalBridgePatterns(
  patterns: InternalBridgePattern[],
  priorStrength = 12,
): InternalBridgeCalibrationModel {
  const priorOutcomeMean = pooledRate(patterns, (pattern) => pattern.outcomeRate);
  const priorCompletedMean = pooledRate(patterns, (pattern) => pattern.completedRate);

  const posteriorPatterns = patterns.map<InternalBridgePatternPosterior>((pattern) => {
    const outcome = posterior(pattern.outcomeRate, pattern.sampleSize, priorOutcomeMean, priorStrength);
    const completed = posterior(pattern.completedRate, pattern.sampleSize, priorCompletedMean, priorStrength);
    const maturity = clamp01(pattern.sampleSize / 30) * clamp01(pattern.confidence);
    const conservativeValueScore =
      outcome.lower90 * 0.62
      + completed.lower90 * 0.28
      + Math.min(1, Math.log2(1 + pattern.sampleSize) / 6) * 0.1;
    const interpretation: string[] = [];
    if (pattern.sampleSize < 5) interpretation.push('very low sample; heavy shrinkage applied');
    else if (pattern.sampleSize < 15) interpretation.push('developing evidence; posterior remains prior-sensitive');
    else interpretation.push('maturing observational sample');
    if (pattern.outcomeRate > outcome.mean + 0.05) interpretation.push('raw outcome rate is above shrunk expectation');
    if (pattern.outcomeRate < outcome.mean - 0.05) interpretation.push('raw outcome rate is below pooled prior expectation');
    if (outcome.lower90 <= priorOutcomeMean * 0.5) interpretation.push('conservative evidence floor remains weak');
    if (completed.lower90 > priorCompletedMean) interpretation.push('completed-outcome floor exceeds pooled baseline');

    return {
      connectorKind: pattern.connectorKind,
      sampleSize: pattern.sampleSize,
      observedOutcomeRate: clamp01(pattern.outcomeRate),
      posteriorOutcomeMean: outcome.mean,
      outcomeLowerBound90: outcome.lower90,
      observedCompletedRate: clamp01(pattern.completedRate),
      posteriorCompletedMean: completed.mean,
      completedLowerBound90: completed.lower90,
      evidenceMaturity: maturity,
      conservativeValueScore,
      priorMean: priorOutcomeMean,
      interpretation,
    };
  }).sort((left, right) =>
    right.conservativeValueScore - left.conservativeValueScore
    || right.sampleSize - left.sampleSize
    || left.connectorKind.localeCompare(right.connectorKind));

  return {
    generatedAt: new Date().toISOString(),
    priorOutcomeMean,
    priorCompletedMean,
    priorStrength,
    patterns: posteriorPatterns,
    caveat: 'Posterior ranks summarize observational chronology only. They do not estimate causal effect of an operator introduction.',
  };
}
