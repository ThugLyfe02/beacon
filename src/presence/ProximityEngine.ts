// Beacon Presence Engine™
// Core deterministic proximity and tension logic
// No UI imports. No Supabase imports. Pure behavioral substrate.

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
  if (distanceFeet > 40) return 0; // dormant
  if (distanceFeet > 20) return 1; // distortion
  if (distanceFeet > 10) return 2; // silhouette
  return 3; // unlock
}

export function computeOpportunityDensity(
  signals: ProximitySignal[]
): number {
  return signals.filter(s => s.distanceFeet <= 40).length;
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

  return Math.min(Math.round(base), 100);
}

export function detectMissedOpportunity(
  bucket: DistanceBucket,
  mutual: boolean
): boolean {
  return bucket >= 2 && !mutual;
}

export function computeMomentum(
  signalsSent: number,
  mutualMatches: number,
  officeHoursActive: boolean
): number {
  let score = signalsSent * 2 + mutualMatches * 5;
  if (officeHoursActive) score += 10;
  return Math.min(score, 100);
}
