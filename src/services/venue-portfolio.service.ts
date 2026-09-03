import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface HostVenuePortfolioRow {
  venue_key: string;
  latest_event_id: string;
  ended_event_count: number;
  measured_event_count: number;
  total_measured_interventions: number;
  total_positive_interventions: number;
  weighted_mean_effect: number | null;
  weighted_positive_rate: number | null;
  mean_measurement_confidence: number | null;
  mean_evidence_coverage: number | null;
  recent_mean_effect: number | null;
  prior_mean_effect: number | null;
  trend_delta: number | null;
  last_closed_at: string;
}

/**
 * Returns only the authenticated host's own ended-event portfolio. The database
 * derives host identity from auth.uid(), so the client cannot request another
 * organizer's venue history by supplying a different user id.
 */
export async function getHostVenuePortfolio(): Promise<{
  data: HostVenuePortfolioRow[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_host_venue_portfolio');
  return { data: (data ?? []) as HostVenuePortfolioRow[], error };
}

export async function hasHostedEventHistory(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_hosted_event_history');
  if (error) {
    console.error('[venue-portfolio] hosted-event history lookup failed:', error);
    return false;
  }
  return data === true;
}
