// =============================================================================
// participant.service.ts
// Event participant and join request management
// =============================================================================

import { supabase } from '../lib/supabase';
import type {
  EventParticipantRow,
  DiscoverableParticipant,
  PendingJoinRequest,
  ParticipantStatus,
} from '../types/database';

/**
 * Request to join an event. The server binds membership to auth.uid(); userId is
 * retained only for compatibility with existing callers and is not trusted.
 */
export async function requestToJoinEvent(
  eventId: string,
  _userId: string
): Promise<EventParticipantRow> {
  console.log('[participant.service] Calling request_to_join_event RPC:', { eventId });

  const { data, error } = await supabase.rpc('request_to_join_event', {
    p_event_id: eventId,
  });

  if (error) {
    console.error('[participant.service] request_to_join_event error:', error);
    throw new Error(error.message ?? 'Failed to request join');
  }
  const row = Array.isArray(data) ? data[0] : (data as EventParticipantRow);
  if (!row) throw new Error('Join did not return a row');
  return row;
}

/**
 * Pending join requests for the current user (events they've requested but
 * not yet been approved into). Used to render the "awaiting approval" state.
 */
export async function getMyPendingRequests(): Promise<
  Array<{
    participant_id: string;
    event_id: string;
    event_name: string;
    joined_at: string;
  }>
> {
  const { data, error } = await supabase.rpc('get_my_pending_requests');
  if (error) {
    console.error('[participant.service] get_my_pending_requests error:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Join an event using its server-held access code. The approval RPC no longer
 * accepts a caller-selected user id; the database approves auth.uid() only.
 */
export async function joinEventWithCode(
  eventId: string,
  userId: string,
  accessCode: string
): Promise<EventParticipantRow> {
  const participant = await requestToJoinEvent(eventId, userId);

  const { data: approved, error } = await supabase.rpc('approve_self_with_event_code', {
    p_event_id: eventId,
    p_access_code: accessCode.trim(),
  });

  if (error || !approved) {
    console.error('[participant.service] Access-code approval failed:', error?.message ?? 'code rejected');
    throw new Error('Invalid or expired event access code');
  }

  const { data: updated, error: fetchError } = await supabase
    .from('event_participants')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    console.error('[participant.service] approved membership refresh failed:', fetchError);
  }
  return (updated as EventParticipantRow | null) ?? participant;
}

/**
 * Get pending join requests for an event (host only)
 */
export async function getPendingJoinRequests(
  eventId: string
): Promise<PendingJoinRequest[]> {
  const { data, error } = await supabase.rpc('get_pending_join_requests', {
    p_event_id: eventId,
  });

  if (error) {
    console.error('[participant.service] Error fetching pending requests:', error);
    throw new Error(error.message ?? 'Failed to fetch participants');
  }

  return (data ?? []).map((row: any) => ({
    participant_id: row.participant_id,
    user_id: row.user_id,
    event_id: row.event_id,
    joined_at: row.joined_at,
    name: row.name ?? null,
    email: row.email ?? null,
    role: row.role ?? null,
    one_liner: row.one_liner ?? null,
  }));
}

/**
 * Approve a join request (host only)
 */
export async function approveJoinRequest(
  participantId: string
): Promise<EventParticipantRow> {
  const { data, error } = await supabase
    .from('event_participants')
    .update({ status: 'approved' })
    .eq('id', participantId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[participant.service] approveJoinRequest error:', error);
    throw new Error(error.message ?? 'Failed to approve request');
  }
  if (!data) {
    throw new Error(
      'Approval was blocked by the database (RLS). Apply migration 004 + 008 to grant the host UPDATE access on event_participants.'
    );
  }
  return data;
}

/**
 * Reject a join request (host only)
 */
export async function rejectJoinRequest(
  participantId: string
): Promise<EventParticipantRow> {
  const { data, error } = await supabase
    .from('event_participants')
    .update({ status: 'rejected' })
    .eq('id', participantId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[participant.service] rejectJoinRequest error:', error);
    throw new Error(error.message ?? 'Failed to reject request');
  }
  if (!data) {
    throw new Error(
      'Rejection was blocked by the database (RLS). Apply migration 004 + 008 to grant the host UPDATE access on event_participants.'
    );
  }
  return data;
}

/**
 * Leave an event (remove participation)
 */
export async function leaveEvent(eventId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('event_participants')
    .delete()
    .eq('event_id', eventId)
    .eq('user_id', userId);

  if (error) {
    console.error('[participant.service] Error leaving event:', error);
    throw new Error('Failed to leave event');
  }
}

/**
 * Get all approved participants for an event (for networking/discovery)
 */
export async function getApprovedParticipants(
  eventId: string,
  excludeUserId?: string
): Promise<DiscoverableParticipant[]> {
  const { data, error } = await supabase.rpc('get_event_approved_participants', {
    p_event_id: eventId,
    p_exclude_user_id: excludeUserId ?? null,
  });

  if (error) {
    console.error('[participant.service] Error fetching approved participants:', error);
    throw new Error(error.message ?? 'Failed to fetch participants');
  }

  return (data ?? []).map((row: any) => ({
    participant_id: row.participant_id,
    user_id: row.user_id,
    event_id: row.event_id,
    status: row.status,
    joined_at: row.joined_at,
    email: row.email ?? null,
    name: row.name ?? null,
    role: row.role ?? null,
    one_liner: row.one_liner ?? null,
    is_premium: !!row.is_premium,
  }));
}

/**
 * Get user's participant status for an event
 */
export async function getParticipantStatus(
  eventId: string,
  userId: string
): Promise<ParticipantStatus | null> {
  const { data, error } = await supabase
    .from('event_participants')
    .select('status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.status;
}

/**
 * Get user's pending join requests with event details
 */
export async function getUserPendingRequests(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('event_participants')
    .select('*, events(*)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('[participant.service] Error fetching user pending requests:', error);
    throw new Error('Failed to fetch pending requests');
  }

  return (data || []).map((row: any) => ({
    participant_id: row.id,
    event_id: row.event_id,
    status: row.status,
    joined_at: row.joined_at,
    event: row.events,
  }));
}
