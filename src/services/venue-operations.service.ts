import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type VenueAuditEventType =
  | 'recommendation-admitted'
  | 'operator-decision'
  | 'intervention-applied'
  | 'intervention-observing'
  | 'intervention-measured'
  | 'intervention-reverted'
  | 'command-expired';

export type OperatorWritableVenueAuditEventType =
  | 'operator-decision'
  | 'intervention-applied'
  | 'intervention-reverted';

export type VenueOperatorCommandKind = 'flow' | 'capacity' | 'programming' | 'sponsor' | 'safety' | 'follow-up';
export type VenueOperatorRole = 'viewer' | 'organizer' | 'venue-ops' | 'security' | 'admin';

export interface VenueEventOperatorRow {
  event_id: string;
  user_id: string;
  role: VenueOperatorRole;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VenueOperationAuditRow {
  id: string;
  event_id: string;
  venue_key: string;
  event_type: VenueAuditEventType;
  command_id: string | null;
  intervention_id: string | null;
  operator_id: string | null;
  target_zone_ids: string[];
  layout_version: string;
  geometry_hash: string;
  policy_version: string;
  model_version: string;
  admission_decision: 'allow' | 'review' | 'block' | null;
  evidence_score: number | null;
  reason_code: string | null;
  note: string | null;
  idempotency_key: string;
  created_at: string;
}

export interface VenueInterventionMeasurementRow {
  id: string;
  event_id: string;
  intervention_id: string;
  command_id: string;
  venue_key: string;
  layout_version: string;
  geometry_hash: string;
  before_saturated_zones: number;
  after_saturated_zones: number;
  before_mean_occupancy: number;
  after_mean_occupancy: number;
  effect_score: number;
  confidence: number;
  measured_at: string;
}

export interface VenueServicePointSampleRow {
  id: number;
  event_id: string;
  service_point_id: string;
  zone_id: string;
  kind: 'check-in' | 'food' | 'coat-check' | 'restroom' | 'booth' | 'security' | 'other';
  queue_length: number;
  arrivals: number;
  completions: number;
  window_minutes: number;
  sample_support: number;
  confidence: number;
  observed_at: string;
  created_at: string;
}

export interface PublicVenueServiceStatus {
  service_point_id: string;
  zone_id: string;
  kind: VenueServicePointSampleRow['kind'];
  status: 'clear' | 'steady' | 'busy' | 'unknown';
  wait_band: '<5 min' | '5-10 min' | '10-20 min' | '20+ min' | 'unknown';
  confidence: number;
  observed_at: string;
}

export interface AppendVenueOperatorEventInput {
  eventId: string;
  venueKey: string;
  eventType: OperatorWritableVenueAuditEventType;
  commandId: string;
  commandKind: VenueOperatorCommandKind;
  interventionId?: string | null;
  targetZoneIds: string[];
  layoutVersion: string;
  geometryHash: string;
  policyVersion: string;
  modelVersion: string;
  admissionDecision?: 'allow' | 'review' | 'block' | null;
  evidenceScore?: number | null;
  reasonCode?: string | null;
  note?: string | null;
  idempotencyKey: string;
}

export interface VenueOperationsSnapshot {
  audit: VenueOperationAuditRow[];
  measurements: VenueInterventionMeasurementRow[];
  servicePoints: VenueServicePointSampleRow[];
  errors: Array<{ surface: 'audit' | 'measurements' | 'service-points'; message: string }>;
}

function clampLimit(limit: number, max = 200): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

function safeToken(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:-]/g, '_');
  return (normalized || fallback).slice(0, 80);
}

/**
 * Creates a retry-stable key for one explicit operator action. Callers should
 * create the key once when the action begins and reuse it for network retries.
 * `actionStartedAt` is therefore an input rather than `Date.now()` inside the
 * service, which avoids turning transport retries into duplicate audit records.
 */
export function buildVenueOperatorIdempotencyKey(input: {
  eventId: string;
  eventType: OperatorWritableVenueAuditEventType;
  commandId?: string | null;
  interventionId?: string | null;
  actionStartedAt: number;
}): string {
  return [
    'venue-op',
    safeToken(input.eventId, 'event'),
    input.eventType,
    safeToken(input.commandId ?? 'command', 'command'),
    safeToken(input.interventionId ?? 'intervention', 'intervention'),
    Math.max(0, Math.floor(input.actionStartedAt)).toString(36),
  ].join(':').slice(0, 200);
}

/**
 * Returns the server-authoritative event-scoped venue role. Event hosts resolve
 * to admin in the database helper even when no explicit roster row exists.
 */
export async function getVenueOperatorRole(
  eventId: string,
  userId: string,
): Promise<{ role: VenueOperatorRole | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('venue_operator_role', {
    p_event_id: eventId,
    p_user_id: userId,
  });
  return { role: (data as VenueOperatorRole | null) ?? null, error };
}

/** Host-only roster mutation; the database verifies event ownership. */
export async function setVenueEventOperator(input: {
  eventId: string;
  userId: string;
  role: VenueOperatorRole;
  active?: boolean;
}): Promise<{ data: VenueEventOperatorRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('set_venue_event_operator', {
    p_event_id: input.eventId,
    p_user_id: input.userId,
    p_role: input.role,
    p_active: input.active ?? true,
  });
  return { data: (data as VenueEventOperatorRow | null) ?? null, error };
}

