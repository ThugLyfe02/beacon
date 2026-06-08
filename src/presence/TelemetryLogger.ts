export function logPresenceMetrics(presenceState) {
  console.log("[Presence Metrics]", {
    density: presenceState.density,
    premiumDensity: presenceState.premiumDensity,
    tension: presenceState.tensionScore,
    urgency: presenceState.urgencyLevel,
    momentum: presenceState.momentumScore
  });
}
