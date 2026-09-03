import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { VenueEventOperatorRow, VenueOperatorRole } from './venue-operations.service';

export async function listVenueEventOperators(
  eventId: string,
): Promise<{ data: VenueEventOperatorRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('venue_event_operators')
    .select('event_id,user_id,role,active,created_by,created_at,updated_at')
    .eq('event_id', eventId)
    .order('active', { ascending: false })
    .order('updated_at', { ascending: false });

  return { data: (data ?? []) as VenueEventOperatorRow[], error };
}

/**
 * Host-scoped roster mutation. The RPC verifies event ownership server-side;
 * this service does not infer host authority from client state.
 */
export async function updateVenueEventOperator(input: {
  eventId: string;
  userId: string;
  role: Exclude<VenueOperatorRole, 'viewer'>;
  active: boolean;
}): Promise<{ data: VenueEventOperatorRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('set_venue_event_operator', {
    p_event_id: input.eventId,
    p_user_id: input.userId,
    p_role: input.role,
    p_active: input.active,
  });

  return { data: (data as VenueEventOperatorRow | null) ?? null, error };
}
