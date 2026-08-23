import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';
import type { VenueTelemetryIntegrityState } from './VenueTelemetryIntegrity';
import type { VenueReadinessState } from './VenueReadiness';

export type LoadSheddingTier = 'normal' | 'constrained' | 'protective' | 'freeze';

export interface VenueLoadSheddingState {
  tier: LoadSheddingTier;
  suppressRecommendations: boolean;
  suppressSponsorEvidence: boolean;
  preserveSafetySignalsOnly: boolean;
  reduceScenarioBreadth: boolean;
  reasons: string[];
}

interface Input {
  twin: VenueTwinSnapshot;
  telemetry: VenueTelemetryIntegrityState;
  readiness: VenueReadinessState;
  activeInterventionCount: number;
}

/**
 * Protects the operator surface when the system is overloaded, uncertain, or
 * already in the middle of too many simultaneous changes. The policy reduces
 * feature breadth before it reduces truth. It never hides venue state that is
 * still needed to understand risk.
 */
export function buildVenueLoadShedding(input: Input): VenueLoadSheddingState {
  const reasons: string[] = [];
  let tier: LoadSheddingTier = 'normal';

  if (input.telemetry.state === 'unsafe' || input.readiness.state === 'not-ready') {
    tier = 'freeze';
    reasons.push('Operational guidance is frozen because venue state is not trustworthy enough for intervention.');
  } else if (input.twin.saturatedZoneCount >= 2 && input.activeInterventionCount >= 2) {
    tier = 'protective';
    reasons.push('Multiple saturated zones and concurrent interventions require a narrower operator surface.');
  } else if (
    input.telemetry.state === 'degraded'
    || input.readiness.state === 'monitor'
    || input.activeInterventionCount >= 2
  ) {
    tier = 'constrained';
    reasons.push('The system is reducing optional analysis while confidence or intervention load is constrained.');
  }

  return {
    tier,
    suppressRecommendations: tier === 'freeze',
    suppressSponsorEvidence: tier === 'protective' || tier === 'freeze',
    preserveSafetySignalsOnly: tier === 'freeze',
    reduceScenarioBreadth: tier !== 'normal',
    reasons,
  };
}
