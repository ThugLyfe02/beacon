import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';

export type CredibilityBand = 'insufficient' | 'provisional' | 'decision-support' | 'validated';

export interface VenueModelCredibilityInput {
  twin: VenueTwinSnapshot;
  quorum: VenueSourceQuorumState;
  verificationChecksPassed: number;
  verificationChecksTotal: number;
  validationCasesPassed: number;
  validationCasesTotal: number;
  calibrationError: number;
  calibrationTolerance: number;
  uncertaintyCoverage: number;
}

export interface VenueModelCredibilityState {
  band: CredibilityBand;
  score: number;
  verificationScore: number;
  validationScore: number;
  calibrationScore: number;
  uncertaintyScore: number;
  blockers: string[];
  statement: string;
}

function ratio(pass: number, total: number): number {
  return total <= 0 ? 0 : Math.max(0, Math.min(1, pass / total));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Produces an explicit model-credibility assessment instead of treating the
 * digital twin's own confidence as proof that the model is fit for decisions.
 * Verification, validation, calibration, uncertainty, and independent sensing
 * support remain separate inputs so reviewers can see why authority was granted.
 */
export function assessVenueModelCredibility(input: VenueModelCredibilityInput): VenueModelCredibilityState {
  const verificationScore = ratio(input.verificationChecksPassed, input.verificationChecksTotal);
  const validationScore = ratio(input.validationCasesPassed, input.validationCasesTotal);
  const calibrationScore = input.calibrationTolerance <= 0
    ? 0
    : clamp01(1 - input.calibrationError / input.calibrationTolerance);
  const uncertaintyScore = clamp01(input.uncertaintyCoverage);
  const quorumFactor = input.quorum.state === 'healthy' ? 1 : input.quorum.state === 'degraded' ? 0.68 : 0.2;

  const score = clamp01(
    verificationScore * 0.22
      + validationScore * 0.28
      + calibrationScore * 0.2
      + uncertaintyScore * 0.12
      + input.twin.overallConfidence * 0.08
      + input.quorum.confidence * quorumFactor * 0.1,
  );

  const blockers: string[] = [];
  if (verificationScore < 0.8) blockers.push('verification coverage is incomplete');
  if (validationScore < 0.7) blockers.push('validation support is not strong enough');
  if (calibrationScore < 0.6) blockers.push('calibration error exceeds the preferred operating range');
  if (input.quorum.state === 'lost') blockers.push('independent sensing quorum is lost');
  if (uncertaintyScore < 0.5) blockers.push('uncertainty coverage is insufficient');

  let band: CredibilityBand = 'insufficient';
  if (score >= 0.84 && blockers.length === 0) band = 'validated';
  else if (score >= 0.68 && !blockers.includes('independent sensing quorum is lost')) band = 'decision-support';
  else if (score >= 0.48) band = 'provisional';

  const statement = band === 'validated'
    ? 'The venue model has enough verification, validation, calibration, uncertainty, and sensing support for bounded decision support.'
    : band === 'decision-support'
      ? 'The venue model is useful for bounded operator decisions, but remaining credibility limits should stay visible.'
      : band === 'provisional'
        ? 'The venue model may support monitoring and review, but should not carry strong operational authority.'
        : 'The venue model is not credible enough for operational decision support.';

  return {
    band,
    score,
    verificationScore,
    validationScore,
    calibrationScore,
    uncertaintyScore,
    blockers,
    statement,
  };
}
