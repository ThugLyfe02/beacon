export type EventPhase = "arrival" | "exploration" | "peak" | "closing" | "recap";

export interface EventPhaseInput {
  startsAt: string;
  endsAt: string;
  now?: number;
  peakStartOffsetMinutes?: number;
  closingWindowMinutes?: number;
}

export interface EventPhaseState {
  phase: EventPhase;
  elapsedMinutes: number;
  remainingMinutes: number;
  progress: number;
  isLive: boolean;
}

const MINUTE = 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function evaluateEventPhase({
  startsAt,
  endsAt,
  now = Date.now(),
  peakStartOffsetMinutes,
  closingWindowMinutes = 20,
}: EventPhaseInput): EventPhaseState {
  const startMs = parseTimestamp(startsAt, "startsAt");
  const endMs = parseTimestamp(endsAt, "endsAt");

  if (endMs <= startMs) {
    throw new Error("Event end must occur after event start");
  }

  const durationMinutes = (endMs - startMs) / MINUTE;
  const elapsedMinutes = Math.max(0, Math.floor((now - startMs) / MINUTE));
  const remainingMinutes = Math.max(0, Math.ceil((endMs - now) / MINUTE));
  const progress = clamp((now - startMs) / (endMs - startMs), 0, 1);
  const isLive = now >= startMs && now < endMs;

  if (now >= endMs) {
    return { phase: "recap", elapsedMinutes, remainingMinutes, progress: 1, isLive: false };
  }

  if (now < startMs) {
    return { phase: "arrival", elapsedMinutes: 0, remainingMinutes, progress: 0, isLive: false };
  }

  const peakStart = peakStartOffsetMinutes ?? Math.max(15, Math.floor(durationMinutes * 0.38));
  const explorationEnd = Math.min(peakStart, Math.max(10, Math.floor(durationMinutes * 0.25)));

  let phase: EventPhase;
  if (remainingMinutes <= closingWindowMinutes) {
    phase = "closing";
  } else if (elapsedMinutes >= peakStart) {
    phase = "peak";
  } else if (elapsedMinutes >= explorationEnd) {
    phase = "exploration";
  } else {
    phase = "arrival";
  }

  return { phase, elapsedMinutes, remainingMinutes, progress, isLive };
}

export function phaseWeight(phase: EventPhase): number {
  switch (phase) {
    case "arrival":
      return 0.72;
    case "exploration":
      return 1;
    case "peak":
      return 1.18;
    case "closing":
      return 1.42;
    case "recap":
      return 0;
  }
}
