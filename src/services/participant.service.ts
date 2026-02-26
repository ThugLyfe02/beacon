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
 * Request to join an event
 */
export async function requestToJoinEvent(
  eventId: string,
  userId: string
): Promise<EventParticipantRow> {
  console.log('[participant.service] Creating join request:', { eventId, userId });

  const { data, error } = await supabase
    .from('event_participants')
    .insert({
      event_id: eventId,
      user_id: userId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    console.error('[participant.service] Error creating join request:', error);
    console.error('[participant.service] Error code:', error.code);

    // Handle duplicate request
    if (error.code === '23505') {
      console.log('[participant.service] Duplicate request, fetching existing');
      const { data: existing } = await supabase
        .from('event_participants')
        .select('*')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .single();

      if (existing) {
        console.log('[participant.service] Existing request found:', existing);
        return existing;
      }
    }
    throw new Error('Failed to request join');
  }

  console.log('[participant.service] Join request created successfully:', data);
  return data;
}

/**
 * Join event with access code (auto-approve if code is valid)
 */
export async function joinEventWithCode(
  eventId: string,
  userId: string,
  accessCode: string
): Promise<EventParticipantRow> {
  // First create pending participant
  const participant = await requestToJoinEvent(eventId, userId);

  // Try to approve with code
  const { data: approved, error } = await supabase.rpc('approve_participant_with_code', {
    p_event_id: eventId,
    p_user_id: userId,
    p_access_code: accessCode,
  });

  if (error || !approved) {
    console.error('[participant.service] Invalid access code');
    throw new Error('Invalid access code');
  }

  // Fetch updated participant
  const { data: updated } = await supabase
    .from('event_participants')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .single();

  return updated || participant;
}

/**
 * Get pending join requests for an event (host only)
 */
export async function getPendingJoinRequests(
  eventId: string
): Promise<PendingJoinRequest[]> {
  console.log('[participant.service] Fetching pending requests for event:', eventId);

  const { data, error } = await supabase
    .from('event_participants')
    .select('*, users(*)')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('[participant.service] Error fetching pending requests:', error);
    console.error('[participant.service] Error code:', error.code);
    console.error('[participant.service] Error message:', error.message);
    throw new Error('Failed to fetch pending requests');
  }

  console.log('[participant.service] Raw data from query:', data);
  console.log('[participant.service] Number of pending rows:', data?.length || 0);

  return (data || []).map((row: any) => ({
    participant_id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    joined_at: row.joined_at,
    name: row.users.name,
    email: row.users.email,
    role: row.users.role,
    one_liner: row.users.one_liner,
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
    .single();

  if (error) {
    console.error('[participant.service] Error approving join request:', error);
    throw new Error('Failed to approve request');
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
    .single();

  if (error) {
    console.error('[participant.service] Error rejecting join request:', error);
    throw new Error('Failed to reject request');
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
  let query = supabase
    .from('event_participants')
    .select('*, users(*)')
    .eq('event_id', eventId)
    .eq('status', 'approved')
    .order('joined_at', { ascending: false });

  if (excludeUserId) {
    query = query.neq('user_id', excludeUserId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[participant.service] Error fetching approved participants:', error);
    throw new Error('Failed to fetch participants');
  }

  return (data || []).map((row: any) => ({
    participant_id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    status: row.status,
    joined_at: row.joined_at,
    email: row.users.email,
    name: row.users.name,
    role: row.users.role,
    one_liner: row.users.one_liner,
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
