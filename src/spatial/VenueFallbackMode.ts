import type { VenueModelCredibilityState } from './VenueModelCredibility';
import type { VenueSourceQuorumState } from './VenueSourceQuorum';
import type { VenueTelemetryIntegrityState } from './VenueTelemetryIntegrity';

export type VenueFallbackMode = 'normal' | 'advisory-only' | 'manual-confirmation' | 'telemetry-hold';

export interface VenueFallbackState {
  mode: VenueFallbackMode;
  allowNewRecommendations: boolean;
  requireOperatorConfirmation: boolean;
  allowSponsorEvidence: boolean;
  allowOutcomeLearning: boolean;
  explanation: string;
}

/**
 * Defines graceful degradation for the venue operations layer. The product must
 * remain useful when sensing or model credibility degrades, but it must reduce
 * authority before it reduces truth visibility.
 */
export function chooseVenueFallbackMode(
  telemetry: VenueTelemetryIntegrityState,
  quorum: VenueSourceQuorumState,
  credibility: VenueModelCredibilityState,
): VenueFallbackState {
  if (telemetry.state === 'unsafe' || quorum.state === 'lost') {
    return {
      mode: 'telemetry-hold',
      allowNewRecommendations: false,
      requireOperatorConfirmation: true,
      allowSponsorEvidence: false,
      allowOutcomeLearning: false,
      explanation: 'Beacon keeps essential venue state visible but freezes new operational recommendations until telemetry coherence and sensing support recover.',
    };
  }

  if (credibility.band === 'insufficient') {
    return {
      mode: 'manual-confirmation',
      allowNewRecommendations: false,
      requireOperatorConfirmation: true,
      allowSponsorEvidence: false,
      allowOutcomeLearning: false,
      explanation: 'The venue model is not credible enough for autonomous recommendation generation; operators may inspect state and record manual actions explicitly.',
    };
  }

  if (telemetry.state === 'degraded' || quorum.state === 'degraded' || credibility.band === 'provisional') {
    return {
      mode: 'advisory-only',
      allowNewRecommendations: true,
      requireOperatorConfirmation: true,
      allowSponsorEvidence: false,
      allowOutcomeLearning: credibility.band !== 'provisional',
      explanation: 'Beacon can surface bounded advisory guidance, but every action requires explicit operator confirmation and commercial evidence remains suppressed.',
    };
  }

  return {
    mode: 'normal',
    allowNewRecommendations: true,
    requireOperatorConfirmation: false,
    allowSponsorEvidence: true,
    allowOutcomeLearning: true,
    explanation: 'Venue sensing, telemetry, and model credibility are strong enough for the normal operator workflow.',
  };
}
