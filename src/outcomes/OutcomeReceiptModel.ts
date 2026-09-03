export const OUTCOME_RECEIPT_TYPES = [
  'spoke',
  'contact_exchanged',
  'follow_up_sent',
  'meeting_scheduled',
  'office_hours_occurred',
  'warm_introduction_completed',
  'hiring_conversation_continued',
  'partnership_conversation_continued',
  'mentor_session_occurred',
  'collaboration_continued',
  'feedback_received',
  'still_open',
  'no_further_action',
] as const;

export type OutcomeReceiptType = (typeof OUTCOME_RECEIPT_TYPES)[number];

export type OutcomeReceiptLifecycleState = 'none' | 'submitted' | 'withdrawn';
export type OutcomeReceiptAlignmentState =
  | 'none'
  | 'participant-attested'
  | 'counterpart-compatible'
  | 'bilaterally-confirmed'
  | 'withdrawn';

export type OutcomeReceiptOriginContext =
  | 'direct-mutual'
  | 'declared-fit-mutual'
  | 'explicit-physical-handshake'
  | 'focus-window'
  | 'office-hours'
  | 'warm-introduction'
  | 'community-exchange';

export type OutcomeReceiptSystemEvidence =
  | 'verified-mutual'
  | 'declared-fit-mutual'
  | 'explicit-local-handshake'
  | 'server-live-handshake'
  | 'office-hours-completed'
  | 'warm-introduction-accepted'
  | 'focus-window-shared-opt-in'
  | 'community-exchange-context';

export interface OutcomeReceiptDefinition {
  type: OutcomeReceiptType;
  label: string;
  description: string;
  category: 'interaction' | 'follow-through' | 'session' | 'domain-progress' | 'state';
}

export const OUTCOME_RECEIPT_DEFINITIONS: readonly OutcomeReceiptDefinition[] = [
  {
    type: 'spoke',
    label: 'We spoke',
    description: 'You are attesting that a real conversation happened.',
    category: 'interaction',
  },
  {
    type: 'contact_exchanged',
    label: 'Contact details exchanged',
    description: 'You deliberately exchanged a way to continue the conversation.',
    category: 'interaction',
  },
  {
    type: 'follow_up_sent',
    label: 'Follow-up sent',
    description: 'You sent a follow-up after the mutual connection.',
    category: 'follow-through',
  },
  {
    type: 'meeting_scheduled',
    label: 'Meeting scheduled',
    description: 'A future meeting or working conversation was scheduled.',
    category: 'follow-through',
  },
  {
    type: 'office_hours_occurred',
    label: 'Office Hours happened',
    description: 'You are attesting that the Office Hours conversation actually occurred.',
    category: 'session',
  },
  {
    type: 'warm_introduction_completed',
    label: 'Warm introduction completed',
    description: 'The warm introduction moved from permission into an actual introduction.',
    category: 'follow-through',
  },
  {
    type: 'hiring_conversation_continued',
    label: 'Hiring conversation continued',
    description: 'The relationship moved into an additional hiring or role conversation.',
    category: 'domain-progress',
  },
  {
    type: 'partnership_conversation_continued',
    label: 'Partnership conversation continued',
    description: 'The relationship moved into an additional partnership conversation.',
    category: 'domain-progress',
  },
  {
    type: 'mentor_session_occurred',
    label: 'Mentor session happened',
    description: 'You are attesting that a mentorship or advisory session occurred.',
    category: 'session',
  },
  {
    type: 'collaboration_continued',
    label: 'Collaboration continued',
    description: 'The relationship progressed into additional work or collaboration discussion.',
    category: 'domain-progress',
  },
  {
    type: 'feedback_received',
    label: 'Feedback received',
    description: 'You received substantive feedback through the relationship.',
    category: 'domain-progress',
  },
  {
    type: 'still_open',
    label: 'Still open',
    description: 'The relationship remains open, but no more specific next step is ready to record.',
    category: 'state',
  },
  {
    type: 'no_further_action',
    label: 'No further action',
    description: 'You do not expect another step from this connection right now.',
    category: 'state',
  },
] as const;

const DEFINITION_BY_TYPE = new Map(
  OUTCOME_RECEIPT_DEFINITIONS.map((definition) => [definition.type, definition] as const),
);

export function getOutcomeReceiptDefinition(type: OutcomeReceiptType): OutcomeReceiptDefinition {
  return DEFINITION_BY_TYPE.get(type) ?? {
    type,
    label: type.replaceAll('_', ' '),
    description: 'Participant-attested outcome state.',
    category: 'state',
  };
}

/**
 * Mirrors the deliberately conservative server compatibility map. This exists
 * only to explain an already-authorized server result in the UI; the database
 * remains authoritative for whether counterpart evidence may be disclosed.
 */
export function resolveOutcomeReceiptCompatibility(
  left: OutcomeReceiptType,
  right: OutcomeReceiptType,
): 'exact' | 'meeting-progression' | 'session-occurred' | 'conversation-occurred' | 'continued-work' | null {
  if (left === right) return 'exact';

  const pair = `${left}:${right}`;
  const reverse = `${right}:${left}`;
  const semanticPairs: Record<string, Exclude<ReturnType<typeof resolveOutcomeReceiptCompatibility>, 'exact' | null>> = {
    'meeting_scheduled:office_hours_occurred': 'meeting-progression',
    'mentor_session_occurred:office_hours_occurred': 'session-occurred',
    'spoke:office_hours_occurred': 'conversation-occurred',
    'partnership_conversation_continued:collaboration_continued': 'continued-work',
  };
  return semanticPairs[pair] ?? semanticPairs[reverse] ?? null;
}

export function getOutcomeReceiptOriginLabel(context: OutcomeReceiptOriginContext): string {
  switch (context) {
    case 'warm-introduction': return 'Followed a Beacon warm introduction';
    case 'office-hours': return 'Followed completed Beacon Office Hours context';
    case 'explicit-physical-handshake': return 'Supported by an explicit Beacon physical handshake';
    case 'focus-window': return 'Followed a shared Beacon focus-window opt-in';
    case 'community-exchange': return 'Occurred in an approved community-exchange context';
    case 'declared-fit-mutual': return 'Mutual carried explicit declared-fit context';
    default: return 'Followed a verified Beacon mutual';
  }
}

export function getOutcomeReceiptEvidenceLabel(evidence: OutcomeReceiptSystemEvidence): string {
  switch (evidence) {
    case 'verified-mutual': return 'Verified mutual';
    case 'declared-fit-mutual': return 'Declared-fit mutual';
    case 'explicit-local-handshake': return 'Offline-reconciled physical handshake';
    case 'server-live-handshake': return 'Live-server physical handshake';
    case 'office-hours-completed': return 'Completed Office Hours record';
    case 'warm-introduction-accepted': return 'Accepted warm introduction';
    case 'focus-window-shared-opt-in': return 'Shared focus-window opt-in';
    case 'community-exchange-context': return 'Approved community exchange';
  }
}
