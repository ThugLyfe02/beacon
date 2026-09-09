// =============================================================================
// escort.service.ts
// Host-side physical Office Hours orchestration.
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

function createEscortNonce(): string {
  const randomA = Math.random().toString(36).slice(2);
  const randomB = Math.random().toString(36).slice(2);
  return `escort-${Date.now().toString(36)}-${randomA}${randomB}`.slice(0, 120);
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
  capacity: number,
): Promise<VenueRoom> {
  const { data, error } = await supabase
    .rpc('create_venue_room_secure', {
      p_event_id: eventId,
      p_label: label.trim(),
      p_capacity: capacity,
    })
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not create room');
  }
  return data as VenueRoom;
}

export async function listEscortQueue(eventId: string): Promise<EscortRequest[]> {
  const { data, error } = await supabase.rpc('get_host_escort_queue', {
    p_event_id: eventId,
  });

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
    room_id: row.room_id ?? null,
    requester_name: row.requester_name ?? null,
    recipient_name: row.recipient_name ?? null,
    room_label: row.room_label ?? null,
  }));
}

export async function assignRoom(
  officeHoursRequestId: string,
  roomId: string,
): Promise<void> {
  const { error } = await supabase
    .rpc('assign_escort_room_secure', {
      p_request_id: officeHoursRequestId,
      p_room_id: roomId,
      p_nonce: createEscortNonce(),
    })
    .single();

  if (error) throw new Error(error.message);

  // Push notification remains best effort; assignment truth is already committed
  // atomically in Postgres before this side effect is attempted.
  try {
    await supabase.functions.invoke('escort-notify', {
      body: { officeHoursRequestId, roomId },
    });
  } catch (error) {
    console.warn('[escort.service] escort-notify failed:', error);
  }
}

export async function saveExpoPushToken(
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ expo_push_token: token } as never)
    .eq('id', userId);
  if (error) console.error('[escort.service] saveExpoPushToken error:', error);
}
