import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { VenueOperationsRelease } from '../spatial/VenueOperationsRelease';

interface VenueOperationsReleaseRow {
  event_id: string;
  release_id: string;
  venue_key: string;
  venue_id: string;
  layout_version: string;
  geometry_hash: string;
  observation_schema_version: string;
  policy_version: string;
  model_version: string;
  activated_at: string;
  expires_at: string | null;
}

/**
 * Reads the trusted release currently pinned to an event. The app cannot create
 * or mutate release rows; it only consumes the control-plane identity that the
 * backend has already activated.
 */
export async function getActiveVenueOperationsRelease(
  eventId: string,
): Promise<{ data: VenueOperationsRelease | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_active_venue_operations_release', { p_event_id: eventId })
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[venue-release] active release unavailable:', error);
    return { data: null, error };
  }

  const row = data as VenueOperationsReleaseRow;
  const activatedAt = Date.parse(row.activated_at);
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : undefined;
  if (!Number.isFinite(activatedAt) || (expiresAt !== undefined && !Number.isFinite(expiresAt))) {
    return {
      data: null,
      error: {
        name: 'VenueReleaseParseError',
        message: 'Venue operations release contains an invalid timestamp.',
        details: '',
        hint: '',
        code: 'VENUE_RELEASE_TIME',
      } as PostgrestError,
    };
  }

  return {
    data: {
      releaseId: row.release_id,
      eventId: row.event_id,
      venueId: row.venue_id,
      venueKey: row.venue_key,
      layoutVersion: row.layout_version,
      geometryHash: row.geometry_hash,
      observationSchemaVersion: row.observation_schema_version,
      policyVersion: row.policy_version,
      modelVersion: row.model_version,
      activatedAt,
      expiresAt,
    },
    error: null,
  };
}
