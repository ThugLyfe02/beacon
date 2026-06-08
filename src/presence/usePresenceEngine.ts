import { useMemo, useRef } from "react";
import {
  ProximitySignal,
  evaluatePresenceState
} from "./PresenceEngine";

interface PresenceParams {
  rawSignals: ProximitySignal[];
  eventEnd: string;
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}

export function usePresenceEngine({
  rawSignals,
  eventEnd,
  signalsSent,
  mutualMatches,
  officeHoursActive
}: PresenceParams) {

  const lastEvaluationRef = useRef<number>(0);

  const presence = useMemo(() => {
    const now = Date.now();

    // Throttle heavy evaluation to max once per second
    if (now - lastEvaluationRef.current < 1000) {
      return null;
    }

    lastEvaluationRef.current = now;

    return evaluatePresenceState({
      rawSignals,
      eventEnd,
      signalsSent,
      mutualMatches,
      officeHoursActive
    });

  }, [rawSignals, eventEnd, signalsSent, mutualMatches, officeHoursActive]);

  return presence;
}
