export type OutcomeIntent =
  | 'follow_up'
  | 'collaborate'
  | 'partnership'
  | 'raise_capital'
  | 'invest'
  | 'hire'
  | 'explore_role'
  | 'sell'
  | 'buy'
  | 'mentor'
  | 'seek_mentorship'
  | 'make_intro'
  | 'request_intro';

export type OutcomeHandshakeStatus =
  | 'idle'
  | 'waiting'
  | 'aligned'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'completed';

export type OutcomeActivationType =
  | 'follow_up'
  | 'build_together'
  | 'capital_conversation'
  | 'talent_conversation'
  | 'commercial_conversation'
  | 'mentorship_conversation'
  | 'introduction_exchange'
  | 'shared_intent';

export interface OutcomeHandshakeState {
  id: string | null;
  matchId: string;
  status: OutcomeHandshakeStatus;
  ownIntent: OutcomeIntent | null;
  counterpartIntent: OutcomeIntent | null;
  activationType: OutcomeActivationType | null;
  expiresAt: number | null;
}

export interface OutcomeIntentOption {
  intent: OutcomeIntent;
  label: string;
  description: string;
  strategicValue: string;
}

export interface OutcomeHandshakeEvaluation {
  state: OutcomeHandshakeState;
  headline: string;
  explanation: string;
  primaryAction: 'choose_intent' | 'wait' | 'confirm_next_step' | 'mark_complete' | 'none';
  urgency: 'calm' | 'active' | 'closing';
  remainingMinutes: number | null;
}

export const OUTCOME_INTENT_OPTIONS: OutcomeIntentOption[] = [
  {
    intent: 'follow_up',
    label: 'Follow up',
    description: 'Continue the conversation while the event context is still fresh.',
    strategicValue: 'Preserves momentum without overcommitting either side.',
  },
  {
    intent: 'collaborate',
    label: 'Build together',
    description: 'Explore a concrete collaboration, project, or working session.',
    strategicValue: 'Converts shared interest into a scoped operating conversation.',
  },
  {
    intent: 'raise_capital',
    label: 'Raise capital',
    description: 'Open a founder-to-investor capital conversation.',
    strategicValue: 'Only aligns when the counterpart independently chooses investment interest.',
  },
  {
    intent: 'invest',
    label: 'Explore investment',
    description: 'Evaluate a potential investment conversation with this founder.',
    strategicValue: 'Protects both sides from premature or one-sided fundraising pressure.',
  },
  {
    intent: 'hire',
    label: 'Hire',
    description: 'Explore bringing this person into a role, project, or advisory capacity.',
    strategicValue: 'Creates a qualified talent conversation rather than generic recruiting outreach.',
  },
  {
    intent: 'explore_role',
    label: 'Explore a role',
    description: 'Signal openness to a role, project, or operating opportunity.',
    strategicValue: 'Unlocks only when the counterpart independently indicates hiring intent.',
  },
  {
    intent: 'partnership',
    label: 'Partnership',
    description: 'Explore a commercial or strategic partnership.',
    strategicValue: 'Moves beyond exchanging contact information into a defined business pathway.',
  },
  {
    intent: 'mentor',
    label: 'Offer guidance',
    description: 'Offer a structured mentorship or advisory conversation.',
    strategicValue: 'Protects mentor time by requiring reciprocal mentorship demand.',
  },
  {
    intent: 'seek_mentorship',
    label: 'Seek guidance',
    description: 'Request a focused mentorship or advisory conversation.',
    strategicValue: 'Aligns only when the counterpart has independently offered guidance.',
  },
  {
    intent: 'make_intro',
    label: 'Offer an introduction',
    description: 'Offer to connect this person with someone relevant.',
    strategicValue: 'Turns network value into an explicit, permissioned exchange.',
  },
  {
    intent: 'request_intro',
    label: 'Request an introduction',
    description: 'Ask for a relevant introduction without exposing the request publicly.',
    strategicValue: 'Aligns only when the counterpart is willing to facilitate an introduction.',
  },
];

export function resolveOutcomeActivation(
  left: OutcomeIntent,
  right: OutcomeIntent,
): OutcomeActivationType | null {
  if (left === right) {
    if (left === 'follow_up') return 'follow_up';
    if (left === 'collaborate' || left === 'partnership') return 'build_together';
    return 'shared_intent';
  }

  const pair = `${left}:${right}`;
  const reverse = `${right}:${left}`;
  const pairs: Record<string, OutcomeActivationType> = {
    'raise_capital:invest': 'capital_conversation',
    'hire:explore_role': 'talent_conversation',
    'sell:buy': 'commercial_conversation',
    'mentor:seek_mentorship': 'mentorship_conversation',
    'make_intro:request_intro': 'introduction_exchange',
  };

  return pairs[pair] ?? pairs[reverse] ?? null;
}

export function getActivationLabel(type: OutcomeActivationType | null): string {
  switch (type) {
    case 'capital_conversation':
      return 'Capital alignment';
    case 'talent_conversation':
      return 'Talent alignment';
    case 'commercial_conversation':
      return 'Commercial alignment';
    case 'mentorship_conversation':
      return 'Mentorship alignment';
    case 'introduction_exchange':
      return 'Introduction alignment';
    case 'build_together':
      return 'Collaboration alignment';
    case 'follow_up':
      return 'Follow-up alignment';
    case 'shared_intent':
      return 'Shared intent';
    default:
      return 'Outcome alignment';
  }
}

export function evaluateOutcomeHandshake(
  state: OutcomeHandshakeState,
  now = Date.now(),
): OutcomeHandshakeEvaluation {
  const remainingMinutes = state.expiresAt == null
    ? null
    : Math.max(0, Math.ceil((state.expiresAt - now) / 60000));

  if (state.status === 'aligned') {
    return {
      state,
      headline: getActivationLabel(state.activationType),
      explanation: 'Both sides independently selected compatible next steps. Beacon revealed the alignment only after mutual intent existed.',
      primaryAction: 'confirm_next_step',
      urgency: remainingMinutes != null && remainingMinutes <= 180 ? 'closing' : 'active',
      remainingMinutes,
    };
  }

  if (state.status === 'completed') {
    return {
      state,
      headline: 'Outcome completed',
      explanation: 'This mutual produced a confirmed real-world next step.',
      primaryAction: 'none',
      urgency: 'calm',
      remainingMinutes,
    };
  }

  if (state.status === 'waiting' && state.ownIntent) {
    return {
      state,
      headline: 'Intent protected',
      explanation: 'Your selection remains private. Beacon will reveal alignment only if the other person independently chooses a compatible outcome.',
      primaryAction: 'wait',
      urgency: remainingMinutes != null && remainingMinutes <= 180 ? 'closing' : 'calm',
      remainingMinutes,
    };
  }

  if (state.status === 'expired' || (remainingMinutes === 0 && state.expiresAt != null)) {
    return {
      state: { ...state, status: 'expired' },
      headline: 'Outcome window closed',
      explanation: 'The private alignment window expired without a compatible reciprocal intent.',
      primaryAction: 'none',
      urgency: 'calm',
      remainingMinutes: 0,
    };
  }

  return {
    state,
    headline: 'Turn this mutual into an outcome',
    explanation: 'Choose the real-world next step you would accept. Your intent stays private unless a compatible choice exists on the other side.',
    primaryAction: 'choose_intent',
    urgency: 'calm',
    remainingMinutes,
  };
}
