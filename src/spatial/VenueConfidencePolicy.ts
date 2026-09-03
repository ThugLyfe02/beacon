import type { VenueTwinSnapshot, VenueTwinZone, VenueTwinTransition } from './SpatialVenueTwinEngine';

export interface VenueFreshnessPolicy {
  zoneHalfLifeMs: number;
  transitionHalfLifeMs: number;
  minimumUsableConfidence: number;
}

export interface VenueConfidenceAssessment {
  effectiveConfidence: number;
  ageMs: number;
  stale: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function exponentialDecay(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 0;
  return 2 ** (-Math.max(0, ageMs) / halfLifeMs);
}

export function assessZoneFreshness(
  zone: VenueTwinZone,
  snapshotGeneratedAt: number,
  now: number,
  policy: VenueFreshnessPolicy,
): VenueConfidenceAssessment {
  const ageMs = Math.max(0, now - snapshotGeneratedAt);
  const effectiveConfidence = clamp01(zone.confidence * exponentialDecay(ageMs, policy.zoneHalfLifeMs));
  return { effectiveConfidence, ageMs, stale: effectiveConfidence < policy.minimumUsableConfidence };
}

export function assessTransitionFreshness(
  transition: VenueTwinTransition,
  snapshotGeneratedAt: number,
  now: number,
  policy: VenueFreshnessPolicy,
): VenueConfidenceAssessment {
  const ageMs = Math.max(0, now - snapshotGeneratedAt);
  const effectiveConfidence = clamp01(transition.confidence * exponentialDecay(ageMs, policy.transitionHalfLifeMs));
  return { effectiveConfidence, ageMs, stale: effectiveConfidence < policy.minimumUsableConfidence };
}

export function venueFreshnessSummary(
  snapshot: VenueTwinSnapshot,
  now: number,
  policy: VenueFreshnessPolicy,
): { staleZoneIds: string[]; staleTransitionIds: string[]; minimumEffectiveConfidence: number } {
  const zones = snapshot.zones.map((zone) => [zone.id, assessZoneFreshness(zone, snapshot.generatedAt, now, policy)] as const);
  const transitions = snapshot.transitions.map((transition) => [transition.id, assessTransitionFreshness(transition, snapshot.generatedAt, now, policy)] as const);
  const confidences = [...zones.map(([, value]) => value.effectiveConfidence), ...transitions.map(([, value]) => value.effectiveConfidence)];
  return {
    staleZoneIds: zones.filter(([, value]) => value.stale).map(([id]) => id),
    staleTransitionIds: transitions.filter(([, value]) => value.stale).map(([id]) => id),
    minimumEffectiveConfidence: confidences.length === 0 ? 0 : Math.min(...confidences),
  };
}
