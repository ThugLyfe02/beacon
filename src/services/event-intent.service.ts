import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const EVENT_INTENT_KEYS = [
  'capital',
  'hiring',
  'partnerships',
  'customers',
  'technical',
  'product',
  'design',
  'media',
  'mentorship',
  'community',
  'research',
  'operations',
] as const;

export type EventIntentKey = typeof EVENT_INTENT_KEYS[number];

export const EVENT_INTENT_LABELS: Record<EventIntentKey, string> = {
  capital: 'Capital',
  hiring: 'Hiring',
  partnerships: 'Partnerships',
  customers: 'Customers',
  technical: 'Technical',
  product: 'Product',
  design: 'Design',
  media: 'Media',
  mentorship: 'Mentorship',
  community: 'Community',
  research: 'Research',
  operations: 'Operations',
};

export interface MyEventIntent {
  event_id: string;
  user_id: string;
  seeking: EventIntentKey[];
  offering: EventIntentKey[];
  enabled: boolean;
  updated_at: string;
}

export interface DeclaredFitRow {
  target_user_id: string;
  they_can_help_with: EventIntentKey[];
  i_can_help_with: EventIntentKey[];
  fit_strength: number;
  two_way: boolean;
}

export interface EventIntentMixRow {
  intent_key: EventIntentKey;
  seeking_count: number;
  offering_count: number;
  contributor_count: number;
  balance: 'need-heavy' | 'offer-heavy' | 'balanced';
}

function allowedKey(value: unknown): value is EventIntentKey {
  return typeof value === 'string' && (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function sanitizeKeys(values: unknown): EventIntentKey[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(allowedKey))].sort();
}

function normalizeIntent(row: unknown): MyEventIntent | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  if (typeof value.event_id !== 'string' || typeof value.user_id !== 'string') return null;
  if (typeof value.enabled !== 'boolean' || typeof value.updated_at !== 'string') return null;
  return {
    event_id: value.event_id,
    user_id: value.user_id,
    seeking: sanitizeKeys(value.seeking),
    offering: sanitizeKeys(value.offering),
    enabled: value.enabled,
    updated_at: value.updated_at,
  };
}

function normalizeDeclaredFit(row: unknown): DeclaredFitRow | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  if (typeof value.target_user_id !== 'string') return null;
  if (typeof value.fit_strength !== 'number' || !Number.isFinite(value.fit_strength)) return null;
  return {
    target_user_id: value.target_user_id,
    they_can_help_with: sanitizeKeys(value.they_can_help_with),
    i_can_help_with: sanitizeKeys(value.i_can_help_with),
    fit_strength: Math.max(0, Math.min(1, value.fit_strength)),
    two_way: value.two_way === true,
  };
}

export async function getMyEventIntent(
  eventId: string,
): Promise<{ data: MyEventIntent | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_my_event_intent', { p_event_id: eventId })
    .maybeSingle();

  return { data: normalizeIntent(data), error };
}

export async function setMyEventIntent(input: {
  eventId: string;
  seeking: EventIntentKey[];
  offering: EventIntentKey[];
  enabled?: boolean;
}): Promise<{ data: MyEventIntent | null; error: PostgrestError | null }> {
  const seeking = sanitizeKeys(input.seeking).slice(0, 6);
  const offering = sanitizeKeys(input.offering).slice(0, 6);
  const { data, error } = await supabase
    .rpc('set_my_event_intent', {
      p_event_id: input.eventId,
      p_seeking: seeking,
      p_offering: offering,
      p_enabled: input.enabled ?? true,
    })
    .maybeSingle();

  return { data: normalizeIntent(data), error };
}

/**
 * Returns only pairwise intersections. It never fetches another participant's
 * complete event-intent profile. The database also applies discoverability,
 * approved-participant, block, and event-lifecycle gates.
 */
export async function getEventDeclaredFit(
  eventId: string,
): Promise<{ data: DeclaredFitRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_declared_fit', {
    p_event_id: eventId,
  });
  return {
    data: (data ?? []).flatMap((row) => {
      const normalized = normalizeDeclaredFit(row);
      return normalized ? [normalized] : [];
    }),
    error,
  };
}

export async function getEventIntentMix(
  eventId: string,
): Promise<{ data: EventIntentMixRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_intent_mix', {
    p_event_id: eventId,
  });

  const rows = (data ?? []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (!allowedKey(row.intent_key)) return [];
    if (
      typeof row.seeking_count !== 'number'
      || typeof row.offering_count !== 'number'
      || typeof row.contributor_count !== 'number'
    ) return [];
    const balance = row.balance;
    if (balance !== 'need-heavy' && balance !== 'offer-heavy' && balance !== 'balanced') return [];
    return [{
      intent_key: row.intent_key,
      seeking_count: Math.max(0, Math.floor(row.seeking_count)),
      offering_count: Math.max(0, Math.floor(row.offering_count)),
      contributor_count: Math.max(0, Math.floor(row.contributor_count)),
      balance,
    } satisfies EventIntentMixRow];
  });

  return { data: rows, error };
}
