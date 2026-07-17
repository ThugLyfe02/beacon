import type { ProximitySignal, PresenceState } from '../presence/PresenceEngine';

export type SpatialMood = 'quiet' | 'forming' | 'active' | 'surge';

export interface SpatialFocusTarget {
  target: ProximitySignal & { bucket?: number };
  score: number;
  reason: 'mutual' | 'premium-nearby' | 'closest' | 'momentum';
}

export interface SpatialExperienceState {
  mood: SpatialMood;
  headline: string;
  detail: string;
  accent: string;
  focusTargets: SpatialFocusTarget[];
  hiddenOpportunityCount: number;
}

function scoreTarget(target: ProximitySignal & { bucket?: number }): SpatialFocusTarget {
  const distanceScore = Math.max(0, 42 - target.distanceFeet);
  const mutualBoost = target.mutual ? 38 : 0;
  const premiumBoost = target.targetPremium ? 14 : 0;
  const bucketBoost = (target.bucket ?? 0) * 5;
  const score = distanceScore + mutualBoost + premiumBoost + bucketBoost;

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
      detail: `${focusTargets.length} nearby path${focusTargets.length === 1 ? '' : 's'} stand out with ${timeRemainingMinutes}m left.`,
      accent: '#fb7185',
    };
  }

  if (primary.reason === 'premium-nearby') {
    return {
      headline: 'A high-value path is close',
      detail: 'Beacon is highlighting the strongest live route without exposing private movement.',
      accent: '#f59e0b',
    };
  }

  return {
    headline: 'The room is starting to take shape',
    detail: `${focusTargets.length} nearby path${focusTargets.length === 1 ? '' : 's'} currently stand out.`,
    accent: mood === 'active' ? '#a78bfa' : '#60a5fa',
  };
}

/**
 * Converts the existing PresenceState into a restrained visual hierarchy.
 * It ranks only people already visible to the user and never fabricates demand,
 * identity, movement trails, or urgency.
 */
export function buildSpatialExperience(presence: PresenceState): SpatialExperienceState {
  const focusTargets = presence.visibleTargets
    .map(scoreTarget)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  const mood = determineMood(presence);
  const copy = copyForState(mood, focusTargets, presence.timeRemainingMinutes);

  return {
    mood,
    ...copy,
    focusTargets,
    hiddenOpportunityCount: Math.max(0, presence.visibleTargets.length - focusTargets.length),
  };
}

export function positionForSpatialTarget(
  target: ProximitySignal,
): [number, number, number] {
  const seed = target.targetId
    .split('')
    .reduce((accumulator, character) => accumulator + character.codePointAt(0)!, 0);
  const angle = (seed % 360) * (Math.PI / 180);
  const radius = Math.max(1, target.distanceFeet / 4);
  return [
    Math.cos(angle) * radius,
    Math.sin(angle * 0.7) * 1.5,
    Math.sin(angle) * radius,
  ];
}
