import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  VENUE_OBSERVATION_SCHEMA_VERSION,
  type VenueObservation,
  type VenueOccupancyObservation,
  type VenueServicePointObservation,
  type VenueTransitionObservation,
} from '../spatial/VenueObservationContract';
import type { VenueSourceVote } from '../spatial/VenueSourceQuorum';

export interface VenueSensorFeedRow {
  observation_id: number;
  venue_id: string;
  layout_version: string;
  source_id: string;
  source_kind: VenueSourceVote['sourceKind'];
  kind: 'occupancy' | 'transition' | 'service-point';
  sequence: number;
  observed_at: string;
  received_at: string;
  confidence: number;
  payload: Record<string, unknown>;
  record_hash: string;
}

export interface VenueSensorFeed {
  observations: VenueObservation[];
  rejectedRows: number;
  rows: VenueSensorFeedRow[];
}

function toMillis(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function base(row: VenueSensorFeedRow) {
  const observedAt = toMillis(row.observed_at);
  const receivedAt = toMillis(row.received_at);
  if (observedAt === null || receivedAt === null) return null;
  if (!Number.isSafeInteger(row.sequence) || row.sequence < 0) return null;
  if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) return null;
  if (!row.venue_id || !row.layout_version || !row.source_id) return null;
  return {
    schemaVersion: VENUE_OBSERVATION_SCHEMA_VERSION,
    venueId: row.venue_id,
    layoutVersion: row.layout_version,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    observedAt,
    receivedAt,
    sequence: row.sequence,
    confidence: row.confidence,
  } as const;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function rowToObservation(row: VenueSensorFeedRow): VenueObservation | null {
  const common = base(row);
  if (!common) return null;
  const payload = row.payload;

  if (row.kind === 'occupancy') {
    if (
      typeof payload.zoneId !== 'string'
      || !finiteNumber(payload.occupancy)
      || !finiteNumber(payload.sampleSupport)
    ) return null;
    const observation: VenueOccupancyObservation = {
      ...common,
      kind: 'occupancy',
      payload: {
        zoneId: payload.zoneId,
        occupancy: payload.occupancy,
        sampleSupport: payload.sampleSupport,
      },
    };
    return observation;
  }

  if (row.kind === 'transition') {
    if (
      typeof payload.fromZoneId !== 'string'
      || typeof payload.toZoneId !== 'string'
      || !finiteNumber(payload.support)
      || !finiteNumber(payload.sampleSupport)
    ) return null;
    const observation: VenueTransitionObservation = {
      ...common,
      kind: 'transition',
      payload: {
        fromZoneId: payload.fromZoneId,
        toZoneId: payload.toZoneId,
        support: payload.support,
        sampleSupport: payload.sampleSupport,
      },
    };
    return observation;
  }

  if (
    typeof payload.servicePointId !== 'string'
    || typeof payload.zoneId !== 'string'
    || !finiteNumber(payload.queueLength)
    || !finiteNumber(payload.arrivals)
    || !finiteNumber(payload.completions)
    || !finiteNumber(payload.windowMinutes)
    || !finiteNumber(payload.sampleSupport)
  ) return null;

  const observation: VenueServicePointObservation = {
    ...common,
    kind: 'service-point',
    payload: {
      servicePointId: payload.servicePointId,
      zoneId: payload.zoneId,
      queueLength: payload.queueLength,
      arrivals: payload.arrivals,
      completions: payload.completions,
      windowMinutes: payload.windowMinutes,
      sampleSupport: payload.sampleSupport,
    },
  };
  return observation;
}

/**
 * Reads a bounded current-event feed that the database has already filtered to
 * the active release and active sensor credentials, then reconstructs the same
 * versioned observation contract consumed by the app-side buffer/consensus code.
 * Malformed rows are dropped rather than coerced into venue truth.
 */
export async function getVenueSensorFeed(
  eventId: string,
  options: { since?: number; limit?: number } = {},
): Promise<{ data: VenueSensorFeed; error: PostgrestError | null }> {
  const limit = Math.max(1, Math.min(1500, Math.floor(options.limit ?? 500)));
  const since = options.since !== undefined && Number.isFinite(options.since)
    ? new Date(options.since).toISOString()
    : null;

  const { data, error } = await supabase.rpc('get_recent_venue_sensor_observations', {
    p_event_id: eventId,
    p_since: since,
    p_limit: limit,
  });

  const rows = (data ?? []) as VenueSensorFeedRow[];
  const observations: VenueObservation[] = [];
  let rejectedRows = 0;
  for (const row of rows) {
    const observation = rowToObservation(row);
    if (observation) observations.push(observation);
    else rejectedRows += 1;
  }

  return {
    data: { observations, rejectedRows, rows },
    error,
  };
}
