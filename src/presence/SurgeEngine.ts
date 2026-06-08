/**
 * Beacon Opportunity Surge Engine
 *
 * Sits on top of the Presence Engine. Converts real-time proximity, mutual
 * activity, premium density and event-time compression into measurable surge
 * states and opportunity windows.
 *
 * Principles:
 * - Deterministic. No randomness, no artificial boosting.
 * - Event-scoped and reversible. Surge can rise AND fall.
 * - Pure. No UI, no Supabase, no global state, no timers in this file.
 * - Honest. Advisory copy never exaggerates, lies, or inflates.
 *
 * Lifecycle/timed concerns (opportunity window expiry, telemetry, premium
 * role checks) live in `useSurgeEngine` — this module is the math substrate.
 */

import type { PresenceState } from "./PresenceEngine";

/** The Presence Engine evaluation consumed by the Surge Engine. */
export type PresenceEvaluation = PresenceState;

export type SurgeLevel = "stable" | "building" | "peak" | "closing";

export interface SurgeInput {
  density: number;
  premiumDensity: number;
  mutualMatches: number;
  /** Outbound signals in the trailing 5-minute window. */
  recentSignalVelocity: number;
  timeRemainingMinutes: number;
  /** Used only by the psychological-compression advisory. */
  missedSignals?: number;
}

export interface SurgeEvaluation {
  surgeScore: number;
  surgeLevel: SurgeLevel;
  windowActive: boolean;
  /** Window length in seconds (0 when no window). */
  windowDuration: number;
  advisoryMessage: string | null;
}

/** SurgeScore weights — see formula in the spec. */
export const SURGE_WEIGHTS = {
  density: 1.2,
  premiumDensity: 3,
  mutualMatches: 5,
  velocity: 2,
} as const;

/** Opportunity-window gating thresholds. */
export const WINDOW_THRESHOLDS = {
  minPremiumDensity: 2,
  minDensity: 4,
} as const;

/** Window durations in seconds. */
export const WINDOW_DURATION_SECONDS = {
  peak: 3 * 60,
  closing: 2 * 60,
} as const;

/**
 * Time-compression multiplier. The tightest applicable bracket wins (single
 * select, not stacked) so the published values map 1:1 to behaviour.
 */
export function timeCompressionMultiplier(timeRemainingMinutes: number): number {
  if (timeRemainingMinutes < 5) return 1.75;
  if (timeRemainingMinutes < 15) return 1.4;
  if (timeRemainingMinutes < 30) return 1.25;
  return 1;
}

/**
 * SurgeScore =
 *   (density * 1.2) + (premiumDensity * 3) + (mutualMatches * 5) +
 *   (recentSignalVelocity * 2)
 * then time-compressed and clamped to [0, 100].
 */
export function computeSurgeScore(input: SurgeInput): number {
  const base =
    input.density * SURGE_WEIGHTS.density +
    input.premiumDensity * SURGE_WEIGHTS.premiumDensity +
    input.mutualMatches * SURGE_WEIGHTS.mutualMatches +
    input.recentSignalVelocity * SURGE_WEIGHTS.velocity;

  const compressed = base * timeCompressionMultiplier(input.timeRemainingMinutes);

  return Math.min(Math.round(compressed), 100);
}

/**
 * Map score → level.
 * 0–30 stable | 30–60 building | 60–85 peak | 85–100 closing.
 */
export function determineSurgeLevel(surgeScore: number): SurgeLevel {
  if (surgeScore < 30) return "stable";
  if (surgeScore < 60) return "building";
  if (surgeScore < 85) return "peak";
  return "closing";
}

/** Ordinal used for `level >= "building"` style comparisons in the UI. */
export const SURGE_ORDER: Record<SurgeLevel, number> = {
  stable: 0,
  building: 1,
  peak: 2,
  closing: 3,
};

export function isAtLeast(level: SurgeLevel, min: SurgeLevel): boolean {
  return SURGE_ORDER[level] >= SURGE_ORDER[min];
}

/**
 * An opportunity window is *eligible* to open when the field is dense enough
 * during a peak or closing surge. This is the instantaneous gate; the actual
 * timed, non-stacking window is managed by OpportunityWindowController.
 */
export function isWindowEligible(
  level: SurgeLevel,
  premiumDensity: number,
  density: number
): boolean {
  const inSurge = level === "peak" || level === "closing";
  return (
    inSurge &&
    premiumDensity >= WINDOW_THRESHOLDS.minPremiumDensity &&
    density >= WINDOW_THRESHOLDS.minDensity
  );
}

/** Window duration (seconds) for the level that opened it. */
export function windowDurationSeconds(level: SurgeLevel): number {
  if (level === "peak") return WINDOW_DURATION_SECONDS.peak;
  if (level === "closing") return WINDOW_DURATION_SECONDS.closing;
  return 0;
}

/**
 * Build an honest, event-aware advisory line for the given state. Returns null
 * when there is nothing truthful and useful to say.
 *
 * Psychological-compression advisory (closing surge, user has missed signals
 * but no mutuals, with premium nearby) takes priority — it is informational,
 * not manipulative.
 */
