import type { PresenceState } from './PresenceEngine';

export function logPresenceMetrics(presenceState: PresenceState) {
  console.log("[Presence Metrics]", {
    density: presenceState.density,
    premiumDensity: presenceState.premiumDensity,
    tension: presenceState.tensionScore,
    urgency: presenceState.urgencyLevel,
    momentum: presenceState.momentumScore
  });
}
