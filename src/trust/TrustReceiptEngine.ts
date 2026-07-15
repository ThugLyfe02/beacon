export type TrustReceiptAction =
  | "event_opt_in"
  | "signal_sent"
  | "office_hours_requested"
  | "mutual_revealed"
  | "vault_saved"
  | "vip_mode_enabled";

export interface TrustReceiptContext {
  action: TrustReceiptAction;
  eventName?: string | null;
  expiresAt?: string | null;
  mutualOnly?: boolean;
  organizerCanSee?: boolean;
  identityRevealed?: boolean;
}

export interface TrustReceipt {
  action: TrustReceiptAction;
  title: string;
  summary: string;
  shared: string[];
  hidden: string[];
  visibility: string;
  expiry: string;
  severity: "informational" | "sensitive";
}

function formatExpiry(expiresAt?: string | null): string {
  if (!expiresAt) return "This permission remains event-scoped until you change it.";
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return "This permission follows the event's configured expiry.";
  return `This access expires ${parsed.toLocaleString()}.`;
}

export function buildTrustReceipt(context: TrustReceiptContext): TrustReceipt {
  const eventLabel = context.eventName ? ` at ${context.eventName}` : " in this event";

  switch (context.action) {
    case "event_opt_in":
      return {
        action: context.action,
        title: "You are visible inside this event only",
        summary: `Beacon can now include you in event-scoped opportunity signals${eventLabel}.`,
        shared: ["Your event profile", "Your discoverability state", "Derived proximity bucket when active"],
        hidden: ["Raw movement trails", "Private signals you send", "Your activity outside this event"],
        visibility: context.organizerCanSee
          ? "The organizer may see aggregate participation health, not your private signals."
          : "Only approved event participants can interact with your event-scoped presence.",
        expiry: formatExpiry(context.expiresAt),
        severity: "sensitive",
      };

    case "signal_sent":
      return {
        action: context.action,
        title: "Your signal remains private unless it becomes mutual",
        summary: "Beacon recorded a high-intent action without broadcasting it to the room.",
        shared: context.mutualOnly === false ? ["Your interest state with the recipient"] : ["Nothing is revealed unless the recipient independently signals you"],
        hidden: ["The signal from other attendees", "Your remaining signal strategy", "Your broader activity"],
        visibility: context.mutualOnly === false
          ? "Only the intended recipient can access the signal state."
          : "No identity-level reveal occurs until mutual activation.",
        expiry: formatExpiry(context.expiresAt),
        severity: "sensitive",
      };

    case "office_hours_requested":
      return {
        action: context.action,
        title: "Your Office Hours request is controlled access",
        summary: "The host receives only the context needed to accept, decline, or schedule the request.",
        shared: ["Your event identity", "Your proposed time", "Your stated reason for meeting"],
        hidden: ["Unrelated signals", "Private Vault items", "Location history"],
        visibility: "Only you, the Office Hours host, and authorized event operations can see the request state.",
        expiry: formatExpiry(context.expiresAt),
        severity: "sensitive",
      };

    case "mutual_revealed":
      return {
        action: context.action,
        title: "A mutual opportunity has been unlocked",
        summary: "Both participants independently expressed interest before identity and next-step options were revealed.",
        shared: ["Mutual event identity", "Approved profile context", "Available next-step options"],
        hidden: ["Other private signals", "Non-mutual interest", "Unrelated event behavior"],
        visibility: "Only the matched participants can access this mutual opportunity.",
        expiry: formatExpiry(context.expiresAt),
        severity: "informational",
      };

    case "vault_saved":
      return {
        action: context.action,
        title: "Saved to your private Vault",
        summary: "Beacon preserved the opportunity context so the event does not collapse into an unstructured contact list.",
        shared: ["Nothing new was shared externally"],
        hidden: ["Your notes", "Your next action", "Your private event analysis"],
        visibility: "This Vault item is visible only to you unless you explicitly export it.",
        expiry: formatExpiry(context.expiresAt),
        severity: "informational",
      };

    case "vip_mode_enabled":
      return {
        action: context.action,
        title: "Invisible VIP controls are active",
        summary: "You can contribute to aggregate opportunity density without becoming broadly discoverable.",
        shared: ["Aggregate availability state", "Approved Office Hours windows when enabled"],
        hidden: ["Your identity from broad participant lists", "Your precise proximity", "Inbound interest outside configured controls"],
        visibility: context.identityRevealed
          ? "Identity can be revealed only through an approved or mutual interaction."
          : "Identity remains concealed until your configured eligibility rules are satisfied.",
        expiry: formatExpiry(context.expiresAt),
        severity: "sensitive",
      };
  }
}

export function trustReceiptHasEvidence(receipt: TrustReceipt): boolean {
  return receipt.shared.length > 0 && receipt.hidden.length > 0 && receipt.visibility.length > 0;
}
