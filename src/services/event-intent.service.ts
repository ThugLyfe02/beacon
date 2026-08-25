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

export interface DeclaredFitMutualSummary {
  supported: boolean;
  total_mutual_matches: number | null;
  declared_fit_mutual_matches: number | null;
  two_way_declared_fit_mutual_matches: number | null;
  declared_fit_share: number | null;
  two_way_share: number | null;
}

export interface DeclaredFitMutualDomain {
  intent_key: EventIntentKey;
  mutual_match_count: number;
  two_way_match_count: number;
  two_way_share: number;
}

function allowedKey(value: unknown): value is EventIntentKey {
  return typeof value === 'string' && (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function sanitizeKeys(values: unknown): EventIntentKey[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(allowedKey))].sort();
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
  if (!finiteNumber(value.fit_strength)) return null;
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
 * Returns only pairwise intersections for target ids already visible in the
 * caller's live physical field. It never fetches another participant's complete
 * event-intent profile, and it cannot be used as an event-wide fit directory.
 * The database also applies discoverability, approved-participant, block, and
 * event-lifecycle gates.
 */
export async function getEventDeclaredFit(
  eventId: string,
  liveTargetUserIds: string[],
): Promise<{ data: DeclaredFitRow[]; error: PostgrestError | null }> {
  const targetIds = [...new Set(liveTargetUserIds.filter(Boolean))].sort().slice(0, 128);
  if (targetIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase.rpc('get_event_declared_fit', {
    p_event_id: eventId,
    p_target_user_ids: targetIds,
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
      !finiteNumber(row.seeking_count)
      || !finiteNumber(row.offering_count)
      || !finiteNumber(row.contributor_count)
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

/**
 * Host-only composition of real mutual matches. This intentionally does not call
 * itself a conversion rate: Beacon does not persist every pairwise fit exposure.
 * The server withholds counts until at least five mutual outcomes exist.
 */
export async function getDeclaredFitMutualSummary(
  eventId: string,
): Promise<{ data: DeclaredFitMutualSummary | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .rpc('get_declared_fit_mutual_summary', { p_event_id: eventId })
    .maybeSingle();

  if (!data || typeof data !== 'object') return { data: null, error };
  const row = data as Record<string, unknown>;
  const supported = row.supported === true;
  if (!supported) {
    return {
      data: {
        supported: false,
        total_mutual_matches: null,
        declared_fit_mutual_matches: null,
        two_way_declared_fit_mutual_matches: null,
        declared_fit_share: null,
        two_way_share: null,
      },
      error,
    };
  }

  if (
    !finiteNumber(row.total_mutual_matches)
    || !finiteNumber(row.declared_fit_mutual_matches)
    || !finiteNumber(row.two_way_declared_fit_mutual_matches)
    || !finiteNumber(row.declared_fit_share)
    || !finiteNumber(row.two_way_share)
  ) return { data: null, error };

  return {
    data: {
      supported: true,
      total_mutual_matches: Math.max(0, Math.floor(row.total_mutual_matches)),
      declared_fit_mutual_matches: Math.max(0, Math.floor(row.declared_fit_mutual_matches)),
      two_way_declared_fit_mutual_matches: Math.max(0, Math.floor(row.two_way_declared_fit_mutual_matches)),
      declared_fit_share: Math.max(0, Math.min(1, row.declared_fit_share)),
      two_way_share: Math.max(0, Math.min(1, row.two_way_share)),
    },
    error,
  };
}

export async function getDeclaredFitMutualDomains(
  eventId: string,
): Promise<{ data: DeclaredFitMutualDomain[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_declared_fit_mutual_domains', {
    p_event_id: eventId,
  });

  const rows = (data ?? []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (!allowedKey(row.intent_key)) return [];
    if (
      !finiteNumber(row.mutual_match_count)
      || !finiteNumber(row.two_way_match_count)
      || !finiteNumber(row.two_way_share)
    ) return [];
    return [{
      intent_key: row.intent_key,
      mutual_match_count: Math.max(0, Math.floor(row.mutual_match_count)),
      two_way_match_count: Math.max(0, Math.floor(row.two_way_match_count)),
      two_way_share: Math.max(0, Math.min(1, row.two_way_share)),
    } satisfies DeclaredFitMutualDomain];
  });

  return { data: rows, error };
}
