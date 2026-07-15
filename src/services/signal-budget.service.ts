import { supabase } from "../lib/supabase";
import { evaluateSignalBudget, type SignalBudget, type SignalBudgetEvaluation } from "../signals/SignalBudgetEngine";

interface SignalBudgetRow {
  event_id: string;
  user_id: string;
  budget_limit: number;
  used_count: number;
  resets_at: string | null;
}

function mapBudget(row: SignalBudgetRow): SignalBudget {
  return {
    eventId: row.event_id,
    userId: row.user_id,
    limit: row.budget_limit,
    used: row.used_count,
    resetsAt: row.resets_at,
  };
}

function buildSecureNonce(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}-${random.split("").reverse().join("")}`;
}

export async function getSignalBudget(eventId: string): Promise<SignalBudget | null> {
  if (!eventId) return null;

  const { data, error } = await supabase.rpc("get_or_create_signal_budget", {
    p_event_id: eventId,
    p_default_limit: 3,
  });

  if (error || !data) {
    console.error("[signal-budget.service] getSignalBudget error:", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row ? mapBudget(row as SignalBudgetRow) : null;
}

export async function getSignalBudgetEvaluation(eventId: string): Promise<SignalBudgetEvaluation | null> {
  const budget = await getSignalBudget(eventId);
  return budget ? evaluateSignalBudget(budget) : null;
}

export async function consumeSignalBudget(
  eventId: string,
  recipientId: string,
  nonce = buildSecureNonce(),
): Promise<{ budget: SignalBudget | null; error: string | null; reasonCode?: string }> {
  if (!eventId || !recipientId) {
    return { budget: null, error: "Event and recipient are required." };
  }

  const { data, error } = await supabase.rpc("secure_consume_signal_budget", {
    p_event_id: eventId,
    p_recipient_id: recipientId,
    p_nonce: nonce,
  });

  if (error || !data) {
    const rawMessage = error?.message ?? "Unable to consume signal budget";
    const reasonCode = rawMessage.includes("nonce_reuse")
      ? "nonce_reuse"
      : rawMessage.includes("event_locked")
      ? "event_locked"
      : rawMessage.includes("blocked_relationship")
      ? "blocked_relationship"
      : rawMessage.includes("burst_limit")
      ? "burst_limit"
      : rawMessage.includes("Signal budget exhausted")
      ? "signal_budget_exhausted"
      : "secure_signal_failed";

    const message =
      reasonCode === "signal_budget_exhausted"
        ? "Signal budget exhausted"
        : reasonCode === "event_locked"
        ? "Signals are temporarily locked for this event."
        : reasonCode === "blocked_relationship"
        ? "This signal cannot be sent because the relationship is blocked."
        : reasonCode === "burst_limit"
        ? "Signals are being sent too quickly. Pause before trying again."
        : reasonCode === "nonce_reuse"
        ? "This signal request was already processed."
        : rawMessage;

    console.error("[signal-budget.service] consumeSignalBudget error:", error);
    return { budget: null, error: message, reasonCode };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { budget: row ? mapBudget(row as SignalBudgetRow) : null, error: null };
}
