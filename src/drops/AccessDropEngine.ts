export type AccessDropStatus =
  | 'draft'
  | 'scheduled'
  | 'open'
  | 'filled'
  | 'closed'
  | 'cancelled';

export interface AccessDrop {
  id: string;
  eventId: string;
  title: string;
  description?: string | null;
  accessType: string;
  status: AccessDropStatus;
  capacity: number;
  confirmedCount: number;
  waitlistEnabled: boolean;
  eligibleRoleKeys: string[];
  requiresVerifiedRole: boolean;
  startsAt: number;
  endsAt: number;
}

export interface DropViewerContext {
  roleKey: string | null;
  verifiedRoleKeys: string[];
  alreadyClaimed: boolean;
  isApprovedParticipant: boolean;
}

export interface DropEvaluation {
  state: 'upcoming' | 'claimable' | 'filled' | 'waitlist' | 'expired' | 'ineligible' | 'closed';
  canClaim: boolean;
  canJoinWaitlist: boolean;
  remainingCapacity: number;
  secondsUntilOpen: number;
  secondsUntilClose: number;
  urgency: 'quiet' | 'building' | 'active' | 'closing';
  headline: string;
  explanation: string;
}

function roleEligible(drop: AccessDrop, viewer: DropViewerContext): boolean {
  if (drop.eligibleRoleKeys.length === 0) return true;
  const normalized = drop.eligibleRoleKeys.map((role) => role.toLowerCase());
  const selfClaimedRole = (viewer.roleKey ?? '').toLowerCase();
  const verified = viewer.verifiedRoleKeys.map((role) => role.toLowerCase());
  return normalized.includes(selfClaimedRole) || verified.some((role) => normalized.includes(role));
}

export function evaluateAccessDrop(
  drop: AccessDrop,
  viewer: DropViewerContext,
  now = Date.now(),
): DropEvaluation {
  const remainingCapacity = Math.max(0, drop.capacity - drop.confirmedCount);
  const secondsUntilOpen = Math.max(0, Math.ceil((drop.startsAt - now) / 1000));
  const secondsUntilClose = Math.max(0, Math.ceil((drop.endsAt - now) / 1000));
  const eligibleByRole = roleEligible(drop, viewer);
  const verifiedEligible =
    !drop.requiresVerifiedRole ||
    viewer.verifiedRoleKeys.some((role) =>
      drop.eligibleRoleKeys.length === 0
        ? true
        : drop.eligibleRoleKeys.map((value) => value.toLowerCase()).includes(role.toLowerCase()),
    );

  if (!viewer.isApprovedParticipant) {
    return {
      state: 'ineligible',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen,
      secondsUntilClose,
      urgency: 'quiet',
      headline: 'Event access required',
      explanation: 'Only approved participants can enter this access window.',
    };
  }

  if (drop.status === 'cancelled' || drop.status === 'closed') {
    return {
      state: 'closed',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen,
      secondsUntilClose,
      urgency: 'quiet',
      headline: 'Access window closed',
      explanation: 'This opening is no longer accepting participants.',
    };
  }

  if (now >= drop.endsAt) {
    return {
      state: 'expired',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen: 0,
      secondsUntilClose: 0,
      urgency: 'quiet',
      headline: 'The window has expired',
      explanation: 'This access moment was intentionally time-bound.',
    };
  }

  if (!eligibleByRole || !verifiedEligible) {
    return {
      state: 'ineligible',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen,
      secondsUntilClose,
      urgency: 'quiet',
      headline: 'Reserved access',
      explanation: drop.requiresVerifiedRole
        ? 'A verified event role is required for this opening.'
        : 'This opening is reserved for a different event role.',
    };
  }

  if (viewer.alreadyClaimed) {
    return {
      state: remainingCapacity > 0 ? 'claimable' : 'filled',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen,
      secondsUntilClose,
      urgency: secondsUntilClose <= 180 ? 'closing' : 'active',
      headline: 'Your place is already recorded',
      explanation: 'Beacon will preserve your confirmed or waitlisted state.',
    };
  }

  if (now < drop.startsAt || drop.status === 'scheduled') {
    return {
      state: 'upcoming',
      canClaim: false,
      canJoinWaitlist: false,
      remainingCapacity,
      secondsUntilOpen,
      secondsUntilClose,
      urgency: secondsUntilOpen <= 300 ? 'building' : 'quiet',
      headline: secondsUntilOpen <= 300 ? 'Access is about to open' : 'Upcoming access drop',
      explanation: 'This opening becomes actionable only when its real window begins.',
    };
  }

  if (remainingCapacity === 0 || drop.status === 'filled') {
    return {
      state: drop.waitlistEnabled ? 'waitlist' : 'filled',
      canClaim: false,
      canJoinWaitlist: drop.waitlistEnabled,
      remainingCapacity: 0,
      secondsUntilOpen: 0,
      secondsUntilClose,
      urgency: secondsUntilClose <= 180 ? 'closing' : 'active',
      headline: drop.waitlistEnabled ? 'Confirmed access is full' : 'Access is fully allocated',
      explanation: drop.waitlistEnabled
        ? 'Join the ordered waitlist while the window remains active.'
        : 'The organizer set a hard capacity and no waitlist is available.',
    };
  }

  const fillRatio = drop.capacity === 0 ? 1 : drop.confirmedCount / drop.capacity;
  const urgency: DropEvaluation['urgency'] =
    secondsUntilClose <= 180
      ? 'closing'
      : fillRatio >= 0.75
        ? 'active'
        : secondsUntilClose <= 600
          ? 'building'
          : 'quiet';

  return {
    state: 'claimable',
    canClaim: true,
    canJoinWaitlist: false,
    remainingCapacity,
    secondsUntilOpen: 0,
    secondsUntilClose,
    urgency,
    headline:
      remainingCapacity === 1
        ? 'One confirmed place remains'
        : `${remainingCapacity} confirmed places remain`,
    explanation: 'Capacity, eligibility, and expiry are enforced by the database.',
  };
}

export function sortDropsByActionability(
  drops: Array<{ drop: AccessDrop; viewer: DropViewerContext }>,
  now = Date.now(),
): Array<{ drop: AccessDrop; evaluation: DropEvaluation }> {
  const priority: Record<DropEvaluation['state'], number> = {
    claimable: 0,
    waitlist: 1,
    upcoming: 2,
    filled: 3,
    ineligible: 4,
    closed: 5,
    expired: 6,
  };

  return drops
    .map(({ drop, viewer }) => ({ drop, evaluation: evaluateAccessDrop(drop, viewer, now) }))
    .sort((a, b) => {
      const stateDelta = priority[a.evaluation.state] - priority[b.evaluation.state];
      if (stateDelta !== 0) return stateDelta;
      return a.drop.endsAt - b.drop.endsAt;
    });
}
