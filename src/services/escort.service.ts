// =============================================================================
// escort.service.ts
// Host-side venue room management + escort assignment for office-hours
// requests. Phase 4.
// =============================================================================

import { supabase } from '../lib/supabase';

export interface VenueRoom {
  id: string;
  event_id: string;
  label: string;
  capacity: number;
  is_busy: boolean;
}

export interface EscortRequest {
  id: string;
  status: string;
  proposed_start: string;
  proposed_end: string;
  requester_id: string;
  recipient_id: string;
  room_id: string | null;
  requester_name: string | null;
  recipient_name: string | null;
  room_label: string | null;
}

export async function listVenueRooms(eventId: string): Promise<VenueRoom[]> {
  const { data, error } = await supabase
    .from('venue_rooms')
    .select('id, event_id, label, capacity, is_busy')
    .eq('event_id', eventId)
    .order('label');
  if (error) {
    console.error('[escort.service] listVenueRooms error:', error);
    return [];
  }
  return (data ?? []) as VenueRoom[];
}

export async function createVenueRoom(
  eventId: string,
  label: string,
  capacity: number
): Promise<VenueRoom> {
  const { data, error } = await supabase
    .from('venue_rooms')
    .insert({ event_id: eventId, label, capacity } as never)
    .select('id, event_id, label, capacity, is_busy')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not create room');
  }
  return data as VenueRoom;
}

export async function listEscortQueue(eventId: string): Promise<EscortRequest[]> {
  const { data, error } = await supabase
    .from('office_hours_requests')
    .select(
      'id, status, proposed_start, proposed_end, requester_id, recipient_id, room_id, requester:users!office_hours_requests_requester_id_fkey(name), recipient:users!office_hours_requests_recipient_id_fkey(name), venue_rooms(label)'
    )
    .eq('event_id', eventId)
    .in('status', ['accepted', 'awaiting_escort'])
    .order('proposed_start');
  if (error) {
    console.error('[escort.service] listEscortQueue error:', error);
    return [];
  }
  return (data ?? []).map((row: any) => ({
    id: row.id,
    status: row.status,
    proposed_start: row.proposed_start,
    proposed_end: row.proposed_end,
    requester_id: row.requester_id,
    recipient_id: row.recipient_id,
    room_id: row.room_id,
    requester_name: row.requester?.name ?? null,
    recipient_name: row.recipient?.name ?? null,
    room_label: row.venue_rooms?.label ?? null,
  }));
}

export async function assignRoom(
  officeHoursRequestId: string,
  roomId: string
): Promise<void> {
  const { error } = await supabase
    .from('office_hours_requests')
    .update({ room_id: roomId, status: 'awaiting_escort' } as never)
    .eq('id', officeHoursRequestId);
  if (error) {
    throw new Error(error.message);
  }
  // Fire push notification (best effort, ignore failures).
  try {
    await supabase.functions.invoke('escort-notify', {
      body: { officeHoursRequestId, roomId },
    });
  } catch (e) {
    console.warn('[escort.service] escort-notify failed:', e);
  }
}

export async function saveExpoPushToken(
  userId: string,
  token: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ expo_push_token: token } as never)
    .eq('id', userId);
  if (error) console.error('[escort.service] saveExpoPushToken error:', error);
}
