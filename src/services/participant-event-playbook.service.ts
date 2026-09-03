import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  EVENT_INTENT_KEYS,
  type EventIntentKey,
} from './event-intent.service';
import type { ParticipantEventHistoryRow } from '../intents/ParticipantEventPlaybook';

function isIntentKey(value: unknown): value is EventIntentKey {
  return typeof value === 'string'
    && (EVENT_INTENT_KEYS as readonly string[]).includes(value);
}

function finiteNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function timestamp(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHistoryRow(raw: unknown): ParticipantEventHistoryRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (!isIntentKey(row.intent_key)) return null;

  const seekingEventCount = finiteNonNegativeInteger(row.seeking_event_count);
  const offeringEventCount = finiteNonNegativeInteger(row.offering_event_count);
  const declaredEventCount = finiteNonNegativeInteger(row.declared_event_count);
  const observedMutualCount = finiteNonNegativeInteger(row.observed_mutual_count);
  const twoWayMutualCount = finiteNonNegativeInteger(row.two_way_mutual_count);
  const alignedOutcomeCount = finiteNonNegativeInteger(row.aligned_outcome_count);
  const completedOutcomeCount = finiteNonNegativeInteger(row.completed_outcome_count);

  if (
    seekingEventCount == null
    || offeringEventCount == null
    || declaredEventCount == null
    || observedMutualCount == null
    || twoWayMutualCount == null
    || alignedOutcomeCount == null
    || completedOutcomeCount == null
  ) return null;

  return {
    intentKey: row.intent_key,
    seekingEventCount,
    offeringEventCount,
    declaredEventCount,
    observedMutualCount,
    twoWayMutualCount: Math.min(twoWayMutualCount, observedMutualCount),
    alignedOutcomeCount: Math.min(alignedOutcomeCount, observedMutualCount),
    completedOutcomeCount: Math.min(completedOutcomeCount, alignedOutcomeCount, observedMutualCount),
    lastDeclaredAt: timestamp(row.last_declared_at),
    lastOutcomeAt: timestamp(row.last_outcome_at),
  };
}

/**
 * Returns caller-private evidence from ended events while the caller prepares an
 * approved current event. The client never reads historical declarations,
 * mutual-pair context, or outcome rows directly; the server emits only bounded
 * domain counts with no counterpart identities.
 */
export async function getMyEventPlaybook(
  currentEventId: string,
): Promise<{ data: ParticipantEventHistoryRow[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_event_playbook', {
    p_current_event_id: currentEventId,
  });

  const rows = ((data ?? []) as unknown[]).flatMap((raw: unknown) => {
    const normalized = normalizeHistoryRow(raw);
    return normalized ? [normalized] : [];
  });

  return { data: rows, error };
}
