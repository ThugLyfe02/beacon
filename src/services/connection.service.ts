// =============================================================================
// Beacon MVP — Connection Service
// =============================================================================
import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  ConnectionRequestRow,
  MatchRow,
  MutualMatchResult,
} from '../types/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendConnectionRequestResult {
  request: ConnectionRequestRow | null;
  match: MatchRow | null;
  error: PostgrestError | { message: string } | null;
}

export interface WithdrawRequestResult {
  data: ConnectionRequestRow | null;
  error: PostgrestError | null;
}

export interface ListRequestsResult {
  data: ConnectionRequestRow[];
  error: PostgrestError | null;
}

export interface DetectMutualMatchResult {
  match: MatchRow | null;
  error: PostgrestError | { message: string } | null;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Create a connection request from requester → recipient and, if there's
 * already a reciprocal pending request, record a mutual match.
 */
export async function sendConnectionRequest(
  eventId: string,
  requesterId: string,
  recipientId: string
): Promise<SendConnectionRequestResult> {
  // 1) Insert connection request
  const { data: request, error: requestError } = await supabase
    .from('connection_requests')
    .insert({
      event_id: eventId,
      requester_id: requesterId,
      recipient_id: recipientId,
    })
    .select('*')
    .single();

  if (requestError || !request) {
    return {
      request: null,
      match: null,
      error: requestError ?? { message: 'Failed to send connection request.' },
    };
  }

  // 2) Check for mutual match via RPC
  const { match, error: matchError } = await detectMutualMatch(
    eventId,
    requesterId,
    recipientId
  );

  if (matchError) {
    // Request succeeded, but we couldn't determine match state.
    // Surface as non-fatal: the UI will just show "Sent".
    return {
      request,
      match: null,
      error: null,
    };
  }

  return {
    request,
    match,
    error: null,
  };
}

/**
 * Withdraw (cancel) a pending connection request.
 * Only the original requester may withdraw (enforced by RLS).
 */
export async function withdrawRequest(
  requestId: string
): Promise<WithdrawRequestResult> {
  const { data, error } = await supabase
    .from('connection_requests')
    .update({ status: 'withdrawn' as const })
    .eq('id', requestId)
    .select('*')
    .single();

  return { data, error };
}

/**
 * List all connection requests for a user within a given event,
 * both sent and received, ordered by most recent first.
 */
export async function listRequests(
  eventId: string,
  userId: string
): Promise<ListRequestsResult> {
  const { data, error } = await supabase
    .from('connection_requests')
    .select('*')
    .eq('event_id', eventId)
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  return { data: data ?? [], error };
}

/**
 * Call the detect_mutual_match RPC to check whether a reciprocal
 * pending request exists and, if so, idempotently create a match row.
 */
export async function detectMutualMatch(
  eventId: string,
  requesterId: string,
  recipientId: string
): Promise<DetectMutualMatchResult> {
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc('detect_mutual_match', {
      p_event_id: eventId,
      p_requester_id: requesterId,
      p_recipient_id: recipientId,
    })
    .returns<MutualMatchResult[]>();

  if (rpcError) {
    return { match: null, error: rpcError };
  }

  const mutualMatch =
    Array.isArray(rpcResult) && rpcResult.length > 0
      ? (rpcResult[0] as MatchRow)
      : null;

  return { match: mutualMatch, error: null };
}
