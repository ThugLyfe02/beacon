/**
 * useSurgeEngine
 *
 * React binding for the Opportunity Surge Engine. Owns the stateful concerns
 * the pure engine deliberately avoids:
 * - feeding the rolling SignalVelocityTracker from cumulative activity deltas
 * - driving the OpportunityWindowController (open / no-stack / clean expiry)
 * - emitting internal telemetry
 * - enforcing premium role checks (predictive hints, pre-activation, aura)
 *
 * Performance contract:
 * - Surge recompute is bound to Presence updates, which are throttled upstream
 *   to once per second. This hook adds no interval/polling of its own.
 * - The only timer used is a single setTimeout that fires exactly at window
 *   expiry (no background timers beyond the window duration).
 * - Heavy work is memoised; state writes happen only on window open/close.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { PresenceState } from "./PresenceEngine";
import {
  OpportunityWindowController,
  SurgeEvaluation,
  SurgeLevel,
  evaluateSurge,
  isWindowEligible,
  surgeInputFromPresence,
} from "./SurgeEngine";
import { SignalVelocityTracker } from "./SignalVelocityTracker";
import { SurgeTelemetry } from "./SurgeTelemetry";

export interface SurgeParams {
  presence: PresenceState | null;
  isPremium: boolean;
  /** Cumulative outbound signals for this user/event. */
  signalsSent: number;
  /** Cumulative mutual matches for this user/event. */
  mutualMatches: number;
  officeHoursActive: boolean;
  eventId: string;
}

export interface SurgeResult extends SurgeEvaluation {
  /** Live seconds remaining in the active opportunity window (0 when none). */
  windowRemainingSeconds: number;
  /** Premium-only: surfaced ~2 minutes before a window would open. */
  predictiveHint: string | null;
  /** Premium-only capability: pre-activate Office Hours during peak/closing. */
  canPreactivateOfficeHours: boolean;
  /** Premium-only: amplified aura while in peak/closing surge. */
  auraAmplified: boolean;
}

const PREDICTIVE_LOOKAHEAD_MINUTES = 2;

