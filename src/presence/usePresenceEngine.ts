import { useMemo } from "react";
import {
  ProximitySignal,
  evaluatePresenceState,
  type PresenceState,
} from "./PresenceEngine";

interface PresenceParams {
  rawSignals: ProximitySignal[];
  eventEnd: string;
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}

/**
 * Derives the event-scoped presence state from already-throttled feed inputs.
 *
 * The feed layer owns polling cadence. This hook remains deterministic and
 * memoized so identical inputs always produce an identical render state and
 * never return a transient null value during an active event.
 */
export function usePresenceEngine({
  rawSignals,
  eventEnd,
  signalsSent,
  mutualMatches,
  officeHoursActive,
}: PresenceParams): PresenceState {
  return useMemo(
    () =>
      evaluatePresenceState({
        rawSignals,
        eventEnd,
        signalsSent,
        mutualMatches,
        officeHoursActive,
      }),
    [rawSignals, eventEnd, signalsSent, mutualMatches, officeHoursActive],
  );
}
