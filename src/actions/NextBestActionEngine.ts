import type { EventPhase } from "../events/EventPhaseEngine";
import type { PresenceState } from "../presence/PresenceEngine";
import type { SurgeEvaluation } from "../presence/SurgeEngine";

export type NextBestActionType =
  | "enable_presence"
  | "spend_signal"
  | "request_office_hours"
  | "review_mutual"
  | "wait_for_window"
  | "review_vault"
  | "complete_profile";

export interface NextBestActionInput {
  presence: PresenceState;
  surge: SurgeEvaluation;
  eventPhase: EventPhase;
  isDiscoverable: boolean;
  profileComplete: boolean;
  signalsRemaining: number;
  unresolvedMutuals: number;
  officeHoursAvailable: boolean;
  canRequestOfficeHours: boolean;
  vaultHasActions: boolean;
}

export interface NextBestAction {
  type: NextBestActionType;
  title: string;
  rationale: string;
  priority: number;
  expiresInSeconds: number | null;
}

interface Candidate extends NextBestAction {
  eligible: boolean;
}

function pickHighestPriority(candidates: Candidate[]): NextBestAction {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const winner = eligible.sort((a, b) => b.priority - a.priority)[0];

  return winner ?? {
    type: "wait_for_window",
    title: "Stay available",
    rationale: "The room is quiet. Beacon will surface the next evidence-backed opportunity window.",
    priority: 1,
    expiresInSeconds: null,
  };
}

export function computeNextBestAction(input: NextBestActionInput): NextBestAction {
  const {
    presence,
    surge,
    eventPhase,
    isDiscoverable,
    profileComplete,
    signalsRemaining,
    unresolvedMutuals,
    officeHoursAvailable,
    canRequestOfficeHours,
    vaultHasActions,
  } = input;

  const candidates: Candidate[] = [
    {
      type: "complete_profile",
      title: "Finish your event identity",
      rationale: "A complete event profile improves role clarity and prevents low-confidence reveals.",
      priority: 100,
      expiresInSeconds: null,
      eligible: !profileComplete && eventPhase !== "recap",
    },
    {
      type: "enable_presence",
      title: "Enter the live field",
      rationale: "You are not currently discoverable, so nearby opportunity cannot become mutual.",
      priority: 96,
      expiresInSeconds: null,
      eligible: profileComplete && !isDiscoverable && eventPhase !== "recap",
    },
    {
      type: "review_mutual",
      title: "Resolve your open mutual",
      rationale: `${unresolvedMutuals} mutual ${unresolvedMutuals === 1 ? "connection is" : "connections are"} waiting for a next step.`,
      priority: eventPhase === "closing" ? 94 : 82,
      expiresInSeconds: eventPhase === "closing" ? presence.timeRemainingMinutes * 60 : null,
      eligible: unresolvedMutuals > 0,
    },
    {
      type: "request_office_hours",
      title: "Request the live office-hours slot",
      rationale: "Verified availability is open now and capacity is perishable.",
      priority: surge.level === "peak" || surge.level === "closing" ? 91 : 72,
      expiresInSeconds: surge.opportunityWindow.active ? surge.opportunityWindow.durationSeconds : null,
      eligible: officeHoursAvailable && canRequestOfficeHours,
    },
    {
      type: "spend_signal",
      title: "Use a high-intent signal",
      rationale: surge.advisory ?? "A qualified nearby opportunity is inside reveal range.",
      priority: surge.opportunityWindow.active ? 88 : 66,
      expiresInSeconds: surge.opportunityWindow.active ? surge.opportunityWindow.durationSeconds : null,
      eligible:
        isDiscoverable &&
        signalsRemaining > 0 &&
        presence.visibleTargets.length > 0 &&
        eventPhase !== "recap",
    },
    {
      type: "review_vault",
      title: "Convert the event into next steps",
      rationale: "Your Vault contains saved context that can still become a real outcome.",
      priority: 84,
      expiresInSeconds: null,
      eligible: eventPhase === "recap" && vaultHasActions,
    },
    {
      type: "wait_for_window",
      title: "Hold position",
      rationale: "No high-confidence action is available yet. Beacon is preserving attention instead of manufacturing urgency.",
      priority: 10,
      expiresInSeconds: null,
      eligible: true,
    },
  ];

  return pickHighestPriority(candidates);
}
