import { supabase } from '../lib/supabase';
import type {
  OutcomeActivationType,
  OutcomeHandshakeState,
  OutcomeHandshakeStatus,
  OutcomeIntent,
} from '../outcomes/OutcomeHandshakeEngine';
import { recordDecisionProvenance } from './decision-provenance.service';

interface OutcomeStateRow {
  handshake_id: string | null;
  handshake_status: Exclude<OutcomeHandshakeStatus, 'idle'> | null;
  own_intent: OutcomeIntent | null;
  counterpart_intent: OutcomeIntent | null;
  activation_type: OutcomeActivationType | null;
  expires_at: string | null;
  own_confirmed: boolean | null;
  counterpart_confirmed: boolean | null;
  confirmation_count: number | null;
}

interface ProposeOutcomeRow {
  handshake_id: string;
  handshake_status: Exclude<OutcomeHandshakeStatus, 'idle'>;
  own_intent: OutcomeIntent;
  counterpart_intent: OutcomeIntent | null;
  activation_type: OutcomeActivationType | null;
  expires_at: string;
}

interface MatchContextRow {
  event_id: string;
  user_a_id: string;
  user_b_id: string;
}

interface ConfirmOutcomeRow {
  accepted: boolean;
  event_id: string;
  handshake_status: Exclude<OutcomeHandshakeStatus, 'idle'>;
  own_confirmed: boolean;
  counterpart_confirmed: boolean;
  confirmation_count: number;
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
    ownConfirmed: false,
    counterpartConfirmed: false,
    confirmationCount: 0,
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
    ownConfirmed: row.own_confirmed === true,
    counterpartConfirmed: row.counterpart_confirmed === true,
    confirmationCount: Math.max(0, Math.min(2, row.confirmation_count ?? 0)),
  };
}

async function getMatchContext(matchId: string): Promise<MatchContextRow | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('event_id, user_a_id, user_b_id')
    .eq('id', matchId)
    .maybeSingle();
  if (error || !data) return null;
  return data as MatchContextRow;
}

export async function getOutcomeHandshakeState(
  matchId: string,
  userId: string,
): Promise<OutcomeHandshakeState> {
  if (!matchId || !userId) return emptyState(matchId);

  const { data, error } = await supabase
    .rpc('get_outcome_handshake_commit_state', { p_match_id: matchId })
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
  const matchContextPromise = getMatchContext(input.matchId);
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
  const context = await matchContextPromise;
  if (context) {
    void recordDecisionProvenance({
      eventId: context.event_id,
      domain: 'outcome_handshake',
      outcome: row.handshake_status === 'aligned' ? 'align' : 'defer',
      reasonCodes: row.handshake_status === 'aligned'
        ? ['compatible_reciprocal_intent']
        : ['counterpart_intent_not_yet_aligned'],
      policyVersion: 'outcome-handshake-v2',
      expiresAt: row.expires_at,
      metadata: {
        intent: input.intent,
        status: row.handshake_status,
        activationType: row.activation_type,
      },
    });
  }

  // Re-read through the confirmation-aware state surface. This guarantees the
  // client never fabricates confirmation fields after a proposal response.
  return getOutcomeHandshakeState(input.matchId, 'authenticated');
}

export async function completeOutcomeHandshake(handshakeId: string): Promise<boolean> {
  if (!handshakeId) return false;

  const { data, error } = await supabase
    .rpc('confirm_outcome_handshake', { p_handshake_id: handshakeId })
    .single();

  if (error || !data) {
    console.error('[outcome-handshake.service] confirm:', error);
    return false;
  }

  const row = data as ConfirmOutcomeRow;
  if (row.accepted && row.event_id) {
    void recordDecisionProvenance({
      eventId: row.event_id,
      domain: 'outcome_handshake',
      outcome: row.handshake_status === 'completed' ? 'complete' : 'align',
      reasonCodes: row.handshake_status === 'completed'
        ? ['two_party_real_world_outcome_confirmed']
        : ['participant_confirmation_recorded_waiting_counterpart'],
      policyVersion: 'outcome-handshake-v2',
      metadata: {
        handshakeId,
        status: row.handshake_status,
        confirmationCount: row.confirmation_count,
      },
    });
  }

  return row.accepted === true;
}
