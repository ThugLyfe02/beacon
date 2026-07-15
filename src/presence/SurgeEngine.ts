import type { EventPhase } from "../events/EventPhaseEngine";
import { phaseWeight } from "../events/EventPhaseEngine";
import type { PresenceState } from "./PresenceEngine";
import type { SignalVelocity } from "./SignalVelocityTracker";

export type SurgeLevel = "stable" | "building" | "peak" | "closing";

export interface SurgeInput {
  presence: PresenceState;
  velocity: SignalVelocity;
  eventPhase: EventPhase;
  previousDensity?: number;
  previousSurgeLevel?: SurgeLevel;
  userHasMutual?: boolean;
  userSignalsRemaining?: number;
  now?: number;
}

export interface OpportunityWindow {
  active: boolean;
  durationSeconds: number;
  expiresAt: number | null;
  reason: "density" | "premium_access" | "mutual_velocity" | "closing" | null;
}

export interface SurgeEvaluation {
  score: number;
  level: SurgeLevel;
  advisory: string | null;
  evidence: string[];
  opportunityWindow: OpportunityWindow;
  shouldInterrupt: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function determineLevel(score: number, phase: EventPhase): SurgeLevel {
  if (phase === "closing" && score >= 48) return "closing";
  if (score >= 76) return "peak";
  if (score >= 38) return "building";
  return "stable";
}

function buildEvidence(
  presence: PresenceState,
  velocity: SignalVelocity,
  eventPhase: EventPhase,
  densityDelta: number,
): string[] {
  const evidence: string[] = [];

  if (densityDelta >= 2) evidence.push("nearby opportunity density increased");
  if (presence.premiumDensity >= 2) evidence.push(`${presence.premiumDensity} premium participants are nearby`);
  if (velocity.mutuals >= 2) evidence.push(`${velocity.mutuals} mutual activations formed recently`);
  if (velocity.officeHoursOpened > 0) evidence.push("new office-hours availability opened");
  if (eventPhase === "closing") evidence.push(`${presence.timeRemainingMinutes} minutes remain in the event`);

  return evidence;
}

function buildAdvisory(
  level: SurgeLevel,
  presence: PresenceState,
  velocity: SignalVelocity,
  userSignalsRemaining: number | undefined,
): string | null {
  if (level === "stable") return null;

  if (level === "closing") {
    if (userSignalsRemaining === 0) {
      return `${presence.timeRemainingMinutes} minutes remain. Review unresolved mutuals before the room closes.`;
    }
    return `${presence.timeRemainingMinutes} minutes remain. Your strongest nearby window is active now.`;
  }

  if (level === "peak") {
    if (presence.premiumDensity >= 2) {
      return `${presence.premiumDensity} high-signal participants are active nearby. This window is temporary.`;
    }
    if (velocity.mutuals >= 2) {
      return "Mutual activity is accelerating nearby. This is a high-conversion moment.";
    }
    return "Peak opportunity window active. Act while the room is concentrated.";
  }

  if (presence.premiumDensity > 0) {
    return "High-signal availability is building nearby.";
  }
  return "Opportunity density is rising in your proximity.";
}

function buildWindow(
  level: SurgeLevel,
  presence: PresenceState,
  velocity: SignalVelocity,
  eventPhase: EventPhase,
  now: number,
): OpportunityWindow {
  const qualifies =
    (level === "peak" || level === "closing") &&
    presence.density >= 4 &&
    (presence.premiumDensity >= 1 || velocity.mutuals >= 2 || velocity.officeHoursOpened > 0);

  if (!qualifies) {
    return { active: false, durationSeconds: 0, expiresAt: null, reason: null };
  }

  const durationSeconds = level === "closing" ? 120 : 180;
  let reason: OpportunityWindow["reason"] = "density";
  if (eventPhase === "closing") reason = "closing";
  else if (presence.premiumDensity >= 2) reason = "premium_access";
  else if (velocity.mutuals >= 2) reason = "mutual_velocity";

  return {
    active: true,
    durationSeconds,
    expiresAt: now + durationSeconds * 1000,
    reason,
  };
}

export function evaluateSurge({
  presence,
  velocity,
  eventPhase,
  previousDensity = presence.density,
  previousSurgeLevel = "stable",
  userHasMutual = false,
  userSignalsRemaining,
  now = Date.now(),
}: SurgeInput): SurgeEvaluation {
  const densityDelta = presence.density - previousDensity;

  const rawScore =
    presence.density * 7.5 +
    presence.premiumDensity * 10 +
    velocity.weightedVelocity * 4.2 +
    Math.max(0, densityDelta) * 6 +
    presence.momentumScore * 0.18;

  const score = clamp(Math.round(rawScore * phaseWeight(eventPhase)), 0, 100);
  const level = determineLevel(score, eventPhase);
  const evidence = buildEvidence(presence, velocity, eventPhase, densityDelta);
  const advisory = buildAdvisory(level, presence, velocity, userSignalsRemaining);
  const opportunityWindow = buildWindow(level, presence, velocity, eventPhase, now);

  const escalated =
    (previousSurgeLevel === "stable" && level !== "stable") ||
    (previousSurgeLevel === "building" && (level === "peak" || level === "closing"));

  const shouldInterrupt =
    escalated &&
    opportunityWindow.active &&
    !userHasMutual &&
    evidence.length > 0;

  return {
    score,
    level,
    advisory,
    evidence,
    opportunityWindow,
    shouldInterrupt,
  };
}