export function useSurgeEngine({
  presence,
  isPremium,
  signalsSent,
  mutualMatches,
  officeHoursActive,
  eventId,
}: SurgeParams): SurgeResult | null {
  const trackerRef = useRef<SignalVelocityTracker>();
  if (!trackerRef.current) trackerRef.current = new SignalVelocityTracker();

  const controllerRef = useRef<OpportunityWindowController>();
  if (!controllerRef.current) controllerRef.current = new OpportunityWindowController();

  const telemetryRef = useRef<SurgeTelemetry>();
  if (!telemetryRef.current) telemetryRef.current = new SurgeTelemetry(eventId);

  // Latest values, readable from the expiry timer without re-binding it.
  const signalsSentRef = useRef(signalsSent);
  const mutualMatchesRef = useRef(mutualMatches);
  const eligibleRef = useRef(false);
  const levelRef = useRef<SurgeLevel>("stable");
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowBaselineRef = useRef(0);

  // Cumulative-delta bookkeeping for the velocity tracker / transition logs.
  const prevSignalsRef = useRef(signalsSent);
  const prevMutualsRef = useRef(mutualMatches);
  const prevOfficeHoursRef = useRef(officeHoursActive);
  const prevLevelRef = useRef<SurgeLevel | null>(null);
  const surgeScoreRef = useRef(0);

  // Forces a re-render when a window opens/closes (timer-driven transitions).
  const [windowVersion, bump] = useReducer((n: number) => n + 1, 0);

  // --- Feed the rolling velocity tracker from activity deltas --------------
  useEffect(() => {
    const tracker = trackerRef.current!;
    const now = Date.now();

    const dSignals = signalsSent - prevSignalsRef.current;
    if (dSignals > 0) tracker.recordSignals(dSignals, now);
    prevSignalsRef.current = signalsSent;

    const dMutuals = mutualMatches - prevMutualsRef.current;
    if (dMutuals > 0) tracker.recordMutuals(dMutuals, now);
    prevMutualsRef.current = mutualMatches;

    if (officeHoursActive && !prevOfficeHoursRef.current) {
      tracker.recordOfficeHoursActivation(now);
    }
    prevOfficeHoursRef.current = officeHoursActive;

    // Premium conversion during peak/closing: a fresh mutual while in surge.
    if (
      dMutuals > 0 &&
      isPremium &&
      (levelRef.current === "peak" || levelRef.current === "closing")
    ) {
      telemetryRef.current!.premiumConversionDuringPeak(levelRef.current);
    }
  }, [signalsSent, mutualMatches, officeHoursActive, isPremium]);

  // --- Core surge math (pure, memoised, ≤ once per presence tick) ----------
  const core = useMemo(() => {
    if (!presence) return null;
    const now = Date.now();
    const velocity = trackerRef.current!.snapshot(now);
    const input = surgeInputFromPresence(
      presence,
      velocity.recentSignalVelocity,
      mutualMatches
    );
    const evaluation = evaluateSurge(input); // instantaneous, no window override
    const eligible = isWindowEligible(
      evaluation.surgeLevel,
      input.premiumDensity,
      input.density
    );
    return { input, evaluation, eligible, now };
  }, [presence, mutualMatches]);

  // Keep refs in sync for the timer / cross-effect reads.
  signalsSentRef.current = signalsSent;
  mutualMatchesRef.current = mutualMatches;
  if (core) {
    eligibleRef.current = core.eligible;
    levelRef.current = core.evaluation.surgeLevel;
    surgeScoreRef.current = core.evaluation.surgeScore;
  }

  // Run a window-controller update and reconcile telemetry + expiry timer.
  const runWindowUpdate = useCallback(() => {
    const now = Date.now();
    const { state, justOpened, justClosed } = controllerRef.current!.update(
      eligibleRef.current,
      levelRef.current,
      now
    );

    if (justClosed) {
      const engaged = signalsSentRef.current + mutualMatchesRef.current;
      const converted = engaged > windowBaselineRef.current;
      telemetryRef.current!.windowResolved(state.kind ?? levelRef.current, converted);
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    }

    if (justOpened) {
      windowBaselineRef.current = signalsSentRef.current + mutualMatchesRef.current;
      telemetryRef.current!.windowActivated(state.kind!, state.durationSeconds);
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = setTimeout(() => {
        expiryTimerRef.current = null;
        runWindowUpdate();
      }, Math.max(0, state.remainingSeconds) * 1000);
    }

    if (justOpened || justClosed) bump();
  }, []);

  // --- Surge transition telemetry -----------------------------------------
  useEffect(() => {
    if (!core) return;
    const level = core.evaluation.surgeLevel;
    if (prevLevelRef.current !== null && prevLevelRef.current !== level) {
      telemetryRef.current!.surgeTransition(
        prevLevelRef.current,
        level,
        core.evaluation.surgeScore
      );
    }
    prevLevelRef.current = level;
  }, [core]);

  // --- Drive window lifecycle on eligibility / level changes ---------------
  useEffect(() => {
    if (!core) return;
    runWindowUpdate();
  }, [core?.eligible, core?.evaluation.surgeLevel, runWindowUpdate, core]);

  // --- Cleanup on unmount --------------------------------------------------
  useEffect(() => {
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, []);

  // --- Final result: pure projection over live window + premium gating -----
  return useMemo<SurgeResult | null>(() => {
    if (!core) return null;
    const { input, evaluation } = core;
    const now = Date.now();
    const live = controllerRef.current!.peek(now);

    const projected = evaluateSurge(input, {
      active: live.active,
      durationSeconds: live.durationSeconds,
    });

    // Non-premium users only see surge messaging once it is genuinely active
    // (peak/closing). Premium users keep the earlier "building" advisory.
    let advisoryMessage = projected.advisoryMessage;
    if (!isPremium && projected.surgeLevel === "building") {
      advisoryMessage = null;
    }

    // Premium predictive hint: evaluate ~2 minutes further into the event's
    // time-compression curve. If a window would be active then but is not
    // eligible now, surface a forming-window hint early.
    let predictiveHint: string | null = null;
    if (isPremium && !core.eligible) {
      const lookahead = evaluateSurge({
        ...input,
        timeRemainingMinutes: Math.max(
          0,
          input.timeRemainingMinutes - PREDICTIVE_LOOKAHEAD_MINUTES
        ),
      });
      if (lookahead.windowActive) {
        predictiveHint = "Opportunity window forming nearby — prepare to engage.";
      }
    }

    const inSurge =
      projected.surgeLevel === "peak" || projected.surgeLevel === "closing";

    return {
      ...projected,
      advisoryMessage,
      windowRemainingSeconds: live.remainingSeconds,
      predictiveHint,
      canPreactivateOfficeHours: isPremium && inSurge,
      auraAmplified: isPremium && inSurge,
    };
    // `windowVersion` is in the dep list so timer-driven window open/close
    // re-renders recompute the live window projection.
  }, [core, isPremium, windowVersion]);
}
