export type PartnerCommitmentType =
  | 'mentor_slots'
  | 'office_hours_slots'
  | 'hiring_conversations'
  | 'technical_review_sessions'
  | 'founder_seats'
  | 'investor_advisor_sessions'
  | 'workshops'
  | 'focus_windows'
  | 'speaker_sessions'
  | 'facilitator_hours'
  | 'community_member_capacity'
  | 'domain_support_capacity';

export type PartnerCommitmentScopeKind = 'program-template' | 'event-exchange';

export type PartnerCommitmentPartyKind = 'community' | 'event-host';

export type PartnerCommitmentStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'scheduled'
  | 'delivering'
  | 'fulfilled'
  | 'partially_fulfilled'
  | 'cancelled'
  | 'not_fulfilled';

export type PartnerCommitmentAcceptanceState =
  | 'awaiting-acceptance'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

export type PartnerCommitmentMeasurementState =
  | 'not-applicable'
  | 'not-measured'
  | 'measured'
  | 'partial'
  | 'suppressed'
  | 'manual-only'
  | 'insufficient-evidence';

export type PartnerCommitmentEvidenceQuality =
  | 'server-recorded'
  | 'participant-attested-aggregate'
  | 'manual-operator'
  | 'mixed'
  | 'insufficient';

export type PartnerCommitmentMeasurementReviewState =
  | 'not-required'
  | 'pending'
  | 'acknowledged'
  | 'disputed';

export interface PartnerCommitmentOption {
  type: PartnerCommitmentType;
  label: string;
  unitLabel: string;
  description: string;
  domainRecommended: boolean;
}

export const PARTNER_COMMITMENT_OPTIONS: readonly PartnerCommitmentOption[] = [
  {
    type: 'mentor_slots',
    label: 'Mentor slots',
    unitLabel: 'slots',
    description: 'Structured mentor availability contributed to the shared program.',
    domainRecommended: true,
  },
  {
    type: 'office_hours_slots',
    label: 'Office Hours slots',
    unitLabel: 'slots',
    description: 'One-to-one Office Hours capacity made available through Beacon.',
    domainRecommended: false,
  },
  {
    type: 'hiring_conversations',
    label: 'Hiring conversations',
    unitLabel: 'conversations',
    description: 'Capacity for structured hiring or role conversations.',
    domainRecommended: true,
  },
  {
    type: 'technical_review_sessions',
    label: 'Technical review sessions',
    unitLabel: 'sessions',
    description: 'Bounded technical or product review sessions.',
    domainRecommended: true,
  },
  {
    type: 'founder_seats',
    label: 'Founder seats',
    unitLabel: 'seats',
    description: 'Capacity reserved for founders in a defined program surface.',
    domainRecommended: false,
  },
  {
    type: 'investor_advisor_sessions',
    label: 'Investor / advisor sessions',
    unitLabel: 'sessions',
    description: 'Structured investor or advisor availability.',
    domainRecommended: true,
  },
  {
    type: 'workshops',
    label: 'Workshops',
    unitLabel: 'workshops',
    description: 'Discrete workshops delivered as part of the partnership.',
    domainRecommended: true,
  },
  {
    type: 'focus_windows',
    label: 'Focus windows',
    unitLabel: 'windows',
    description: 'Host-published Beacon Focus Windows contributed to the program.',
    domainRecommended: true,
  },
  {
    type: 'speaker_sessions',
    label: 'Speaker / session contribution',
    unitLabel: 'sessions',
    description: 'Speaker or programmed session contribution.',
    domainRecommended: true,
  },
  {
    type: 'facilitator_hours',
    label: 'Facilitator hours',
    unitLabel: 'hours',
    description: 'Facilitator time explicitly committed to the partnership.',
    domainRecommended: false,
  },
  {
    type: 'community_member_capacity',
    label: 'Community member capacity',
    unitLabel: 'places',
    description: 'Event capacity a community commits to make available to its members.',
    domainRecommended: false,
  },
  {
    type: 'domain_support_capacity',
    label: 'Domain-specific support capacity',
    unitLabel: 'units',
    description: 'Explicit support capacity in one reviewed Beacon event-focus domain.',
    domainRecommended: true,
  },
] as const;

export const PARTNER_COMMITMENT_TYPES = PARTNER_COMMITMENT_OPTIONS.map((option) => option.type);

export function getPartnerCommitmentOption(type: PartnerCommitmentType): PartnerCommitmentOption {
  return PARTNER_COMMITMENT_OPTIONS.find((option) => option.type === type) ?? PARTNER_COMMITMENT_OPTIONS[0];
}

export function formatPartnerCommitmentQuantity(value: number | null, type: PartnerCommitmentType): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${getPartnerCommitmentOption(type).unitLabel}`;
}
