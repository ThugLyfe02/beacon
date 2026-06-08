export type DistanceBucket = 0 | 1 | 2 | 3;

export interface ProximitySignal {
  observerId: string;
  targetId: string;
  eventId: string;
  distanceFeet: number;
  targetPremium?: boolean;
  mutual?: boolean;
}

export function calculateBucket(distanceFeet: number): DistanceBucket {
  if (distanceFeet > 40) return 0;
  if (distanceFeet > 20) return 1;
  if (distanceFeet > 10) return 2;
  return 3;
}

export function computeOpportunityDensity(signals: ProximitySignal[]): number {
  return signals.filter((s) => s.distanceFeet <= 40).length;
}

export function computeTensionScore(
  density: number,
  premiumNearby: number,
  timeRemainingMinutes: number
): number {
  let base = density * 1.5;
  base += premiumNearby * 2;
  if (timeRemainingMinutes < 30) base *= 1.25;
  if (timeRemainingMinutes < 10) base *= 1.5;
  return Math.min(base, 100);
}
