// =============================================================================
// event.service.ts
// Event management service - create, update, delete, and discover events
// =============================================================================

import { supabase } from '../lib/supabase';
import type {
  EventRow,
  EventInsert,
  EventUpdate,
  EventWithHost,
  LocationType,
} from '../types/database';

/**
 * Generate a unique 6-character join code
 */
function generateJoinCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new event (host only)
 */
export async function createEvent(
  hostId: string,
  eventData: {
    name: string;
    description?: string;
    location_type: LocationType;
    latitude?: number;
    longitude?: number;
    address?: string;
    requires_approval?: boolean;
    access_code?: string;
    show_participant_count?: boolean;
    starts_at?: string;
    ends_at?: string;
  }
): Promise<EventRow> {
  const joinCode = generateJoinCode();

  const insert: EventInsert = {
    host_id: hostId,
    name: eventData.name,
    description: eventData.description || null,
    location_type: eventData.location_type,
    latitude: eventData.latitude || null,
    longitude: eventData.longitude || null,
    address: eventData.address || null,
    requires_approval: eventData.requires_approval ?? true,
    access_code: eventData.access_code || null,
    show_participant_count: eventData.show_participant_count ?? false,
    starts_at: eventData.starts_at || null,
    ends_at: eventData.ends_at || null,
  };

  const { data, error } = await supabase
    .from('events')
    .insert({ ...insert, join_code: joinCode })
    .select()
    .single();

  if (error) {
    console.error('[event.service] Error creating event:', error);
    throw new Error('Failed to create event');
  }

  // Auto-approve host as participant
  await supabase
    .from('event_participants')
    .insert({
      event_id: data.id,
      user_id: hostId,
      status: 'approved',
    });

  return data;
}

/**
 * Update an existing event (host only)
 */
export async function updateEvent(
  eventId: string,
  hostId: string,
  updates: EventUpdate
): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .eq('host_id', hostId)
    .select()
    .single();

  if (error) {
    console.error('[event.service] Error updating event:', error);
    throw new Error('Failed to update event');
  }

  return data;
}

/**
 * Update event location (live broadcasting)
 */
export async function updateEventLocation(
  eventId: string,
  hostId: string,
  latitude: number,
  longitude: number
): Promise<EventRow> {
  return updateEvent(eventId, hostId, { latitude, longitude });
}

/**
 * Delete an event (host only)
 */
export async function deleteEvent(eventId: string, hostId: string): Promise<void> {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('host_id', hostId);

  if (error) {
    console.error('[event.service] Error deleting event:', error);
    throw new Error('Failed to delete event');
  }
}

/**
 * Get event by ID
 */
export async function getEventById(eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error) {
    console.error('[event.service] Error fetching event:', error);
    return null;
  }

  return data;
}

/**
 * Get event by join code
 * Uses a SECURITY DEFINER function to bypass RLS (users need to see events before joining)
 */
export async function getEventByCode(joinCode: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .rpc('get_event_by_join_code', { p_join_code: joinCode.trim() })
    .single();

  if (error) {
    console.error('[event.service] Error fetching event by code:', error);
    return null;
  }

  return data;
}

/**
 * Get all events user has joined (approved only)
 */
export async function getUserEvents(userId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('event_participants')
    .select('events(*)')
    .eq('user_id', userId)
    .eq('status', 'approved');

  if (error) {
    console.error('[event.service] Error fetching user events:', error);
    throw new Error('Failed to fetch events');
  }

  return (data || []).map((row: any) => row.events).filter(Boolean);
}

/**
 * Get event user is currently hosting
 */
export async function getHostedEvent(hostId: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('host_id', hostId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    console.error('[event.service] Error fetching hosted event:', error);
    throw new Error('Failed to fetch hosted event');
  }

  return data;
}

/**
 * Get event with host information
 */
export async function getEventWithHost(eventId: string): Promise<EventWithHost | null> {
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('*, users(*)')
    .eq('id', eventId)
    .single();

  if (eventError || !event) {
    console.error('[event.service] Error fetching event with host:', eventError);
    return null;
  }

  return {
    event: event as unknown as EventRow,
    host: (event as any).users,
  };
}

/**
 * Get participant count for an event
 */
export async function getParticipantCount(eventId: string): Promise<number> {
  const { count, error } = await supabase
    .from('event_participants')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'approved');

  if (error) {
    console.error('[event.service] Error fetching participant count:', error);
    return 0;
  }

  return count || 0;
}
