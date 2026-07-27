import type { ProximitySignal } from '../presence/PresenceEngine';

export type InteractionKind = 'inspect' | 'signal' | 'mutual' | 'office-hours';

export interface SpatialInteractionPulse {
  id: string;
  targetId: string;
  kind: InteractionKind;
  createdAt: number;
  expiresAt: number;
  intensity: number;
  ringExpansion: number;
  routeEnergy: number;
  environmentResponse: number;
}

export interface AlmostDiscoveredMoment {
  id: string;
  targetId: string;
  createdAt: number;
  expiresAt: number;
  previousDistanceFeet: number;
  previousBearingDeg?: number;
  strength: number;
  copy: string;
}

export interface AlmostDiscoveredInput {
  previousTargets: ProximitySignal[];
  currentTargets: ProximitySignal[];
  mutualTargetIds?: ReadonlySet<string>;
  now?: number;
}

const PULSE_DURATION_MS = 1_850;
const ALMOST_DISCOVERED_DURATION_MS = 5_500;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createSpatialInteractionPulse(
  targetId: string,
  kind: InteractionKind,
  now = Date.now(),
): SpatialInteractionPulse {
  const weights: Record<InteractionKind, number> = {
    inspect: 0.56,
    signal: 0.82,
    mutual: 1,
    'office-hours': 0.92,
  };
  const intensity = weights[kind];
  return {
    id: `${targetId}:${kind}:${now}`,
    targetId,
    kind,
    createdAt: now,
    expiresAt: now + PULSE_DURATION_MS,
    intensity,
    ringExpansion: 0.8 + intensity * 1.4,
    routeEnergy: 0.45 + intensity * 0.55,
    environmentResponse: 0.2 + intensity * 0.48,
  };
}

/**
 * Detects only a narrow, evidence-backed near miss: a recently visible, close,
 * fresh, non-mutual target disappears from the current verified field.
 *
 * Privacy invariant: this mechanic does not infer rejection, identity intent,
 * or claim that the user "missed" someone. It records only a verified change in
 * field visibility and uses neutral copy that admits Beacon does not know why.
 */
export function detectAlmostDiscoveredMoments({
  previousTargets,
  currentTargets,
  mutualTargetIds = new Set<string>(),
  now = Date.now(),
}: AlmostDiscoveredInput): AlmostDiscoveredMoment[] {
  if (previousTargets.length === 0) return [];
  const currentIds = new Set(currentTargets.map((target) => target.targetId));

  return previousTargets.flatMap((target) => {
    if (currentIds.has(target.targetId) || target.mutual || mutualTargetIds.has(target.targetId)) return [];
    if (target.distanceFeet > 24) return [];
    const ageMs = target.timestamp ? Math.max(0, now - target.timestamp) : 0;
    if (target.timestamp && ageMs > 45_000) return [];

    const proximityStrength = clamp01(1 - target.distanceFeet / 24);
    const freshnessStrength = target.timestamp ? clamp01(1 - ageMs / 45_000) : 0.55;
    const strength = clamp01(proximityStrength * 0.7 + freshnessStrength * 0.3);
    if (strength < 0.42) return [];

    return [{
      id: `almost:${target.targetId}:${now}`,
      targetId: target.targetId,
      createdAt: now,
      expiresAt: now + ALMOST_DISCOVERED_DURATION_MS,
      previousDistanceFeet: target.distanceFeet,
      previousBearingDeg: target.bearingFromObserverDeg,
      strength,
      copy: 'This opportunity almost became something. The fading route preserves the moment without pretending to know why it changed.',
    }];
  }).slice(0, 4);
}

export function pruneInteractionPulses(
  pulses: SpatialInteractionPulse[],
  now = Date.now(),
): SpatialInteractionPulse[] {
  return pulses.filter((pulse) => pulse.expiresAt > now);
}

export function pruneAlmostDiscoveredMoments(
  moments: AlmostDiscoveredMoment[],
  now = Date.now(),
): AlmostDiscoveredMoment[] {
  return moments.filter((moment) => moment.expiresAt > now);
}
