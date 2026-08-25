import type { ProximitySignal, PresenceState } from '../presence/PresenceEngine';

export type SpatialMood = 'quiet' | 'forming' | 'active' | 'surge';
export type SpatialAttentionTier = 'hero' | 'active' | 'ambient';

export interface SpatialFocusTarget {
  target: ProximitySignal & { bucket?: number };
  score: number;
  rank: number;
  tier: SpatialAttentionTier;
  reason: 'mutual' | 'premium-nearby' | 'closest' | 'momentum';
}

export interface SpatialExperienceState {
  mood: SpatialMood;
  headline: string;
  detail: string;
  accent: string;
  focusTargets: SpatialFocusTarget[];
  ambientOpportunityCount: number;
}

function scoreTarget(target: ProximitySignal & { bucket?: number }): Omit<SpatialFocusTarget, 'rank' | 'tier'> {
  const distanceScore = Math.max(0, 42 - target.distanceFeet);
  const mutualBoost = target.mutual ? 38 : 0;
  const premiumBoost = target.targetPremium ? 14 : 0;
  const bucketBoost = (target.bucket ?? 0) * 5;
  const freshnessBoost = target.timestamp != null
    ? Math.max(0, 6 - Math.floor((Date.now() - target.timestamp) / 10_000))
    : 0;
  const score = distanceScore + mutualBoost + premiumBoost + bucketBoost + freshnessBoost;

  let reason: SpatialFocusTarget['reason'] = 'closest';
  if (target.mutual) reason = 'mutual';
  else if (target.targetPremium && target.distanceFeet <= 20) reason = 'premium-nearby';
  else if ((target.bucket ?? 0) >= 2) reason = 'momentum';

  return { target, score, reason };
}

function determineMood(presence: PresenceState): SpatialMood {
  if (presence.urgencyLevel === 'surge') return 'surge';
  if (presence.urgencyLevel === 'elevated') return 'active';
  if (presence.density > 0) return 'forming';
  return 'quiet';
}

function tierForRank(rank: number, score: number): SpatialAttentionTier {
  if (rank === 0 || score >= 70) return 'hero';
  if (rank < 8 || score >= 36) return 'active';
  return 'ambient';
}

function copyForState(
  mood: SpatialMood,
  focusTargets: SpatialFocusTarget[],
  timeRemainingMinutes: number,
): Pick<SpatialExperienceState, 'headline' | 'detail' | 'accent'> {
  const primary = focusTargets[0];

  if (!primary) {
    return {
      headline: 'The field is still forming',
      detail: 'Beacon will surface real nearby activity as the room changes.',
      accent: '#64748b',
    };
  }

  if (primary.reason === 'mutual') {
    return {
      headline: 'A real connection is active nearby',
      detail: 'The gold route marks a mutual you can act on now.',
      accent: '#fbbf24',
    };
  }

  if (mood === 'surge') {
    return {
      headline: 'This window is moving quickly',
      detail: `${focusTargets.length} live path${focusTargets.length === 1 ? '' : 's'} are visible with ${timeRemainingMinutes}m left. Beacon increases detail around the strongest ones without hiding the rest.`,
      accent: '#fb7185',
    };
  }

  if (primary.reason === 'premium-nearby') {
    return {
      headline: 'A high-value path is close',
      detail: 'The strongest route is emphasized while the full live field remains visible around it.',
      accent: '#f59e0b',
    };
  }

  return {
    headline: 'The room is starting to take shape',
    detail: `${focusTargets.length} live path${focusTargets.length === 1 ? '' : 's'} are currently represented in the field.`,
    accent: mood === 'active' ? '#a78bfa' : '#60a5fa',
  };
}

/**
 * Converts the existing PresenceState into a scalable visual hierarchy.
 * Every visible attendee remains represented. Detail is allocated by salience,
 * while lower-priority paths become ambient markers instead of disappearing.
 */
export function buildSpatialExperience(presence: PresenceState): SpatialExperienceState {
  const focusTargets = presence.visibleTargets
    .map(scoreTarget)
    .sort((left, right) => right.score - left.score)
    .map((focus, rank) => ({
      ...focus,
      rank,
      tier: tierForRank(rank, focus.score),
    }));

  const mood = determineMood(presence);
  const copy = copyForState(mood, focusTargets, presence.timeRemainingMinutes);

  return {
    mood,
    ...copy,
    focusTargets,
    ambientOpportunityCount: focusTargets.filter((target) => target.tier === 'ambient').length,
  };
}

function stableSeed(id: string): number {
  return id
    .split('')
    .reduce((accumulator, character) => accumulator + character.codePointAt(0)!, 0);
}

/**
 * Converts a live proximity signal into the field coordinate system.
 *
 * When a true observer-to-target bearing exists, the spatial field honors it
 * directly: north is -Z, east is +X, south is +Z, west is -X. This matches the
 * sector coordinates used by aggregate world intelligence and removes the old
 * failure mode where a person's screen direction was determined by their user
 * id rather than the physical room.
 *
 * A deterministic id-derived direction remains only as a compatibility fallback
 * for legacy or temporarily incomplete signals that do not carry bearing data.
 * The fallback is stable and is never presented as a measured compass direction.
 */
export function positionForSpatialTarget(
  target: ProximitySignal,
): [number, number, number] {
  const radius = Math.max(1, target.distanceFeet / 4);
  const seed = stableSeed(target.targetId);
  const lift = ((seed % 7) - 3) * 0.04;
  const bearing = target.bearingFromObserverDeg;

  if (bearing != null && Number.isFinite(bearing)) {
    const normalized = ((bearing % 360) + 360) % 360;
    const radians = normalized * (Math.PI / 180);
    return [
      Math.sin(radians) * radius,
      lift,
      -Math.cos(radians) * radius,
    ];
  }

  const fallbackAngle = (seed % 360) * (Math.PI / 180);
  return [
    Math.cos(fallbackAngle) * radius,
    lift,
    Math.sin(fallbackAngle) * radius,
  ];
}
