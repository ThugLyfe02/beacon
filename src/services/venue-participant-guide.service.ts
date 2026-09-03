import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type LiveVenueServiceStatus = 'clear' | 'steady' | 'busy' | 'unknown';
export type LiveVenueServiceWaitBand = '<5 min' | '5-10 min' | '10-20 min' | '20+ min' | 'unknown';
export type LiveVenueServiceTrend = 'easing' | 'stable' | 'building' | 'unknown';

export interface LiveVenueServiceGuidance {
  service_point_id: string;
  zone_id: string;
  kind: 'check-in' | 'food' | 'coat-check' | 'restroom' | 'booth' | 'security' | 'other';
  status: LiveVenueServiceStatus;
  wait_band: LiveVenueServiceWaitBand;
  trend: LiveVenueServiceTrend;
  confidence: number;
  observed_at: string;
}

/**
 * Reads only the participant-safe service projection produced by the database.
 * The client never receives raw queue length, arrivals, completions, or service
 * history through this path; those remain host/operator operational evidence.
 */
export async function getLiveVenueServiceGuidance(
  eventId: string,
): Promise<{ data: LiveVenueServiceGuidance[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_live_venue_service_guidance', {
    p_event_id: eventId,
  });

  if (error) {
    console.error('[venue-participant-guide] live guidance unavailable:', error);
    return { data: [], error };
  }

  const rows = (data ?? []) as LiveVenueServiceGuidance[];
  return {
    data: rows.filter((row) => (
      typeof row.service_point_id === 'string'
      && typeof row.zone_id === 'string'
      && typeof row.observed_at === 'string'
      && Number.isFinite(Number(row.confidence))
    )).map((row) => ({ ...row, confidence: Math.max(0, Math.min(1, Number(row.confidence))) })),
    error: null,
  };
}
