// =============================================================================
// event.service.ts
// Event management service — preserves the complete host and attendee lifecycle.
// =============================================================================

import { supabase } from '../lib/supabase';
import type {
  EventRow,
  EventUpdate,
  EventWithHost,
  LocationType,
} from '../types/database';

function assertValidEventInput(eventData: {
  name: string;
  starts_at?: string;
  ends_at?: string;
}): void {
  if (!eventData.name.trim()) throw new Error('Event name is required');
  if (eventData.starts_at && eventData.ends_at) {
    const startsAt = Date.parse(eventData.starts_at);
    const endsAt = Date.parse(eventData.ends_at);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
      throw new Error('Event timing is invalid');
    }
    if (endsAt <= startsAt) throw new Error('Event end time must be after its start time');
  }
}

/**
 * Creates the event and approved host membership in one database transaction.
 * The server is the authority for auth.uid() and join-code generation; `hostId`
 * remains only as a compatibility assertion for existing callers.
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
  },
): Promise<EventRow> {
  if (!hostId) throw new Error('Host identity is required');
  assertValidEventInput(eventData);

  const { data, error } = await supabase.rpc('create_hosted_event', {
    p_name: eventData.name.trim(),
    p_description: eventData.description?.trim() || null,
    p_location_type: eventData.location_type,
    p_latitude: eventData.latitude ?? null,
    p_longitude: eventData.longitude ?? null,
    p_address: eventData.address?.trim() || null,
    p_requires_approval: eventData.requires_approval ?? true,
    p_access_code: eventData.access_code?.trim() || null,
    p_show_participant_count: eventData.show_participant_count ?? false,
    p_starts_at: eventData.starts_at ?? null,
    p_ends_at: eventData.ends_at ?? null,
  });

  if (error || !data) {
    console.error('[event.service] Atomic event creation failed:', error);
    throw new Error(error?.message || 'Failed to create event');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Event creation did not return an event');
  return row as EventRow;
}

/** Update an existing event. Database policy remains the final host authorization. */
export async function updateEvent(
  eventId: string,
  hostId: string,
  updates: EventUpdate,
): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .eq('host_id', hostId)
    .is('ended_at', null)
    .select()
    .single();

  if (error) {
    console.error('[event.service] Error updating event:', error);
    throw new Error(error.message || 'Failed to update event');
  }

  return data as EventRow;
}

/** Update the host-controlled live event location. */
export async function updateEventLocation(
  eventId: string,
  hostId: string,
  latitude: number,
  longitude: number,
): Promise<EventRow> {
  return updateEvent(eventId, hostId, { latitude, longitude });
}

/**
 * Destructive deletion is intentionally not used for normal event closure.
 * Keep this narrow helper only for explicit administrative cleanup workflows.
 */
export async function deleteEvent(eventId: string, hostId: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', eventId).eq('host_id', hostId);
  if (error) {
    console.error('[event.service] Error deleting event:', error);
    throw new Error(error.message || 'Failed to delete event');
  }
}

/** Retrieve an event already visible under current RLS policy. */
export async function getEventById(eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error) {
    console.error('[event.service] Error fetching event:', error);
    return null;
  }
  return data ? (data as EventRow) : null;
}

/**
 * Resolve a pre-membership join code through the dedicated SECURITY DEFINER RPC.
 * The server returns no access-code secret and excludes closed events.
 */
export async function getEventByCode(joinCode: string): Promise<EventRow | null> {
  const normalized = joinCode.trim().toUpperCase();
  if (!normalized) return null;

  const { data, error } = await supabase
    .rpc('get_event_by_join_code', { p_join_code: normalized })
    .maybeSingle();

  if (error) {
    console.error('[event.service] Error fetching event by code:', error);
    return null;
  }

  return data ? ({ ...(data as EventRow), ended_at: null } as EventRow) : null;
}

function eventPriority(event: EventRow): number {
  if (event.ended_at) return 0;
  const now = Date.now();
  const startsAt = event.starts_at ? Date.parse(event.starts_at) : Number.NaN;
  const endsAt = event.ends_at ? Date.parse(event.ends_at) : Number.NaN;
  if (Number.isFinite(endsAt) && endsAt < now) return 0;
  if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && endsAt >= now) return 3;
  if (Number.isFinite(startsAt) && startsAt > now) return 2;
  return 1;
}

/** Return approved events in deterministic active/upcoming/recent order. */
export async function getUserEvents(userId: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('event_participants')
    .select('events(*)')
    .eq('user_id', userId)
    .eq('status', 'approved');

  if (error) {
    console.error('[event.service] Error fetching user events:', error);
    throw new Error(error.message || 'Failed to fetch events');
  }

  const events = (data ?? [])
    .map((row) => (Array.isArray(row.events) ? row.events[0] : row.events))
    .filter((event): event is EventRow => Boolean(event));

  return events.sort((left, right) => {
    const priorityDelta = eventPriority(right) - eventPriority(left);
    if (priorityDelta !== 0) return priorityDelta;
    const leftTime = Date.parse(left.starts_at ?? left.created_at);
    const rightTime = Date.parse(right.starts_at ?? right.created_at);
    return rightTime - leftTime;
  });
}

/** Get the most recently created event that has not been explicitly closed. */
export async function getHostedEvent(hostId: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('host_id', hostId)
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[event.service] Error fetching hosted event:', error);
    throw new Error(error.message || 'Failed to fetch hosted event');
  }
  return data ? (data as EventRow) : null;
}

/** Retrieve event and host profile information for approved presentation surfaces. */
export async function getEventWithHost(eventId: string): Promise<EventWithHost | null> {
  const { data: event, error } = await supabase
    .from('events')
    .select('*, users(*)')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !event) {
    if (error) console.error('[event.service] Error fetching event with host:', error);
    return null;
  }

  return { event: event as unknown as EventRow, host: (event as any).users };
}

/** Count approved event participants without exposing the participant list. */
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

  return count ?? 0;
}
