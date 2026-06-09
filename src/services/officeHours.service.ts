// =============================================================================
// officeHours.service.ts
// Office Hours requests between approved event attendees (Phase 2).
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

export async function createOfficeHoursRequest(input: {
  eventId: string;
  requesterId: string;
  recipientId: string;
  proposedStart: Date;
  proposedEnd: Date;
}): Promise<OfficeHoursRequest> {
  const { data, error } = await supabase
    .from('office_hours_requests')
    .insert({
      event_id: input.eventId,
      requester_id: input.requesterId,
      recipient_id: input.recipientId,
      proposed_start: input.proposedStart.toISOString(),
      proposed_end: input.proposedEnd.toISOString(),
    } as never)
    .select('*')
    .single();
  if (error) {
    console.error('[officeHours.service] create error:', error);
    throw new Error(error.message ?? 'Could not create office hours request');
  }
  return data as OfficeHoursRequest;
}

export async function listMyOfficeHoursRequests(
  userId: string
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

async function updateStatus(
  requestId: string,
  status: OfficeHoursStatus
): Promise<void> {
  const { error } = await supabase
    .from('office_hours_requests')
    .update({ status, responded_at: new Date().toISOString() } as never)
    .eq('id', requestId);
  if (error) {
    console.error('[officeHours.service] update error:', error);
    throw new Error(error.message ?? 'Could not update request');
  }
}

export const acceptOfficeHoursRequest = (id: string) => updateStatus(id, 'accepted');
export const declineOfficeHoursRequest = (id: string) => updateStatus(id, 'declined');
export const cancelOfficeHoursRequest = (id: string) => updateStatus(id, 'cancelled');
