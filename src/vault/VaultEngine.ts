export type VaultEntryKind =
  | "mutual"
  | "missed_category"
  | "office_hours"
  | "next_action"
  | "note";

export type VaultEntryStatus = "open" | "completed" | "dismissed" | "expired";

export interface VaultEntry {
  id: string;
  eventId: string;
  userId: string;
  kind: VaultEntryKind;
  status: VaultEntryStatus;
  title: string;
  detail?: string | null;
  nextAction?: string | null;
  identityRevealed: boolean;
  subjectUserId?: string | null;
  visibleUntil?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface VaultInsight {
  code:
    | "follow_up_now"
    | "office_hours_pending"
    | "missed_high_signal"
    | "captured_momentum"
    | "event_complete";
  priority: 1 | 2 | 3;
  title: string;
  explanation: string;
  entryIds: string[];
}

export interface VaultSummary {
  capturedMutuals: number;
  missedCategories: number;
  officeHoursOutcomes: number;
  openActions: number;
  completedActions: number;
  expiringSoon: number;
  completionRate: number;
  headline: string;
  insights: VaultInsight[];
}

function isVisible(entry: VaultEntry, nowMs: number): boolean {
  if (!entry.visibleUntil) return true;
  const expiry = Date.parse(entry.visibleUntil);
  return Number.isFinite(expiry) && expiry > nowMs;
}

function withinHours(iso: string, hours: number, nowMs: number): boolean {
  const created = Date.parse(iso);
  if (!Number.isFinite(created)) return false;
  return nowMs - created <= hours * 60 * 60 * 1000;
}

export function sanitizeVaultEntry(entry: VaultEntry): VaultEntry {
  if (entry.identityRevealed) return entry;
  return {
    ...entry,
    subjectUserId: null,
    detail: entry.kind === "missed_category" ? entry.detail : null,
  };
}

export function buildVaultSummary(
  rawEntries: VaultEntry[],
  nowMs: number = Date.now()
): VaultSummary {
  const entries = rawEntries.map(sanitizeVaultEntry).filter((entry) => isVisible(entry, nowMs));
  const capturedMutuals = entries.filter((entry) => entry.kind === "mutual").length;
  const missedCategories = entries.filter((entry) => entry.kind === "missed_category").length;
  const officeHoursOutcomes = entries.filter((entry) => entry.kind === "office_hours").length;
  const openActions = entries.filter((entry) => entry.status === "open" && !!entry.nextAction).length;
  const completedActions = entries.filter((entry) => entry.status === "completed").length;
  const actionable = openActions + completedActions;
  const completionRate = actionable === 0 ? 0 : Math.round((completedActions / actionable) * 100);
  const expiringSoon = entries.filter((entry) => {
    if (!entry.visibleUntil) return false;
    const expiry = Date.parse(entry.visibleUntil);
    return Number.isFinite(expiry) && expiry > nowMs && expiry - nowMs <= 24 * 60 * 60 * 1000;
  }).length;

  const insights: VaultInsight[] = [];
  const freshMutuals = entries.filter(
    (entry) => entry.kind === "mutual" && entry.status === "open" && withinHours(entry.createdAt, 24, nowMs)
  );
  if (freshMutuals.length > 0) {
    insights.push({
      code: "follow_up_now",
      priority: 1,
      title: "Follow up while the room is still fresh",
      explanation: `${freshMutuals.length} mutual ${freshMutuals.length === 1 ? "connection is" : "connections are"} still inside the highest-context follow-up window.`,
      entryIds: freshMutuals.map((entry) => entry.id),
    });
  }

  const pendingOfficeHours = entries.filter(
    (entry) => entry.kind === "office_hours" && entry.status === "open"
  );
  if (pendingOfficeHours.length > 0) {
    insights.push({
      code: "office_hours_pending",
      priority: 1,
      title: "Resolve your pending access windows",
      explanation: `${pendingOfficeHours.length} Office Hours ${pendingOfficeHours.length === 1 ? "outcome needs" : "outcomes need"} a next step before the event context decays.`,
      entryIds: pendingOfficeHours.map((entry) => entry.id),
    });
  }

  const missedHighSignal = entries.filter(
    (entry) => entry.kind === "missed_category" && entry.metadata?.highSignal === true
  );
  if (missedHighSignal.length > 0) {
    insights.push({
      code: "missed_high_signal",
      priority: 2,
      title: "Your highest-value misses reveal a pattern",
      explanation: `${missedHighSignal.length} high-signal ${missedHighSignal.length === 1 ? "moment was" : "moments were"} recorded without exposing private identity. Use the pattern to act earlier at the next event.`,
      entryIds: missedHighSignal.map((entry) => entry.id),
    });
  }

  if (capturedMutuals >= 3 && completionRate >= 50) {
    insights.push({
      code: "captured_momentum",
      priority: 3,
      title: "You converted room momentum into action",
      explanation: `You captured ${capturedMutuals} mutuals and completed ${completionRate}% of tracked next actions.`,
      entryIds: entries.filter((entry) => entry.kind === "mutual").map((entry) => entry.id),
    });
  }

  if (entries.length > 0 && openActions === 0) {
    insights.push({
      code: "event_complete",
      priority: 3,
      title: "This event is operationally closed",
      explanation: "No unresolved Vault actions remain. The event memory is preserved without becoming a passive social feed.",
      entryIds: entries.map((entry) => entry.id),
    });
  }

  insights.sort((a, b) => a.priority - b.priority);

  const headline =
    capturedMutuals > 0
      ? `${capturedMutuals} meaningful ${capturedMutuals === 1 ? "opportunity" : "opportunities"} captured`
      : missedCategories > 0
      ? `${missedCategories} useful missed-signal ${missedCategories === 1 ? "pattern" : "patterns"} preserved`
      : "Your event memory is ready";

  return {
    capturedMutuals,
    missedCategories,
    officeHoursOutcomes,
    openActions,
    completedActions,
    expiringSoon,
    completionRate,
    headline,
    insights,
  };
}

export function chooseVaultPrimaryAction(summary: VaultSummary): VaultInsight | null {
  return summary.insights[0] ?? null;
}
