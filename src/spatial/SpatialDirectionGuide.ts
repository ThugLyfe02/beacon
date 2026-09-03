import { signedAngleDelta } from '../lib/geometry';
import type { ProximitySignal } from '../presence/PresenceEngine';

export type RelativeDirection =
  | 'ahead'
  | 'front-right'
  | 'right'
  | 'back-right'
  | 'behind'
  | 'back-left'
  | 'left'
  | 'front-left';

export interface SpatialDirectionGuide {
  available: boolean;
  distanceFeet: number;
  absoluteBearingDeg: number | null;
  cardinal: string | null;
  relativeDeltaDeg: number | null;
  relativeDirection: RelativeDirection | null;
  turnInstruction: string | null;
  signalAgeMs: number | null;
  confidence: number;
  reason: string;
}

const MAX_DIRECTION_AGE_MS = 45_000;
const FULL_CONFIDENCE_AGE_MS = 10_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function cardinalDirection(bearingDeg: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = normalizeDegrees(bearingDeg);
  return labels[Math.round(normalized / 45) % labels.length];
}

function relativeDirection(deltaDeg: number): RelativeDirection {
  const normalized = normalizeDegrees(deltaDeg);
  if (normalized >= 337.5 || normalized < 22.5) return 'ahead';
  if (normalized < 67.5) return 'front-right';
  if (normalized < 112.5) return 'right';
  if (normalized < 157.5) return 'back-right';
  if (normalized < 202.5) return 'behind';
  if (normalized < 247.5) return 'back-left';
  if (normalized < 292.5) return 'left';
  return 'front-left';
}

function turnInstruction(deltaDeg: number): string {
  const magnitude = Math.abs(deltaDeg);
  if (magnitude <= 8) return 'Ahead';
  if (magnitude >= 172) return 'Behind you';
  const side = deltaDeg > 0 ? 'right' : 'left';
  if (magnitude < 35) return `Slightly ${side}`;
  if (magnitude < 100) return `Turn ${side}`;
  return `Turn around to the ${side}`;
}

/**
 * Converts a live observer-to-target bearing into participant-facing direction
 * guidance. The guide refuses to extend authority beyond the position fix that
 * produced it: after 45 seconds the direction is unavailable rather than being
 * extrapolated or presented as a prediction of where somebody moved.
 *
 * Device heading is local-only input. The returned value contains no persisted
 * movement history and does not infer attention, intent, or future trajectory.
 */
export function buildSpatialDirectionGuide(
  target: ProximitySignal,
  deviceHeadingDeg: number | null,
  now = Date.now(),
): SpatialDirectionGuide {
  const distanceFeet = Math.max(0, target.distanceFeet);
  const rawBearing = target.bearingFromObserverDeg;
  const absoluteBearingDeg = rawBearing != null && Number.isFinite(rawBearing)
    ? normalizeDegrees(rawBearing)
    : null;
  const signalAgeMs = target.timestamp == null || !Number.isFinite(target.timestamp)
    ? null
    : Math.max(0, now - target.timestamp);

  if (absoluteBearingDeg == null) {
    return {
      available: false,
      distanceFeet,
      absoluteBearingDeg: null,
      cardinal: null,
      relativeDeltaDeg: null,
      relativeDirection: null,
      turnInstruction: null,
      signalAgeMs,
      confidence: 0,
      reason: 'This live proximity signal does not contain a measured compass bearing.',
    };
  }

  if (signalAgeMs != null && signalAgeMs > MAX_DIRECTION_AGE_MS) {
    return {
      available: false,
      distanceFeet,
      absoluteBearingDeg,
      cardinal: cardinalDirection(absoluteBearingDeg),
      relativeDeltaDeg: null,
      relativeDirection: null,
      turnInstruction: null,
      signalAgeMs,
      confidence: 0,
      reason: 'The last peer position fix is too old for directional guidance.',
    };
  }

  const ageConfidence = signalAgeMs == null
    ? 0.72
    : signalAgeMs <= FULL_CONFIDENCE_AGE_MS
      ? 1
      : clamp01(1 - (signalAgeMs - FULL_CONFIDENCE_AGE_MS) / (MAX_DIRECTION_AGE_MS - FULL_CONFIDENCE_AGE_MS) * 0.55);

  if (deviceHeadingDeg == null || !Number.isFinite(deviceHeadingDeg)) {
    return {
      available: true,
      distanceFeet,
      absoluteBearingDeg,
      cardinal: cardinalDirection(absoluteBearingDeg),
      relativeDeltaDeg: null,
      relativeDirection: null,
      turnInstruction: null,
      signalAgeMs,
      confidence: ageConfidence * 0.82,
      reason: 'Absolute bearing is live; relative turn guidance is waiting for a calibrated device heading.',
    };
  }

  const delta = signedAngleDelta(normalizeDegrees(deviceHeadingDeg), absoluteBearingDeg);
  return {
    available: true,
    distanceFeet,
    absoluteBearingDeg,
    cardinal: cardinalDirection(absoluteBearingDeg),
    relativeDeltaDeg: delta,
    relativeDirection: relativeDirection(delta),
    turnInstruction: turnInstruction(delta),
    signalAgeMs,
    confidence: ageConfidence,
    reason: 'Direction is derived from the current peer bearing and local device heading; no movement prediction is used.',
  };
}
