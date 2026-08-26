import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  EVENT_INTENT_KEYS,
  type EventIntentKey,
} from './event-intent.service';

export type WarmIntroductionStatus =
  | 'connector-pending'
  | 'target-pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'matched';

export type WarmIntroductionRole = 'requester' | 'connector' | 'target';

export interface WarmIntroductionPreference {
  event_id: string;
  user_id: string;
  enabled: boolean;
  max_active: number;
  updated_at: string;
}

export interface WarmIntroductionAvailability {
  available: boolean;
  reason:
    | 'connector-available'
    | 'already-requested'
    | 'already-connected'
    | 'no-declared-fit'
    | 'request-limit'
    | 'target-unavailable'
    | 'no-opted-in-connector'
    | 'event-closed'
    | 'authentication-required'
    | 'unknown';
  eligible_domains: EventIntentKey[];
}

export interface WarmIntroductionRequestResult {
  request_id: string;
  request_status: WarmIntroductionStatus;
  intent_key: EventIntentKey;
  expires_at: string;
}

export interface WarmIntroductionTransitionResult {
  request_id: string;
  request_status: WarmIntroductionStatus;
  expires_at: string;
}

export interface WarmIntroductionInboxItem {
  request_id: string;
  event_id: string;
  participant_role: WarmIntroductionRole;
  request_status: WarmIntroductionStatus;
  intent_key: EventIntentKey;
  requester_id: string;
  requester_name: string | null;
  requester_role: string | null;
  requester_one_liner: string | null;
  connector_id: string | null;
  connector_name: string | null;
  connector_role: string | null;
  target_id: string;
  target_name: string | null;
  target_role: string | null;
  target_one_liner: string | null;
  created_at: string;
  expires_at: string;
  connector_accepted_at: string | null;
  target_accepted_at: string | null;
  matched_at: string | null;
  can_accept: boolean;
  can_decline: boolean;
  can_cancel: boolean;
}

export interface WarmIntroductionSummary {
  supported: boolean;
  total_requests: number | null;
  connector_accepts: number | null;
  target_accepts: number | null;
  matched_introductions: number | null;
  connector_accept_rate: number | null;
  target_accept_rate: number | null;
  match_after_accept_rate: number | null;
}

export interface WarmIntroductionDomainSummary {
  intent_key: EventIntentKey;
  request_count: number;
  connector_accept_count: number;
  target_accept_count: number;
  matched_count: number;
  match_after_accept_rate: number;
}

const STATUS_VALUES = new Set<WarmIntroductionStatus>([
  'connector-pending',
  'target-pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
  'matched',
]);
const ROLE_VALUES = new Set<WarmIntroductionRole>(['requester', 'connector', 'target']);
const AVAILABILITY_REASONS = new Set<WarmIntroductionAvailability['reason']>([
  'connector-available',
  'already-requested',
  'already-connected',
  'no-declared-fit',
  'request-limit',
  'target-unavailable',
  'no-opted-in-connector',
  'event-closed',
  'authentication-required',
  'unknown',
]);

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function intentKey(value: unknown): value is EventIntentKey {
  return typeof value === 'string'
    && (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function statusValue(value: unknown): value is WarmIntroductionStatus {
  return typeof value === 'string' && STATUS_VALUES.has(value as WarmIntroductionStatus);
}

function roleValue(value: unknown): value is WarmIntroductionRole {
  return typeof value === 'string' && ROLE_VALUES.has(value as WarmIntroductionRole);
}

function boundedRatio(value: unknown): number | null {
  if (!finiteNumber(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function normalizedDomains(value: unknown): EventIntentKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(intentKey))].sort();
}

function normalizePreference(raw: unknown): WarmIntroductionPreference | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.event_id)
    || !stringValue(row.user_id)
    || typeof row.enabled !== 'boolean'
    || !finiteNumber(row.max_active)
    || !stringValue(row.updated_at)
  ) return null;

  return {
    event_id: row.event_id,
    user_id: row.user_id,
    enabled: row.enabled,
    max_active: Math.max(1, Math.min(4, Math.floor(row.max_active))),
    updated_at: row.updated_at,
  };
}

function normalizeAvailability(raw: unknown): WarmIntroductionAvailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.available !== 'boolean') return null;
  const reason = typeof row.reason === 'string'
    && AVAILABILITY_REASONS.has(row.reason as WarmIntroductionAvailability['reason'])
    ? row.reason as WarmIntroductionAvailability['reason']
    : 'unknown';
  return {
    available: row.available,
    reason,
    eligible_domains: normalizedDomains(row.eligible_domains),
  };
}

function normalizeRequest(raw: unknown): WarmIntroductionRequestResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.request_id)
    || !statusValue(row.request_status)
    || !intentKey(row.intent_key)
    || !stringValue(row.expires_at)
  ) return null;

  return {
    request_id: row.request_id,
    request_status: row.request_status,
    intent_key: row.intent_key,
    expires_at: row.expires_at,
  };
}

function normalizeTransition(raw: unknown): WarmIntroductionTransitionResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.request_id)
    || !statusValue(row.request_status)
    || !stringValue(row.expires_at)
  ) return null;
  return {
    request_id: row.request_id,
    request_status: row.request_status,
    expires_at: row.expires_at,
  };
}

