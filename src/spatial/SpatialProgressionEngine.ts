import type { PresenceState } from '../presence/PresenceEngine';

export type FieldRank = 'Observer' | 'Connector' | 'Catalyst' | 'Signal';

export interface SpatialProgressionInput {
  presence: PresenceState;
  signalsSent: number;
  mutualMatches: number;
}

export interface SpatialProgressionState {
  rank: FieldRank;
  level: number;
  progress: number;
  currentPoints: number;
  nextLevelPoints: number;
  momentumChain: number;
  heat: 0 | 1 | 2 | 3 | 4 | 5;
  headline: string;
  nextAction: string;
}

const LEVEL_THRESHOLDS = [0, 12, 28, 50, 78, 112, 152, 198, 250, 310] as const;

function rankForLevel(level: number): FieldRank {
  if (level >= 8) return 'Signal';
  if (level >= 6) return 'Catalyst';
  if (level >= 3) return 'Connector';
  return 'Observer';
}

function pointsFor(input: SpatialProgressionInput): number {
  const { presence, signalsSent, mutualMatches } = input;
  const verifiedActionPoints = signalsSent * 5 + mutualMatches * 18;
  const liveFieldPoints = Math.min(18, presence.density * 2);
  const momentumPoints = Math.round(presence.momentumScore * 0.35);
  return Math.max(0, verifiedActionPoints + liveFieldPoints + momentumPoints);
}

function levelForPoints(points: number): number {
  const index = LEVEL_THRESHOLDS.findLastIndex((threshold) => points >= threshold);
  return Math.max(1, index + 1);
}

function nextActionFor(input: SpatialProgressionInput): string {
  if (input.mutualMatches > 0) return 'Open the gold route and turn a mutual into a real next step.';
  if (input.presence.visibleTargets.some((target) => (target.bucket ?? 0) >= 3)) {
    return 'A close path is active. Tap the nearest avatar before the room shifts.';
  }
  if (input.presence.visibleTargets.length > 0) {
    return 'Move through the field and open one of the highlighted paths.';
  }
  return 'Stay active. The field will update as verified attendees enter range.';
}

/**
 * Session progression for the live event field.
 *
 * This is intentionally grounded in actions Beacon can verify. It does not use
 * fabricated popularity, hidden social scores, paid boosts, or permanent public
 * leaderboards. Progress resets with the event context and exists to make useful
 * behavior legible, not to pressure users into meaningless taps.
 */
export function buildSpatialProgression(
  input: SpatialProgressionInput,
): SpatialProgressionState {
  const currentPoints = pointsFor(input);
  const level = levelForPoints(currentPoints);
  const currentThreshold = LEVEL_THRESHOLDS[Math.min(level - 1, LEVEL_THRESHOLDS.length - 1)];
  const nextThreshold = LEVEL_THRESHOLDS[Math.min(level, LEVEL_THRESHOLDS.length - 1)];
  const span = Math.max(1, nextThreshold - currentThreshold);
  const progress = level >= LEVEL_THRESHOLDS.length
    ? 1
    : Math.max(0, Math.min(1, (currentPoints - currentThreshold) / span));

  const momentumChain = Math.max(0, input.signalsSent + input.mutualMatches * 2);
  const heat = Math.max(0, Math.min(5, Math.ceil(input.presence.tensionScore / 20))) as SpatialProgressionState['heat'];
  const rank = rankForLevel(level);

  return {
    rank,
    level,
    progress,
    currentPoints,
    nextLevelPoints: nextThreshold,
    momentumChain,
    heat,
    headline: momentumChain > 0
      ? `${rank} · chain ${momentumChain}`
      : `${rank} · field level ${level}`,
    nextAction: nextActionFor(input),
  };
}
