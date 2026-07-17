import { supabase } from '../lib/supabase';
import type { CardinalSector, VenueMemorySnapshot } from '../spatial/SpatialWorldIntelligenceEngine';

interface VenueWorldMemoryRow {
  venue_key: string;
  sample_size: number;
  median_first_mutual_minute: number | null;
  office_hours_conversion_rate: number | null;
  cold_signal_conversion_rate: number | null;
  peak_sector: CardinalSector;
  peak_minute_of_day: number | null;
  confidence: number;
}

/**
 * Normalizes a venue without preserving exact coordinates or free-form address
 * detail in the client-side world model. The database receives only this stable
 * event-location key and aggregate outcomes.
 */
export function buildVenueKey(input: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  eventId: string;
}): string {
  if (input.latitude != null && input.longitude != null) {
    // Roughly neighborhood/building-scale. Deliberately avoids a precise trace.
    return `geo:${input.latitude.toFixed(3)}:${input.longitude.toFixed(3)}`;
  }
  const address = input.address?.trim().toLowerCase().replace(/\s+/g, ' ');
  if (address) return `address:${address.slice(0, 120)}`;
  return `event:${input.eventId}`;
}

/** Reads only confidence-gated, venue-level aggregate memory allowed by RLS. */
export async function getVenueWorldMemory(venueKey: string): Promise<VenueMemorySnapshot | null> {
  const { data, error } = await supabase
    .from('venue_world_memory')
    .select('venue_key,sample_size,median_first_mutual_minute,office_hours_conversion_rate,cold_signal_conversion_rate,peak_sector,peak_minute_of_day,confidence')
    .eq('venue_key', venueKey)
    .maybeSingle();

  if (error) {
    console.warn('[world-memory] Mature venue memory unavailable:', error.message);
    return null;
  }
  if (!data) return null;

  const row = data as VenueWorldMemoryRow;
  if (row.sample_size < 3 || row.confidence < 0.45) return null;

  return {
    venueKey: row.venue_key,
    sampleSize: row.sample_size,
    medianFirstMutualMinute: row.median_first_mutual_minute,
    officeHoursConversionRate: row.office_hours_conversion_rate,
    coldSignalConversionRate: row.cold_signal_conversion_rate,
    peakSector: row.peak_sector,
    peakMinuteOfDay: row.peak_minute_of_day,
    confidence: row.confidence,
  };
}
