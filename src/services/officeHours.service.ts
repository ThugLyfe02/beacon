// =============================================================================
// officeHours.service.ts
// Evidence-backed Office Hours requests between approved event attendees.
// =============================================================================

import { supabase } from '../lib/supabase';

export type OfficeHoursStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'awaiting_escort'
  | 'completed';

export interface OfficeHoursRequest {
  id: string;
  event_id: string;
  requester_id: string;
  recipient_id: string;
  proposed_start: string;
  proposed_end: string;
  status: OfficeHoursStatus;
  created_at: string;
  responded_at: string | null;
}

export interface OfficeHoursRequestWithPeer extends OfficeHoursRequest {
  peer_name: string | null;
  peer_role: string | null;
  direction: 'incoming' | 'outgoing';
}

export interface OfficeHoursCompletionState {
  requestId: string;
  status: OfficeHoursStatus;
  ownConfirmed: boolean;
  counterpartConfirmed: boolean;
  confirmationCount: number;
}

interface CompletionStateRow {
  request_id: string;
  status: OfficeHoursStatus;
  own_confirmed: boolean;
  counterpart_confirmed: boolean;
  confirmation_count: number;
}

function createIdempotencyNonce(): string {
  const first = Math.random().toString(36).slice(2);
  const second = Math.random().toString(36).slice(2);
  return `office-hours-${Date.now().toString(36)}-${first}${second}`.slice(0, 120);
}

function mapCompletionState(row: CompletionStateRow): OfficeHoursCompletionState {
  return {
    requestId: row.request_id,
    status: row.status,
    ownConfirmed: row.own_confirmed,
    counterpartConfirmed: row.counterpart_confirmed,
    confirmationCount: row.confirmation_count,
  };
}

export async function createOfficeHoursRequest(input: {
  eventId: string;
  requesterId: string;
  recipientId: string;
  proposedStart: Date;
  proposedEnd: Date;
}): Promise<OfficeHoursRequest> {
  if (!input.eventId || !input.requesterId || !input.recipientId) {
    throw new Error('Event and participants are required');
  }
  if (input.proposedEnd.getTime() <= input.proposedStart.getTime()) {
    throw new Error('Office Hours end time must be after start time');
  }

  const { data, error } = await supabase
    .rpc('secure_create_office_hours_request', {
      p_event_id: input.eventId,
      p_recipient_id: input.recipientId,
      p_proposed_start: input.proposedStart.toISOString(),
      p_proposed_end: input.proposedEnd.toISOString(),
      p_nonce: createIdempotencyNonce(),
    })
    .single();

  if (error || !data) {
    console.error('[officeHours.service] secure create error:', error);
    throw new Error(error?.message ?? 'Could not create Office Hours request');
  }

  return data as OfficeHoursRequest;
}

export async function listMyOfficeHoursRequests(
  userId: string,
): Promise<OfficeHoursRequestWithPeer[]> {
  const { data, error } = await supabase
    .from('office_hours_requests')
    .select(
      'id, event_id, requester_id, recipient_id, proposed_start, proposed_end, status, created_at, responded_at, requester:users!office_hours_requests_requester_id_fkey(name, role), recipient:users!office_hours_requests_recipient_id_fkey(name, role)'
    )
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('proposed_start', { ascending: false });
  if (error) {
    console.error('[officeHours.service] list error:', error);
    return [];
  }
  return (data ?? []).map((row: any) => {
    const isOutgoing = row.requester_id === userId;
    const peer = isOutgoing ? row.recipient : row.requester;
    return {
      id: row.id,
      event_id: row.event_id,
      requester_id: row.requester_id,
      recipient_id: row.recipient_id,
      proposed_start: row.proposed_start,
      proposed_end: row.proposed_end,
      status: row.status,
      created_at: row.created_at,
      responded_at: row.responded_at,
      peer_name: peer?.name ?? null,
      peer_role: peer?.role ?? null,
      direction: isOutgoing ? 'outgoing' : 'incoming',
    };
  });
}

async function transitionStatus(
  requestId: string,
  status: 'accepted' | 'declined' | 'cancelled',
): Promise<void> {
  const { error } = await supabase
    .rpc('transition_office_hours_request', {
      p_request_id: requestId,
      p_status: status,
    })
    .single();

  if (error) {
    console.error('[officeHours.service] transition error:', error);
    throw new Error(error.message ?? 'Could not update request');
  }
}

export const acceptOfficeHoursRequest = (id: string) => transitionStatus(id, 'accepted');
export const declineOfficeHoursRequest = (id: string) => transitionStatus(id, 'declined');
export const cancelOfficeHoursRequest = (id: string) => transitionStatus(id, 'cancelled');

export async function getOfficeHoursCompletionState(
  requestId: string,
): Promise<OfficeHoursCompletionState | null> {
  const { data, error } = await supabase
    .rpc('get_office_hours_completion_state', { p_request_id: requestId })
    .single();

  if (error || !data) {
    if (error) console.error('[officeHours.service] completion state error:', error);
    return null;
  }
  return mapCompletionState(data as CompletionStateRow);
}

export async function confirmOfficeHoursCompletion(
  requestId: string,
): Promise<OfficeHoursCompletionState> {
  const { data, error } = await supabase
    .rpc('confirm_office_hours_completion', { p_request_id: requestId })
    .single();

  if (error || !data) {
    console.error('[officeHours.service] completion confirmation error:', error);
    throw new Error(error?.message ?? 'Could not confirm Office Hours completion');
  }
  return mapCompletionState(data as CompletionStateRow);
}
