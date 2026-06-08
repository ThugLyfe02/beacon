/**
 * Feature flags (compile-time defaults).
 *
 * Lightweight, dependency-free switches. The Surge Engine is flagged so it can
 * be disabled at the integration layer without ripping out wiring.
 */

export const FEATURE_FLAGS = {
  /** Master switch for the Opportunity Surge Engine UI layer. */
  surgeEngine: true,
  /** Premium predictive window hints (~2 min early). */
  surgePredictiveHints: true,
  /** Internal surge telemetry (console only). */
  surgeTelemetry: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag] === true;
}
