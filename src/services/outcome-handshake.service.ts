import { supabase } from '../lib/supabase';
import type {
  OutcomeActivationType,
  OutcomeHandshakeState,
  OutcomeHandshakeStatus,
  OutcomeIntent,
} from '../outcomes/OutcomeHandshakeEngine';

interface OutcomeHandshakeRow {
  id: string;
  match_id: string;
  status: Exclude<OutcomeHandshakeStatus, 'idle'>;
  intent_a: OutcomeIntent | null;
  intent_b: OutcomeIntent | null;
  activation_type: OutcomeActivationType | null;
  expires_at: string;
  user_a_id: string;
  user_b_id: string;
}

interface OwnIntentRow {
  match_id: string;
  user_id: string;
  intent: OutcomeIntent;
  expires_at: string;
}

interface ProposeOutcomeRow {
  handshake_id: string;
  handshake_status: Exclude<OutcomeHandshakeStatus, 'idle'>;
  own_intent: OutcomeIntent;
  counterpart_intent: OutcomeIntent | null;
  activation_type: OutcomeActivationType | null;
  expires_at: string;
}

function createIdempotencyNonce(): string {
  const random = Math.random().toString(36).slice(2);
  const second = Math.random().toString(36).slice(2);
  return `outcome-${Date.now().toString(36)}-${random}${second}`.slice(0, 120);
}

function emptyState(matchId: string): OutcomeHandshakeState {
  return {
    id: null,
    matchId,
    status: 'idle',
    ownIntent: null,
    counterpartIntent: null,
    activationType: null,
    expiresAt: null,
  };
}

export async function getOutcomeHandshakeState(
  matchId: string,
  userId: string,
): Promise<OutcomeHandshakeState> {
  if (!matchId || !userId) return emptyState(matchId);

  const [{ data: ownIntentData, error: ownIntentError }, { data: handshakeData, error: handshakeError }] = await Promise.all([
    supabase
      .from('opportunity_intent_signals')
      .select('match_id, user_id, intent, expires_at')
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('outcome_handshakes')
      .select('id, match_id, status, intent_a, intent_b, activation_type, expires_at, user_a_id, user_b_id')
      .eq('match_id', matchId)
      .maybeSingle(),
  ]);

  if (ownIntentError) {
    console.error('[outcome-handshake.service] own intent:', ownIntentError);
  }
  if (handshakeError) {
    console.error('[outcome-handshake.service] handshake:', handshakeError);
  }

  const ownIntent = (ownIntentData as OwnIntentRow | null)?.intent ?? null;
  const handshake = handshakeData as OutcomeHandshakeRow | null;
  if (!handshake) {
    return {
      ...emptyState(matchId),
      status: ownIntent ? 'waiting' : 'idle',
      ownIntent,
      expiresAt: ownIntentData
        ? new Date((ownIntentData as OwnIntentRow).expires_at).getTime()
        : null,
    };
  }

  const isA = handshake.user_a_id === userId;
  const counterpartIntent = handshake.status === 'aligned' || handshake.status === 'completed'
    ? (isA ? handshake.intent_b : handshake.intent_a)
    : null;

  return {
    id: handshake.id,
    matchId,
    status: handshake.status,
    ownIntent,
    counterpartIntent,
    activationType: handshake.activation_type,
    expiresAt: new Date(handshake.expires_at).getTime(),
  };
}

export async function proposeOutcomeHandshake(input: {
  matchId: string;
  intent: OutcomeIntent;
  note?: string | null;
}): Promise<OutcomeHandshakeState> {
  const { data, error } = await supabase
    .rpc('propose_outcome_handshake', {
      p_match_id: input.matchId,
      p_intent: input.intent,
      p_note: input.note?.trim() || null,
      p_nonce: createIdempotencyNonce(),
    })
    .single();

  if (error || !data) {
    console.error('[outcome-handshake.service] propose:', error);
    throw new Error(error?.message ?? 'Unable to protect this outcome intent.');
  }

  const row = data as ProposeOutcomeRow;
  return {
    id: row.handshake_id,
    matchId: input.matchId,
    status: row.handshake_status,
    ownIntent: row.own_intent,
    counterpartIntent: row.counterpart_intent,
    activationType: row.activation_type,
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

export async function completeOutcomeHandshake(handshakeId: string): Promise<boolean> {
  if (!handshakeId) return false;
  const { data, error } = await supabase.rpc('complete_outcome_handshake', {
    p_handshake_id: handshakeId,
  });

  if (error) {
    console.error('[outcome-handshake.service] complete:', error);
    return false;
  }

  return data === true;
}
