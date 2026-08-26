import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  EVENT_INTENT_KEYS,
  type EventIntentKey,
} from './event-intent.service';

export const EVENT_FOCUS_WINDOW_FORMATS = [
  'roundtable',
  'office-hours',
  'mentor-desk',
  'open-circle',
] as const;

export type EventFocusWindowFormat = typeof EVENT_FOCUS_WINDOW_FORMATS[number];
export type EventFocusWindowState = 'published' | 'closed' | 'cancelled';
export type EventFocusWindowPhase = 'upcoming' | 'live' | 'ended' | 'closed' | 'cancelled';
export type EventFocusWindowRelevance = 'seeking' | 'offering' | 'both';

export const EVENT_FOCUS_WINDOW_FORMAT_LABELS: Record<EventFocusWindowFormat, string> = {
  roundtable: 'Roundtable',
  'office-hours': 'Office hours',
  'mentor-desk': 'Mentor desk',
  'open-circle': 'Open circle',
};

export interface ParticipantEventFocusWindow {
  window_id: string;
  event_id: string;
  intent_key: EventIntentKey;
  format: EventFocusWindowFormat;
  title: string;
  location_label: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  joined_count: number;
  spots_remaining: number;
  is_joined: boolean;
  relevance: EventFocusWindowRelevance;
  phase: 'upcoming' | 'live';
}

export interface HostEventFocusWindow {
  window_id: string;
  event_id: string;
  intent_key: EventIntentKey;
  format: EventFocusWindowFormat;
  title: string;
  location_label: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  joined_count: number;
  state: EventFocusWindowState;
  phase: EventFocusWindowPhase;
  created_at: string;
}

export interface EventFocusWindowOutcome {
  window_id: string;
  supported: boolean;
  opt_in_count: number | null;
  new_mutual_count: number | null;
  participants_with_new_mutuals: number | null;
  participant_outcome_share: number | null;
  observation_ends_at: string;
}

export interface EventFocusWindowPlaybookRow {
  intent_key: EventIntentKey;
  format: EventFocusWindowFormat;
  supported_window_count: number;
  event_count: number;
  opt_in_count: number;
  participants_with_new_mutuals: number;
  participant_outcome_share: number;
  evidence_weight: number;
  latest_window_at: string;
}

export interface EventFocusWindowOptInResult {
  window_id: string;
  joined_count: number;
  spots_remaining: number;
  is_joined: boolean;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function intentKey(value: unknown): value is EventIntentKey {
  return typeof value === 'string' && (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function focusFormat(value: unknown): value is EventFocusWindowFormat {
  return typeof value === 'string'
    && (EVENT_FOCUS_WINDOW_FORMATS as readonly string[]).includes(value);
}

function participantPhase(value: unknown): value is ParticipantEventFocusWindow['phase'] {
  return value === 'upcoming' || value === 'live';
}

function hostPhase(value: unknown): value is EventFocusWindowPhase {
  return value === 'upcoming'
    || value === 'live'
    || value === 'ended'
    || value === 'closed'
    || value === 'cancelled';
}

function hostState(value: unknown): value is EventFocusWindowState {
  return value === 'published' || value === 'closed' || value === 'cancelled';
}

function relevance(value: unknown): value is EventFocusWindowRelevance {
  return value === 'seeking' || value === 'offering' || value === 'both';
}

function boundedRatio(value: unknown): number | null {
  if (!finiteNumber(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function normalizeParticipantWindow(raw: unknown): ParticipantEventFocusWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.window_id)
    || !stringValue(row.event_id)
    || !intentKey(row.intent_key)
    || !focusFormat(row.format)
    || !stringValue(row.title)
    || !stringValue(row.location_label)
    || !stringValue(row.starts_at)
    || !stringValue(row.ends_at)
    || !finiteNumber(row.capacity)
    || !finiteNumber(row.joined_count)
    || !finiteNumber(row.spots_remaining)
    || typeof row.is_joined !== 'boolean'
    || !relevance(row.relevance)
    || !participantPhase(row.phase)
  ) return null;

  return {
    window_id: row.window_id,
    event_id: row.event_id,
    intent_key: row.intent_key,
    format: row.format,
    title: row.title,
    location_label: row.location_label,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    capacity: Math.max(0, Math.floor(row.capacity)),
    joined_count: Math.max(0, Math.floor(row.joined_count)),
    spots_remaining: Math.max(0, Math.floor(row.spots_remaining)),
    is_joined: row.is_joined,
    relevance: row.relevance,
    phase: row.phase,
  };
}

function normalizeHostWindow(raw: unknown): HostEventFocusWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.window_id)
    || !stringValue(row.event_id)
    || !intentKey(row.intent_key)
    || !focusFormat(row.format)
    || !stringValue(row.title)
    || !stringValue(row.location_label)
    || !stringValue(row.starts_at)
    || !stringValue(row.ends_at)
    || !finiteNumber(row.capacity)
    || !finiteNumber(row.joined_count)
    || !hostState(row.state)
    || !hostPhase(row.phase)
    || !stringValue(row.created_at)
  ) return null;

  return {
    window_id: row.window_id,
    event_id: row.event_id,
    intent_key: row.intent_key,
    format: row.format,
    title: row.title,
    location_label: row.location_label,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    capacity: Math.max(0, Math.floor(row.capacity)),
    joined_count: Math.max(0, Math.floor(row.joined_count)),
    state: row.state,
    phase: row.phase,
    created_at: row.created_at,
  };
}

