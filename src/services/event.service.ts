// =============================================================================
// Beacon MVP — Event Service
// =============================================================================
import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ActiveEventContext, EventParticipantRow, EventRow } from '../types/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GetEventResult {
  data: EventRow | null;
  error: PostgrestError | null;
}

export interface JoinEventResult {
  data: EventParticipantRow | null;
  error: PostgrestError | null;
}

export interface JoinEventByCodeResult {
  data: ActiveEventContext | null;
  error: PostgrestError | { message: string } | null;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Look up an event by its join code (case-insensitive, trimmed).
 */
export async function getEventByCode(joinCode: string): Promise<GetEventResult> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('join_code', joinCode.trim().toUpperCase())
    .single();

  return { data, error };
}

/**
 * Join a user to an event. If the user is already a participant
 * (UNIQUE conflict / error code 23505), returns the existing row.
 */
export async function joinEvent(
  eventId: string,
  userId: string
): Promise<JoinEventResult> {
  const { data, error } = await supabase
    .from('event_participants')
    .insert({ event_id: eventId, user_id: userId, is_discoverable: false })
    .select()
    .single();

  // On unique-constraint violation, fetch the existing participant row
  if (error && error.code === '23505') {
    const { data: existing, error: fetchError } = await supabase
      .from('event_participants')
      .select('*')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .single();

    return { data: existing, error: fetchError };
  }

  return { data, error };
}

/**
 * High-level helper: look up an event by code and join it atomically.
 * Returns an ActiveEventContext containing both the event and participant rows.
 */
export async function joinEventByCode(
  joinCode: string,
  userId: string
): Promise<JoinEventByCodeResult> {
  console.log('[event.service] joinEventByCode called:', { joinCode, userId });

  const { data: event, error: eventError } = await getEventByCode(joinCode);
  console.log('[event.service] getEventByCode result:', { event, eventError });

  if (eventError || !event) {
    const error = eventError ?? { message: 'Event not found for the provided join code.' };
    console.log('[event.service] Event lookup failed:', error);
    return {
      data: null,
      error,
    };
  }

  const { data: participant, error: participantError } = await joinEvent(
    event.id,
    userId
  );
  console.log('[event.service] joinEvent result:', { participant, participantError });

  if (participantError || !participant) {
    const error = participantError ?? { message: 'Failed to join event.' };
    console.log('[event.service] Join failed:', error);
    return {
      data: null,
      error,
    };
  }

  console.log('[event.service] Success! Returning:', { event, participant });
  return {
    data: { event, participant },
    error: null,
  };
}