export function buildAdvisoryMessage(
  input: SurgeInput,
  level: SurgeLevel,
  windowActive: boolean
): string | null {
  if (level === "closing") {
    const missed = input.missedSignals ?? 0;
    if (
      missed >= 2 &&
      input.mutualMatches === 0 &&
      input.premiumDensity >= 1
    ) {
      return "You are within activation range of high-signal profiles.";
    }
    const mins = Math.max(0, input.timeRemainingMinutes);
    return `Final surge window — ${mins} ${mins === 1 ? "minute" : "minutes"} remaining.`;
  }

  if (level === "peak") {
    return windowActive
      ? "Peak connection window active."
      : "Peak connection window forming.";
  }

  if (level === "building") {
    return "Opportunity density rising in your proximity.";
  }

  return null;
}

/**
 * Pure surge evaluation.
 *
 * `windowOverride` lets the hook inject the real, timed, non-stacking window
 * state (from OpportunityWindowController) so the returned `windowActive` /
 * `windowDuration` reflect the live window rather than raw eligibility. When
 * omitted, the result reflects instantaneous eligibility — handy for tests.
 */
export function evaluateSurge(
  input: SurgeInput,
  windowOverride?: { active: boolean; durationSeconds: number }
): SurgeEvaluation {
  const surgeScore = computeSurgeScore(input);
  const surgeLevel = determineSurgeLevel(surgeScore);

  const eligible = isWindowEligible(
    surgeLevel,
    input.premiumDensity,
    input.density
  );

  const windowActive = windowOverride ? windowOverride.active : eligible;
  const windowDuration = windowOverride
    ? windowOverride.durationSeconds
    : eligible
    ? windowDurationSeconds(surgeLevel)
    : 0;

  return {
    surgeScore,
    surgeLevel,
    windowActive,
    windowDuration,
    advisoryMessage: buildAdvisoryMessage(input, surgeLevel, windowActive),
  };
}

/** Adapt a Presence Engine evaluation + velocity into Surge Engine input. */
export function surgeInputFromPresence(
  presence: PresenceEvaluation,
  recentSignalVelocity: number,
  mutualMatches: number
): SurgeInput {
  return {
    density: presence.density,
    premiumDensity: presence.premiumDensity,
    mutualMatches,
    recentSignalVelocity,
    timeRemainingMinutes: presence.timeRemainingMinutes,
    missedSignals: presence.missedSignals,
  };
}

// ---------------------------------------------------------------------------
// Opportunity Window lifecycle
// ---------------------------------------------------------------------------

export interface WindowState {
  active: boolean;
  kind: SurgeLevel | null;
  durationSeconds: number;
  remainingSeconds: number;
  startedAt: number | null;
  expiresAt: number | null;
}

export interface WindowUpdate {
  state: WindowState;
  justOpened: boolean;
  justClosed: boolean;
}

const CLOSED_WINDOW: WindowState = {
  active: false,
  kind: null,
  durationSeconds: 0,
  remainingSeconds: 0,
  startedAt: null,
  expiresAt: null,
};

/**
 * Deterministic opportunity-window lifecycle.
 *
 * Rules enforced here:
 * - Windows cannot stack: a new window only opens when none is active.
 * - Windows expire cleanly: once opened, a window runs its full duration and
 *   is fully cleared at expiry (no carry-over, no early mutation of duration).
 * - Fully deterministic: `update` takes an explicit `now`.
 */
export class OpportunityWindowController {
  private open: { kind: SurgeLevel; startedAt: number; expiresAt: number } | null =
    null;

  update(eligible: boolean, level: SurgeLevel, now: number): WindowUpdate {
    let justOpened = false;
    let justClosed = false;

    // Expire cleanly first.
    if (this.open && now >= this.open.expiresAt) {
      this.open = null;
      justClosed = true;
    }

    // Open a fresh window only if eligible and none is active (no stacking).
    if (eligible && !this.open) {
      const durationMs = windowDurationSeconds(level) * 1000;
      if (durationMs > 0) {
        this.open = { kind: level, startedAt: now, expiresAt: now + durationMs };
        justOpened = true;
      }
    }

    return { state: this.toState(now), justOpened, justClosed };
  }

  /** Read-only state at `now` without advancing/opening anything. */
  peek(now: number): WindowState {
    if (this.open && now >= this.open.expiresAt) return CLOSED_WINDOW;
    return this.toState(now);
  }

  reset(): void {
    this.open = null;
  }

  private toState(now: number): WindowState {
    if (!this.open) return CLOSED_WINDOW;
    const durationSeconds = windowDurationSeconds(this.open.kind);
    const remainingSeconds = Math.max(
      0,
      Math.ceil((this.open.expiresAt - now) / 1000)
    );
    return {
      active: true,
      kind: this.open.kind,
      durationSeconds,
      remainingSeconds,
      startedAt: this.open.startedAt,
      expiresAt: this.open.expiresAt,
    };
  }
}
