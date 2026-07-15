import { supabase } from '../lib/supabase';
import type {
  OutcomeActivationType,
  OutcomeHandshakeState,
  OutcomeHandshakeStatus,
  OutcomeIntent,
} from '../outcomes/OutcomeHandshakeEngine';

interface OutcomeStateRow {
  handshake_id: string | null;
  handshake_status: Exclude<OutcomeHandshakeStatus, 'idle'> | null;
  own_intent: OutcomeIntent | null;
  counterpart_intent: OutcomeIntent | null;
  activation_type: OutcomeActivationType | null;
  expires_at: string | null;
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

function mapState(matchId: string, row: OutcomeStateRow): OutcomeHandshakeState {
  return {
    id: row.handshake_id,
    matchId,
    status: row.handshake_status ?? (row.own_intent ? 'waiting' : 'idle'),
    ownIntent: row.own_intent,
    counterpartIntent: row.counterpart_intent,
    activationType: row.activation_type,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
  };
}

export async function getOutcomeHandshakeState(
  matchId: string,
  userId: string,
): Promise<OutcomeHandshakeState> {
  if (!matchId || !userId) return emptyState(matchId);

  const { data, error } = await supabase
    .rpc('get_outcome_handshake_state', { p_match_id: matchId })
    .single();

  if (error || !data) {
    if (error) console.error('[outcome-handshake.service] state:', error);
    return emptyState(matchId);
  }

  return mapState(matchId, data as OutcomeStateRow);
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
