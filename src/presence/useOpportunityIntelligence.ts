import { useMemo, useRef } from "react";
import { evaluateEventPhase, type EventPhaseState } from "../events/EventPhaseEngine";
import type { PresenceState } from "./PresenceEngine";
import { computeSignalVelocity, type SignalActivity, type SignalVelocity } from "./SignalVelocityTracker";
import { evaluateSurge, type SurgeEvaluation, type SurgeLevel } from "./SurgeEngine";

interface Params {
  presence: PresenceState;
  eventStartsAt: string;
  eventEndsAt: string;
  activity?: readonly SignalActivity[];
  signalsRemaining?: number;
  userHasMutual?: boolean;
  now?: number;
}

export interface OpportunityIntelligenceState {
  phase: EventPhaseState;
  velocity: SignalVelocity;
  surge: SurgeEvaluation;
}

export function useOpportunityIntelligence({
  presence,
  eventStartsAt,
  eventEndsAt,
  activity = [],
  signalsRemaining,
  userHasMutual = false,
  now = Date.now(),
}: Params): OpportunityIntelligenceState {
  const previousDensity = useRef(presence.density);
  const previousSurgeLevel = useRef<SurgeLevel>("stable");

  const phase = useMemo(
    () => evaluateEventPhase({ startsAt: eventStartsAt, endsAt: eventEndsAt, now }),
    [eventEndsAt, eventStartsAt, now],
  );

  const velocity = useMemo(
    () => computeSignalVelocity(activity, now),
    [activity, now],
  );

  const surge = useMemo(
    () =>
      evaluateSurge({
        presence,
        velocity,
        eventPhase: phase.phase,
        previousDensity: previousDensity.current,
        previousSurgeLevel: previousSurgeLevel.current,
        userHasMutual,
        userSignalsRemaining: signalsRemaining,
        now,
      }),
    [now, phase.phase, presence, signalsRemaining, userHasMutual, velocity],
  );

  previousDensity.current = presence.density;
  previousSurgeLevel.current = surge.level;

  return { phase, velocity, surge };
}