function normalizeOutcome(raw: unknown): EventFocusWindowOutcome | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !stringValue(row.window_id)
    || typeof row.supported !== 'boolean'
    || !stringValue(row.observation_ends_at)
  ) return null;

  if (!row.supported) {
    return {
      window_id: row.window_id,
      supported: false,
      opt_in_count: null,
      new_mutual_count: null,
      participants_with_new_mutuals: null,
      participant_outcome_share: null,
      observation_ends_at: row.observation_ends_at,
    };
  }

  if (
    !finiteNumber(row.opt_in_count)
    || !finiteNumber(row.new_mutual_count)
    || !finiteNumber(row.participants_with_new_mutuals)
  ) return null;
  const outcomeShare = boundedRatio(row.participant_outcome_share);
  if (outcomeShare == null) return null;

  return {
    window_id: row.window_id,
    supported: true,
    opt_in_count: Math.max(0, Math.floor(row.opt_in_count)),
    new_mutual_count: Math.max(0, Math.floor(row.new_mutual_count)),
    participants_with_new_mutuals: Math.max(0, Math.floor(row.participants_with_new_mutuals)),
    participant_outcome_share: outcomeShare,
    observation_ends_at: row.observation_ends_at,
  };
}

function normalizePlaybook(raw: unknown): EventFocusWindowPlaybookRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (
    !intentKey(row.intent_key)
    || !focusFormat(row.format)
    || !finiteNumber(row.supported_window_count)
    || !finiteNumber(row.event_count)
    || !finiteNumber(row.opt_in_count)
    || !finiteNumber(row.participants_with_new_mutuals)
    || !stringValue(row.latest_window_at)
  ) return null;
  const outcomeShare = boundedRatio(row.participant_outcome_share);
  const evidenceWeight = boundedRatio(row.evidence_weight);
  if (outcomeShare == null || evidenceWeight == null) return null;

  return {
    intent_key: row.intent_key,
    format: row.format,
    supported_window_count: Math.max(0, Math.floor(row.supported_window_count)),
    event_count: Math.max(0, Math.floor(row.event_count)),
    opt_in_count: Math.max(0, Math.floor(row.opt_in_count)),
    participants_with_new_mutuals: Math.max(0, Math.floor(row.participants_with_new_mutuals)),
    participant_outcome_share: outcomeShare,
    evidence_weight: evidenceWeight,
    latest_window_at: row.latest_window_at,
  };
}

export async function getMyEventFocusWindows(
  eventId: string,
): Promise<{ data: ParticipantEventFocusWindow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_event_focus_windows', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const window = normalizeParticipantWindow(raw);
      return window ? [window] : [];
    }),
    error,
  };
}

export async function setMyEventFocusWindowOptIn(
  windowId: string,
  join: boolean,
): Promise<{ data: EventFocusWindowOptInResult | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('set_my_event_focus_window_opt_in', {
      p_window_id: windowId,
      p_join: join,
    })
    .maybeSingle();

  if (!data || typeof data !== 'object') return { data: null, error };
  const row = data as Record<string, unknown>;
  if (
    !stringValue(row.window_id)
    || !finiteNumber(row.joined_count)
    || !finiteNumber(row.spots_remaining)
    || typeof row.is_joined !== 'boolean'
  ) return { data: null, error };

  return {
    data: {
      window_id: row.window_id,
      joined_count: Math.max(0, Math.floor(row.joined_count)),
      spots_remaining: Math.max(0, Math.floor(row.spots_remaining)),
      is_joined: row.is_joined,
    },
    error,
  };
}

export async function createEventFocusWindow(input: {
  eventId: string;
  intentKey: EventIntentKey;
  format: EventFocusWindowFormat;
  title: string;
  locationLabel: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}): Promise<{ data: HostEventFocusWindow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('create_event_focus_window', {
      p_event_id: input.eventId,
      p_intent_key: input.intentKey,
      p_format: input.format,
      p_title: input.title.trim(),
      p_location_label: input.locationLabel.trim(),
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_capacity: Math.max(4, Math.min(80, Math.floor(input.capacity))),
    })
    .maybeSingle();

  if (!data || typeof data !== 'object') return { data: null, error };
  const row = data as Record<string, unknown>;
  const normalized = normalizeHostWindow({
    ...row,
    window_id: row.window_id,
    joined_count: 0,
    phase: Date.parse(String(row.starts_at)) > Date.now() ? 'upcoming' : 'live',
  });
  return { data: normalized, error };
}

export async function getHostEventFocusWindows(
  eventId: string,
): Promise<{ data: HostEventFocusWindow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_host_event_focus_windows', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const window = normalizeHostWindow(raw);
      return window ? [window] : [];
    }),
    error,
  };
}

export async function setHostEventFocusWindowState(
  windowId: string,
  state: 'closed' | 'cancelled',
): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('set_host_event_focus_window_state', {
    p_window_id: windowId,
    p_state: state,
  });
  return { changed: data === true, error };
}

export async function getHostEventFocusWindowOutcomes(
  eventId: string,
): Promise<{ data: EventFocusWindowOutcome[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_host_event_focus_window_outcomes', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const outcome = normalizeOutcome(raw);
      return outcome ? [outcome] : [];
    }),
    error,
  };
}

/**
 * Host-private historical evidence only. The playbook requires at least three
 * supported windows across two ended events. It is an observational ranking
 * prior and never publishes or authorizes a new window on its own.
 */
export async function getMyFocusWindowPlaybook(): Promise<{
  data: EventFocusWindowPlaybookRow[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_my_focus_window_playbook');
  return {
    data: (data ?? []).flatMap((raw: unknown) => {
      const row = normalizePlaybook(raw);
      return row ? [row] : [];
    }),
    error,
  };
}
