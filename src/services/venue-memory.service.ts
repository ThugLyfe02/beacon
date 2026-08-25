import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface VenueRepeatMeasurementRow {
  source_event_id: string;
  source_closed_at: string;
  command_id: string;
  command_kind: string;
  effect_score: number;
  confidence: number;
  measured_at: string;
  context_key: string;
  context_version: string;
  venue_key: string;
  layout_version: string;
  geometry_hash: string;
  total_capacity: number;
  topology_redundancy: number;
  accessible_coverage: number;
  attendance_band: 'small' | 'medium' | 'large' | 'very-large';
  duration_band: 'short' | 'standard' | 'long';
  zone_kinds: string[];
  service_point_kinds: string[];
  program_fingerprint: string | null;
}

export interface VenueRepeatCloseoutRow {
  source_event_id: string;
  venue_key: string;
  closed_at: string;
  measured_intervention_count: number;
  positive_intervention_count: number;
  mean_measured_effect: number | null;
  positive_rate: number | null;
  mean_measurement_confidence: number | null;
  evidence_coverage: number;
  release_id: string | null;
  layout_version: string | null;
  geometry_hash: string | null;
  policy_version: string | null;
  model_version: string | null;
}

export interface VenueRepeatMemoryPayload {
  measurements: VenueRepeatMeasurementRow[];
  closeouts: VenueRepeatCloseoutRow[];
  errors: Array<{ surface: 'measurements' | 'closeouts'; message: string }>;
}

function clampLimit(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

/**
 * Reads only the authenticated host's own ended-event evidence for the same
 * configured venue. The database function enforces host scope; the mobile
 * client cannot request another organizer's portfolio or a cross-customer
 * benchmark by changing parameters.
 */
export async function getVenueRepeatMemory(
  eventId: string,
  options: { measurementLimit?: number; closeoutLimit?: number } = {},
): Promise<VenueRepeatMemoryPayload> {
  const measurementLimit = clampLimit(options.measurementLimit ?? 120, 120, 240);
  const closeoutLimit = clampLimit(options.closeoutLimit ?? 24, 24, 60);

  const [measurements, closeouts] = await Promise.all([
    supabase.rpc('get_venue_repeat_event_measurements', {
      p_event_id: eventId,
      p_limit: measurementLimit,
    }),
    supabase.rpc('get_venue_repeat_event_closeouts', {
      p_event_id: eventId,
      p_limit: closeoutLimit,
    }),
  ]);

  const errors: VenueRepeatMemoryPayload['errors'] = [];
  if (measurements.error) errors.push({ surface: 'measurements', message: measurements.error.message });
  if (closeouts.error) errors.push({ surface: 'closeouts', message: closeouts.error.message });

  return {
    measurements: (measurements.data ?? []) as VenueRepeatMeasurementRow[],
    closeouts: (closeouts.data ?? []) as VenueRepeatCloseoutRow[],
    errors,
  };
}

export function venueMemoryErrorMessage(error: PostgrestError | { message: string } | null): string | null {
  return error?.message ?? null;
}