function normalizeInboxItem(raw: unknown): WarmIntroductionInboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.request_id)
    || !stringValue(row.event_id)
    || !roleValue(row.participant_role)
    || !statusValue(row.request_status)
    || !intentKey(row.intent_key)
    || !stringValue(row.requester_id)
    || !stringValue(row.target_id)
    || !stringValue(row.created_at)
    || !stringValue(row.expires_at)
    || typeof row.can_accept !== 'boolean'
    || typeof row.can_decline !== 'boolean'
    || typeof row.can_cancel !== 'boolean'
  ) return null;

  return {
    request_id: row.request_id,
    event_id: row.event_id,
    participant_role: row.participant_role,
    request_status: row.request_status,
    intent_key: row.intent_key,
    requester_id: row.requester_id,
    requester_name: nullableString(row.requester_name),
    requester_role: nullableString(row.requester_role),
    requester_one_liner: nullableString(row.requester_one_liner),
    connector_id: nullableString(row.connector_id),
    connector_name: nullableString(row.connector_name),
    connector_role: nullableString(row.connector_role),
    target_id: row.target_id,
    target_name: nullableString(row.target_name),
    target_role: nullableString(row.target_role),
    target_one_liner: nullableString(row.target_one_liner),
    created_at: row.created_at,
    expires_at: row.expires_at,
    connector_accepted_at: nullableString(row.connector_accepted_at),
    target_accepted_at: nullableString(row.target_accepted_at),
    matched_at: nullableString(row.matched_at),
    can_accept: row.can_accept,
    can_decline: row.can_decline,
    can_cancel: row.can_cancel,
  };
}

function normalizeSummary(raw: unknown): WarmIntroductionSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const supported = row.supported === true;
  if (!supported) {
    return {
      supported: false,
      total_requests: null,
      connector_accepts: null,
      target_accepts: null,
      matched_introductions: null,
      connector_accept_rate: null,
      target_accept_rate: null,
      match_after_accept_rate: null,
    };
  }

  if (
    !finiteNumber(row.total_requests)
    || !finiteNumber(row.connector_accepts)
    || !finiteNumber(row.target_accepts)
    || !finiteNumber(row.matched_introductions)
  ) return null;

  return {
    supported: true,
    total_requests: Math.max(0, Math.floor(row.total_requests)),
    connector_accepts: Math.max(0, Math.floor(row.connector_accepts)),
    target_accepts: Math.max(0, Math.floor(row.target_accepts)),
    matched_introductions: Math.max(0, Math.floor(row.matched_introductions)),
    connector_accept_rate: boundedRatio(row.connector_accept_rate),
    target_accept_rate: boundedRatio(row.target_accept_rate),
    match_after_accept_rate: boundedRatio(row.match_after_accept_rate),
  };
}

function normalizeDomainSummary(raw: unknown): WarmIntroductionDomainSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !intentKey(row.intent_key)
    || !finiteNumber(row.request_count)
    || !finiteNumber(row.connector_accept_count)
    || !finiteNumber(row.target_accept_count)
    || !finiteNumber(row.matched_count)
  ) return null;
  const matchRate = boundedRatio(row.match_after_accept_rate);
  if (matchRate == null) return null;

  return {
    intent_key: row.intent_key,
    request_count: Math.max(0, Math.floor(row.request_count)),
    connector_accept_count: Math.max(0, Math.floor(row.connector_accept_count)),
    target_accept_count: Math.max(0, Math.floor(row.target_accept_count)),
    matched_count: Math.max(0, Math.floor(row.matched_count)),
    match_after_accept_rate: matchRate,
  };
}

export async function getWarmIntroductionPreference(
  eventId: string,
): Promise<{ data: WarmIntroductionPreference | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_my_introduction_preference', { p_event_id: eventId })
    .maybeSingle();
  return { data: normalizePreference(data), error };
}

export async function setWarmIntroductionPreference(input: {
  eventId: string;
  enabled: boolean;
  maxActive: number;
}): Promise<{ data: WarmIntroductionPreference | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('set_my_introduction_preference', {
      p_event_id: input.eventId,
      p_enabled: input.enabled,
      p_max_active: Math.max(1, Math.min(4, Math.floor(input.maxActive))),
    })
    .maybeSingle();
  return { data: normalizePreference(data), error };
}

export async function getWarmIntroductionAvailability(input: {
  eventId: string;
  targetId: string;
}): Promise<{ data: WarmIntroductionAvailability | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_warm_introduction_availability', {
      p_event_id: input.eventId,
      p_target_id: input.targetId,
    })
    .maybeSingle();
  return { data: normalizeAvailability(data), error };
}

export async function requestWarmIntroduction(input: {
  eventId: string;
  targetId: string;
  intentKey: EventIntentKey;
}): Promise<{ data: WarmIntroductionRequestResult | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('request_warm_introduction', {
      p_event_id: input.eventId,
      p_target_id: input.targetId,
      p_intent_key: input.intentKey,
    })
    .maybeSingle();
  return { data: normalizeRequest(data), error };
}

export async function listMyWarmIntroductions(
  eventId: string,
): Promise<{ data: WarmIntroductionInboxItem[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_event_introductions', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const row = normalizeInboxItem(raw);
      return row ? [row] : [];
    }),
    error,
  };
}

export async function respondToWarmIntroduction(
  requestId: string,
  accept: boolean,
): Promise<{ data: WarmIntroductionTransitionResult | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('respond_to_warm_introduction', {
      p_request_id: requestId,
      p_accept: accept,
    })
    .maybeSingle();
  return { data: normalizeTransition(data), error };
}

export async function cancelWarmIntroduction(
  requestId: string,
): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('cancel_my_warm_introduction', {
    p_request_id: requestId,
  });
  return { changed: data === true, error };
}

export async function getWarmIntroductionSummary(
  eventId: string,
): Promise<{ data: WarmIntroductionSummary | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_event_introduction_summary', { p_event_id: eventId })
    .maybeSingle();
  return { data: normalizeSummary(data), error };
}

export async function getWarmIntroductionDomains(
  eventId: string,
): Promise<{ data: WarmIntroductionDomainSummary[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_introduction_domains', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const row = normalizeDomainSummary(raw);
      return row ? [row] : [];
    }),
    error,
  };
}
