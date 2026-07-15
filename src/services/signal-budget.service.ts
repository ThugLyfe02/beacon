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
  recipientId: string
): Promise<{ budget: SignalBudget | null; error: string | null }> {
  if (!eventId || !recipientId) {
    return { budget: null, error: "Event and recipient are required." };
  }

  const { data, error } = await supabase.rpc("consume_signal_budget", {
    p_event_id: eventId,
    p_recipient_id: recipientId,
  });

  if (error || !data) {
    const message = error?.message?.includes("Signal budget exhausted")
      ? "Signal budget exhausted"
      : error?.message ?? "Unable to consume signal budget";
    console.error("[signal-budget.service] consumeSignalBudget error:", error);
    return { budget: null, error: message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { budget: row ? mapBudget(row as SignalBudgetRow) : null, error: null };
}
