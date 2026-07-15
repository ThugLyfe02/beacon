export type SignalActivityType = "signal_sent" | "signal_received" | "mutual" | "office_hours_opened";

export interface SignalActivity {
  type: SignalActivityType;
  occurredAt: number;
}

export interface SignalVelocity {
  signalsSent: number;
  signalsReceived: number;
  mutuals: number;
  officeHoursOpened: number;
  weightedVelocity: number;
}

const DEFAULT_WINDOW_MS = 5 * 60_000;

const WEIGHTS: Record<SignalActivityType, number> = {
  signal_sent: 1,
  signal_received: 1.15,
  mutual: 2.8,
  office_hours_opened: 2.2,
};

export function pruneSignalActivity(
  activity: readonly SignalActivity[],
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
): SignalActivity[] {
  const cutoff = now - windowMs;
  return activity.filter((item) => item.occurredAt >= cutoff && item.occurredAt <= now);
}

export function computeSignalVelocity(
  activity: readonly SignalActivity[],
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
): SignalVelocity {
  const current = pruneSignalActivity(activity, now, windowMs);

  let signalsSent = 0;
  let signalsReceived = 0;
  let mutuals = 0;
  let officeHoursOpened = 0;
  let weightedVelocity = 0;

  for (const item of current) {
    weightedVelocity += WEIGHTS[item.type];
    if (item.type === "signal_sent") signalsSent += 1;
    if (item.type === "signal_received") signalsReceived += 1;
    if (item.type === "mutual") mutuals += 1;
    if (item.type === "office_hours_opened") officeHoursOpened += 1;
  }

  return {
    signalsSent,
    signalsReceived,
    mutuals,
    officeHoursOpened,
    weightedVelocity: Number(weightedVelocity.toFixed(2)),
  };
}

export function appendSignalActivity(
  activity: readonly SignalActivity[],
  item: SignalActivity,
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
): SignalActivity[] {
  return pruneSignalActivity([...activity, item], now, windowMs);
}
