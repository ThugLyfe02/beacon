import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type VenueSensorKind = 'ble' | 'wifi' | 'camera' | 'edge' | 'other';

export interface VenueSensorSourceRow {
  source_id: string;
  source_key: string;
  source_kind: VenueSensorKind;
  layout_version: string;
  token_version: number;
  max_observations_per_minute: number;
  active: boolean;
  last_sequence: number;
  last_observed_at: string | null;
  last_received_at: string | null;
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export interface ProvisionedVenueSensor {
  source_id: string;
  ingress_token: string;
  token_version: number;
}

export async function listVenueSensorSources(
  eventId: string,
): Promise<{ data: VenueSensorSourceRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_venue_sensor_sources', {
    p_event_id: eventId,
  });
  return { data: (data ?? []) as VenueSensorSourceRow[], error };
}

/**
 * Host-only source provisioning. The unique ingress token is returned once and
 * stored only as a digest on the server. Callers must not persist the plaintext
 * token in AsyncStorage, logs, analytics, or the Beacon database.
 */
export async function provisionVenueSensorSource(input: {
  eventId: string;
  sourceKey: string;
  sourceKind: VenueSensorKind;
  layoutVersion: string;
  maxObservationsPerMinute?: number;
}): Promise<{ data: ProvisionedVenueSensor | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('provision_venue_sensor_source', {
      p_event_id: input.eventId,
      p_source_key: input.sourceKey.trim(),
      p_source_kind: input.sourceKind,
      p_layout_version: input.layoutVersion,
      p_max_observations_per_minute: input.maxObservationsPerMinute ?? 120,
    })
    .maybeSingle();

  return { data: (data as ProvisionedVenueSensor | null) ?? null, error };
}

export async function rotateVenueSensorSourceToken(
  sourceId: string,
): Promise<{ data: ProvisionedVenueSensor | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('rotate_venue_sensor_source_token', { p_source_id: sourceId })
    .maybeSingle();
  return { data: (data as ProvisionedVenueSensor | null) ?? null, error };
}

export async function revokeVenueSensorSource(
  sourceId: string,
): Promise<{ revoked: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('revoke_venue_sensor_source', {
    p_source_id: sourceId,
  });
  return { revoked: data === true, error };
}