/**
 * Records one qualified approval. Safety-class intervention application remains
 * blocked server-side until two distinct recent qualified approvals exist.
 */
export async function approveVenueCommand(input: {
  eventId: string;
  commandId: string;
  commandKind: VenueOperatorCommandKind;
}): Promise<{ id: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('approve_venue_command', {
    p_event_id: input.eventId,
    p_command_id: input.commandId,
    p_command_kind: input.commandKind,
  });
  return { id: typeof data === 'string' ? data : null, error };
}

/**
 * Appends an operator-owned event through the server-enforced event-role RPC.
 * There is no direct client insert path into the append-only venue audit table.
 * Command class is explicit because server authorization differs for normal
 * flow/capacity, programming/sponsor, and safety operations.
 */
export async function appendVenueOperatorEvent(
  input: AppendVenueOperatorEventInput,
): Promise<{ id: string | null; error: PostgrestError | { message: string } | null }> {
  if (!input.eventId || !input.venueKey || !input.layoutVersion || !input.geometryHash || !input.commandId) {
    return { id: null, error: { message: 'Event, venue, command, layout version, and geometry hash are required.' } };
  }
  if (input.idempotencyKey.trim().length < 8) {
    return { id: null, error: { message: 'A retry-stable idempotency key is required.' } };
  }
  if (input.evidenceScore != null && (input.evidenceScore < 0 || input.evidenceScore > 1)) {
    return { id: null, error: { message: 'Evidence score must be between 0 and 1.' } };
  }

  const { data, error } = await supabase.rpc('append_venue_operator_action', {
    p_event_id: input.eventId,
    p_venue_key: input.venueKey,
    p_event_type: input.eventType,
    p_command_id: input.commandId,
    p_command_kind: input.commandKind,
    p_intervention_id: input.interventionId ?? null,
    p_target_zone_ids: [...new Set(input.targetZoneIds)].slice(0, 64),
    p_layout_version: input.layoutVersion,
    p_geometry_hash: input.geometryHash,
    p_policy_version: input.policyVersion,
    p_model_version: input.modelVersion,
    p_admission_decision: input.admissionDecision ?? null,
    p_evidence_score: input.evidenceScore ?? null,
    p_reason_code: input.reasonCode ?? null,
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) {
    console.error('[venue-operations] append operator event failed:', error);
    return { id: null, error };
  }

  return { id: typeof data === 'string' ? data : null, error: null };
}

/**
 * Returns only the coarse service status the database has already privacy- and
 * support-gated for approved participants. Raw queue samples stay host-only.
 */
export async function getPublicVenueServiceStatus(
  eventId: string,
): Promise<{ data: PublicVenueServiceStatus[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_venue_service_status', {
    p_event_id: eventId,
  });

  if (error) {
    console.error('[venue-operations] participant service status failed:', error);
    return { data: [], error };
  }
  return { data: (data ?? []) as PublicVenueServiceStatus[], error: null };
}

export async function listVenueOperationAudit(
  eventId: string,
  limit = 75,
): Promise<{ data: VenueOperationAuditRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('venue_operation_audit_events')
    .select('id,event_id,venue_key,event_type,command_id,intervention_id,operator_id,target_zone_ids,layout_version,geometry_hash,policy_version,model_version,admission_decision,evidence_score,reason_code,note,idempotency_key,created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(clampLimit(limit));

  return { data: (data ?? []) as VenueOperationAuditRow[], error };
}

export async function listVenueInterventionMeasurements(
  eventId: string,
  limit = 50,
): Promise<{ data: VenueInterventionMeasurementRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('venue_intervention_measurements')
    .select('id,event_id,intervention_id,command_id,venue_key,layout_version,geometry_hash,before_saturated_zones,after_saturated_zones,before_mean_occupancy,after_mean_occupancy,effect_score,confidence,measured_at')
    .eq('event_id', eventId)
    .order('measured_at', { ascending: false })
    .limit(clampLimit(limit));

  return { data: (data ?? []) as VenueInterventionMeasurementRow[], error };
}

export async function listVenueServicePointSamples(
  eventId: string,
  limit = 100,
): Promise<{ data: VenueServicePointSampleRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('venue_service_point_samples')
    .select('id,event_id,service_point_id,zone_id,kind,queue_length,arrivals,completions,window_minutes,sample_support,confidence,observed_at,created_at')
    .eq('event_id', eventId)
    .order('observed_at', { ascending: false })
    .limit(clampLimit(limit));

  return { data: (data ?? []) as VenueServicePointSampleRow[], error };
}

/**
 * Reads organizer-visible venue evidence in one bounded operation. Each surface
 * fails independently so a missing service-point stream cannot hide the audit
 * log or measured interventions.
 */
export async function getVenueOperationsSnapshot(eventId: string): Promise<VenueOperationsSnapshot> {
  const [audit, measurements, servicePoints] = await Promise.all([
    listVenueOperationAudit(eventId),
    listVenueInterventionMeasurements(eventId),
    listVenueServicePointSamples(eventId),
  ]);

  const errors: VenueOperationsSnapshot['errors'] = [];
  if (audit.error) errors.push({ surface: 'audit', message: audit.error.message });
  if (measurements.error) errors.push({ surface: 'measurements', message: measurements.error.message });
  if (servicePoints.error) errors.push({ surface: 'service-points', message: servicePoints.error.message });

  return {
    audit: audit.data,
    measurements: measurements.data,
    servicePoints: servicePoints.data,
    errors,
  };
}
