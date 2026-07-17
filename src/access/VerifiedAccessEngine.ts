export type VerifiedRoleKey =
  | 'founder'
  | 'investor'
  | 'operator'
  | 'recruiter'
  | 'mentor'
  | 'sponsor'
  | 'organizer'
  | 'speaker'
  | 'attendee';

export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'revoked';
export type VipVisibilityMode = 'visible' | 'aggregate_only' | 'eligible_only' | 'invisible';

export interface RoleAttestation {
  roleKey: VerifiedRoleKey;
  status: VerificationStatus;
  expiresAt?: number | null;
}

export interface VipVisibilityPolicy {
  mode: VipVisibilityMode;
  inboundLimit: number;
  acceptedInboundCount: number;
  officeHoursVisible: boolean;
  allowMutualReveal: boolean;
  aggregateRoleHint: boolean;
}

export interface AccessObserverContext {
  isSameEvent: boolean;
  isMutual: boolean;
  isEligible: boolean;
  hasAcceptedOfficeHours: boolean;
}

export interface AccessDecision {
  contributesToAggregateDensity: boolean;
  revealRoleHint: boolean;
  revealIdentity: boolean;
  allowSignal: boolean;
  allowOfficeHoursRequest: boolean;
  remainingInboundCapacity: number;
  explanation: string;
}

export interface RoleGlyph {
  symbol: string;
  label: string;
  semanticTone: 'capital' | 'build' | 'operate' | 'guide' | 'host' | 'general';
}

export function hasActiveVerifiedRole(
  attestations: RoleAttestation[],
  acceptedRoles: VerifiedRoleKey[] = [],
  now = Date.now(),
): boolean {
  return attestations.some((attestation) => {
    if (attestation.status !== 'verified') return false;
    if (attestation.expiresAt != null && attestation.expiresAt <= now) return false;
    return acceptedRoles.length === 0 || acceptedRoles.includes(attestation.roleKey);
  });
}

export function evaluateVerifiedAccess({
  policy,
  observer,
}: {
  policy: VipVisibilityPolicy;
  observer: AccessObserverContext;
}): AccessDecision {
  const remainingInboundCapacity = Math.max(
    0,
    policy.inboundLimit - policy.acceptedInboundCount,
  );
  const capacityAvailable = remainingInboundCapacity > 0;
  const privilegedReveal = observer.isMutual || observer.hasAcceptedOfficeHours;

  if (!observer.isSameEvent) {
    return {
      contributesToAggregateDensity: false,
      revealRoleHint: false,
      revealIdentity: false,
      allowSignal: false,
      allowOfficeHoursRequest: false,
      remainingInboundCapacity,
      explanation: 'Identity and availability remain bound to the active event.',
    };
  }

  switch (policy.mode) {
    case 'visible':
      return {
        contributesToAggregateDensity: true,
        revealRoleHint: true,
        revealIdentity: true,
        allowSignal: capacityAvailable,
        allowOfficeHoursRequest: policy.officeHoursVisible && capacityAvailable,
        remainingInboundCapacity,
        explanation: capacityAvailable
          ? 'This participant is openly available inside the event.'
          : 'This participant has reached their inbound capacity for this event.',
      };

    case 'aggregate_only':
      return {
        contributesToAggregateDensity: true,
        revealRoleHint: policy.aggregateRoleHint,
        revealIdentity: privilegedReveal && policy.allowMutualReveal,
        allowSignal: false,
        allowOfficeHoursRequest: false,
        remainingInboundCapacity,
        explanation: privilegedReveal
          ? 'A confirmed relationship permits identity reveal.'
          : 'Presence contributes to room intelligence without exposing identity.',
      };

    case 'eligible_only':
      return {
        contributesToAggregateDensity: true,
        revealRoleHint: observer.isEligible && policy.aggregateRoleHint,
        revealIdentity:
          privilegedReveal || (observer.isEligible && capacityAvailable),
        allowSignal: observer.isEligible && capacityAvailable,
        allowOfficeHoursRequest:
          observer.isEligible && policy.officeHoursVisible && capacityAvailable,
        remainingInboundCapacity,
        explanation: observer.isEligible
          ? capacityAvailable
            ? 'Verified eligibility unlocks controlled access.'
            : 'You are eligible, but this participant has reached capacity.'
          : 'Access remains concealed until event-specific eligibility is satisfied.',
      };

    case 'invisible':
    default:
      return {
        contributesToAggregateDensity: true,
        revealRoleHint: false,
        revealIdentity: privilegedReveal && policy.allowMutualReveal,
        allowSignal: false,
        allowOfficeHoursRequest: false,
        remainingInboundCapacity,
        explanation: privilegedReveal
          ? 'Identity is visible because access was mutually confirmed.'
          : 'This participant has chosen complete event-scoped invisibility.',
      };
  }
}

const ROLE_GLYPHS: Record<VerifiedRoleKey, RoleGlyph> = {
  founder: { symbol: 'F', label: 'Founder', semanticTone: 'build' },
  investor: { symbol: 'I', label: 'Investor', semanticTone: 'capital' },
  operator: { symbol: 'O', label: 'Operator', semanticTone: 'operate' },
  recruiter: { symbol: 'R', label: 'Recruiter', semanticTone: 'operate' },
  mentor: { symbol: 'M', label: 'Mentor', semanticTone: 'guide' },
  sponsor: { symbol: 'S', label: 'Sponsor', semanticTone: 'capital' },
  organizer: { symbol: 'H', label: 'Host', semanticTone: 'host' },
  speaker: { symbol: 'P', label: 'Speaker', semanticTone: 'guide' },
  attendee: { symbol: 'A', label: 'Attendee', semanticTone: 'general' },
};

export function getRoleGlyph(role: VerifiedRoleKey): RoleGlyph {
  return ROLE_GLYPHS[role];
}
