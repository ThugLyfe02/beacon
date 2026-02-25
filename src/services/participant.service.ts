// =============================================================================
// Beacon MVP — Participant Service
// profile_scope: global (profile fields live on users table)
// =============================================================================
import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { DiscoverableParticipant, EventParticipantRow } from '../types/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToggleDiscoverableResult {
  data: EventParticipantRow | null;
  error: PostgrestError | null;
}

export interface ListDiscoverableResult {
  data: DiscoverableParticipant[];
  error: PostgrestError | null;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Set whether the calling user is visible to other participants in an event.
 * Only the owner (RLS: self update) can toggle this.
 */
export async function toggleDiscoverable(
  eventId: string,
  userId: string,
  isDiscoverable: boolean
): Promise<ToggleDiscoverableResult> {
  const { data, error } = await supabase
    .from('event_participants')
    .update({ is_discoverable: isDiscoverable })
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .select()
    .single();

  return { data, error };
}

/**
 * List all participants in an event who are discoverable,
 * excluding the calling user. Joins with the users table to
 * include global profile fields (name, role, one_liner).
 *
 * profile_scope = "global": profile data comes from the users table join.
 */
export async function listDiscoverableParticipants(
  eventId: string,
  callerUserId: string
): Promise<ListDiscoverableResult> {
  const { data, error } = await supabase
    .from('event_participants')
    .select(`
      id,
      event_id,
      user_id,
      is_discoverable,
      joined_at,
      users (
        email,
        name,
        role,
        one_liner
      )
    `)
    .eq('event_id', eventId)
    .eq('is_discoverable', true)
    .neq('user_id', callerUserId);

  if (error || !data) {
    return { data: [], error };
  }

  // Flatten the nested users join into DiscoverableParticipant[]
  const participants: DiscoverableParticipant[] = data.map((row: any) => ({
    participant_id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    is_discoverable: row.is_discoverable,
    joined_at: row.joined_at,
    email: row.users?.email ?? '',
    name: row.users?.name ?? null,
    role: row.users?.role ?? null,
    one_liner: row.users?.one_liner ?? null,
  }));

  return { data: participants, error: null };
}
