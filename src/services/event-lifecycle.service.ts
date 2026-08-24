import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { EventRow } from '../types/database';

/**
 * Returns only a currently hosted event that has not been explicitly closed.
 * Operational history remains in the database after close, so host discovery
 * must not equate "row exists" with "event is still live".
 */
export async function getActiveHostedEvent(userId: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('host_id', userId)
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as EventRow | null) ?? null;
}

/**
 * Closes the live event without destroying its aggregate operational evidence.
 * The server RPC verifies event ownership, clears live host location, and revokes
 * outstanding admitted venue commands before returning the close timestamp.
 */
export async function endActiveEvent(
  eventId: string,
): Promise<{ endedAt: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('end_event', {
    p_event_id: eventId,
  });

  if (error) {
    console.error('[event-lifecycle] end event failed:', error);
    return { endedAt: null, error };
  }
  return { endedAt: typeof data === 'string' ? data : null, error: null };
}

export async function isEventOperational(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_event_operational', {
    p_event_id: eventId,
  });
  if (error) return false;
  return data === true;
}
