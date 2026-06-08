/**
 * Beacon Presence Engine™
 *
 * This is the behavioral operating system beneath Beacon.
 * It does NOT render UI.
 * It does NOT talk to Supabase directly.
 * It does NOT store state globally.
 *
 * It converts proximity signals into psychological pressure.
 *
 * Designed for:
 * - Determinism
 * - Measurability
 * - Extensibility
 * - Zero fluff
 * - Zero gimmicks
 */

export type DistanceBucket = 0 | 1 | 2 | 3;

export interface ProximitySignal {
  observerId: string;
  targetId: string;
  eventId: string;
  distanceFeet: number;
  targetPremium?: boolean;
  mutual?: boolean;
  timestamp?: number;
}

export interface PresenceState {
  density: number;
  premiumDensity: number;
  tensionScore: number;
  urgencyLevel: "calm" | "active" | "elevated" | "surge";
  timeRemainingMinutes: number;
  visibleTargets: ProximitySignal[];
  momentumScore: number;
  missedSignals: number;
}

const BUCKET_THRESHOLDS = {
  dormant: 40,
  distortion: 20,
  silhouette: 10
};

export function calculateBucket(distanceFeet: number): DistanceBucket {
  if (distanceFeet > BUCKET_THRESHOLDS.dormant) return 0;
  if (distanceFeet > BUCKET_THRESHOLDS.distortion) return 1;
  if (distanceFeet > BUCKET_THRESHOLDS.silhouette) return 2;
  return 3;
}

export function computeOpportunityDensity(
  signals: ProximitySignal[]
): number {
  return signals.filter(s => s.distanceFeet <= 40).length;
}

export function computePremiumDensity(
  signals: ProximitySignal[]
): number {
  return signals.filter(s => s.targetPremium && s.distanceFeet <= 40).length;
}

export function computeTimeRemaining(eventEnd: string): number {
  const diff = new Date(eventEnd).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 60000));
}

export function computeTensionScore({
  density,
  premiumDensity,
  timeRemaining,
  mutualCount
}: {
  density: number;
  premiumDensity: number;
  timeRemaining: number;
  mutualCount: number;
}): number {

  let base = 0;

  // Density influence
  base += density * 1.4;

  // Premium proximity amplifies urgency
  base += premiumDensity * 3;

  // Mutual spikes increase intensity
  base += mutualCount * 5;

  // Time compression effect
  if (timeRemaining < 30) base *= 1.25;
  if (timeRemaining < 15) base *= 1.4;
  if (timeRemaining < 5) base *= 1.6;

  return Math.min(Math.round(base), 100);
}

export function determineUrgencyLevel(score: number): PresenceState["urgencyLevel"] {
  if (score < 20) return "calm";
  if (score < 60) return "active";
  if (score < 80) return "elevated";
  return "surge";
}

export function computeMomentum({
  signalsSent,
  mutualMatches,
  officeHoursActive
}: {
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}): number {
  let score = signalsSent * 2 + mutualMatches * 6;
  if (officeHoursActive) score += 15;
  return Math.min(score, 100);
}

export function detectMissedSignals(signals: ProximitySignal[]): number {
  return signals.filter(
    s => calculateBucket(s.distanceFeet) >= 2 && !s.mutual
  ).length;
}

export function evaluatePresenceState({
  rawSignals,
  eventEnd,
  signalsSent,
  mutualMatches,
  officeHoursActive
}: {
  rawSignals: ProximitySignal[];
  eventEnd: string;
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}): PresenceState {

  const enriched = rawSignals.map(signal => ({
    ...signal,
    bucket: calculateBucket(signal.distanceFeet)
  }));

  const density = computeOpportunityDensity(enriched);
  const premiumDensity = computePremiumDensity(enriched);
  const timeRemaining = computeTimeRemaining(eventEnd);

  const tensionScore = computeTensionScore({
    density,
    premiumDensity,
    timeRemaining,
    mutualCount: mutualMatches
  });

  const urgencyLevel = determineUrgencyLevel(tensionScore);

  const momentumScore = computeMomentum({
    signalsSent,
    mutualMatches,
    officeHoursActive
  });

  const missedSignals = detectMissedSignals(enriched);

  const visibleTargets = enriched.filter(s => s.bucket > 0);

  return {
    density,
    premiumDensity,
    tensionScore,
    urgencyLevel,
    timeRemainingMinutes: timeRemaining,
    visibleTargets,
    momentumScore,
    missedSignals
  };
}
