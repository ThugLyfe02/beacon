import type { PostgrestError } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import type {
  OutcomeReceiptAlignmentState,
  OutcomeReceiptLifecycleState,
  OutcomeReceiptOriginContext,
  OutcomeReceiptSystemEvidence,
  OutcomeReceiptType,
} from '../outcomes/OutcomeReceiptModel';

export interface ParticipantOutcomeReceipt {
  receiptEventId: string | null;
  streamId: string | null;
  lifecycleState: OutcomeReceiptLifecycleState;
  receiptType: OutcomeReceiptType | null;
  revision: number;
  alignmentState: OutcomeReceiptAlignmentState;
  counterpartReceiptType: OutcomeReceiptType | null;
  compatibilityCode: string | null;
  domains: string[];
  originContext: OutcomeReceiptOriginContext;
  systemEvidence: OutcomeReceiptSystemEvidence[];
  submittedAt: string | null;
  canSubmit: boolean;
  observationClosesAt: string;
}

export interface EventOutcomeReceiptSummary {
  supported: boolean;
  totalMutualMatches: number | null;
  mutualsWithParticipantReceipt: number | null;
  mutualsWithCompatibleReceipts: number | null;
  mutualsWithBilateralConfirmation: number | null;
  receiptShareOfMutuals: number | null;
  compatibleReceiptShareOfMutuals: number | null;
  bilateralConfirmationShareOfMutuals: number | null;
}

export interface EventOutcomeReceiptTypeEvidence {
  receiptType: OutcomeReceiptType;
  mutualMatchCount: number;
  bilateralConfirmedMatchCount: number;
  shareOfAttestedMutuals: number;
}

export interface EventOutcomeReceiptDomainEvidence {
  intentKey: string;
  mutualMatchCount: number;
  compatibleReceiptMatchCount: number;
  bilateralConfirmedMatchCount: number;
}

export interface CommunityExchangeOutcomeReceiptSummary {
  supported: boolean;
  communityAName: string;
  communityBName: string;
  crossCommunityMutualCount: number | null;
  mutualsWithParticipantReceipt: number | null;
  compatibleReceiptMatchCount: number | null;
  bilateralConfirmedMatchCount: number | null;
  receiptShareOfCrossCommunityMutuals: number | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? first as Record<string, unknown> : null;
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function mapReceipt(data: unknown): ParticipantOutcomeReceipt | null {
  const row = asObject(data);
  const lifecycle = text(row?.lifecycle_state) as OutcomeReceiptLifecycleState | null;
  const alignment = text(row?.alignment_state) as OutcomeReceiptAlignmentState | null;
  const observationClosesAt = text(row?.observation_closes_at);
  if (!row || !lifecycle || !alignment || !observationClosesAt) return null;

  return {
    receiptEventId: text(row.receipt_event_id),
    streamId: text(row.stream_id),
    lifecycleState: lifecycle,
    receiptType: text(row.receipt_type) as OutcomeReceiptType | null,
    revision: numberOrNull(row.revision) ?? 0,
    alignmentState: alignment,
    counterpartReceiptType: text(row.counterpart_receipt_type) as OutcomeReceiptType | null,
    compatibilityCode: text(row.compatibility_code),
    domains: textArray(row.domains),
    originContext: (text(row.origin_context) ?? 'direct-mutual') as OutcomeReceiptOriginContext,
    systemEvidence: textArray(row.system_evidence) as OutcomeReceiptSystemEvidence[],
    submittedAt: text(row.submitted_at),
    canSubmit: boolean(row.can_submit),
    observationClosesAt,
  };
}

async function createIdempotencyKey(prefix: 'submit' | 'withdraw'): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(24);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `outcome-receipt-${prefix}-${token}`;
}

export async function getMyOutcomeReceipt(
  matchId: string,
): Promise<{ data: ParticipantOutcomeReceipt | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_my_outcome_receipt', { p_match_id: matchId });
  return { data: error ? null : mapReceipt(data), error };
}

export async function submitMyOutcomeReceipt(input: {
  matchId: string;
  receiptType: OutcomeReceiptType;
}): Promise<{ data: ParticipantOutcomeReceipt | null; error: PostgrestError | null }> {
  const idempotencyKey = await createIdempotencyKey('submit');
  const { data, error } = await supabase.rpc('submit_my_outcome_receipt', {
    p_match_id: input.matchId,
    p_receipt_type: input.receiptType,
    p_idempotency_key: idempotencyKey,
  });
  return { data: error ? null : mapReceipt(data), error };
}

export async function withdrawMyOutcomeReceipt(
  matchId: string,
): Promise<{ data: ParticipantOutcomeReceipt | null; error: PostgrestError | null }> {
  const idempotencyKey = await createIdempotencyKey('withdraw');
  const { data, error } = await supabase.rpc('withdraw_my_outcome_receipt', {
    p_match_id: matchId,
    p_idempotency_key: idempotencyKey,
  });
  return { data: error ? null : mapReceipt(data), error };
}

export async function getEventOutcomeReceiptSummary(
  eventId: string,
): Promise<{ data: EventOutcomeReceiptSummary | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_outcome_receipt_summary', { p_event_id: eventId });
  const row = asObject(data);
  if (error || !row || typeof row.supported !== 'boolean') return { data: null, error };
  return {
    data: {
      supported: row.supported,
      totalMutualMatches: numberOrNull(row.total_mutual_matches),
      mutualsWithParticipantReceipt: numberOrNull(row.mutuals_with_participant_receipt),
      mutualsWithCompatibleReceipts: numberOrNull(row.mutuals_with_compatible_receipts),
      mutualsWithBilateralConfirmation: numberOrNull(row.mutuals_with_bilateral_confirmation),
      receiptShareOfMutuals: numberOrNull(row.receipt_share_of_mutuals),
      compatibleReceiptShareOfMutuals: numberOrNull(row.compatible_receipt_share_of_mutuals),
      bilateralConfirmationShareOfMutuals: numberOrNull(row.bilateral_confirmation_share_of_mutuals),
    },
    error: null,
  };
}

export async function getEventOutcomeReceiptTypes(
  eventId: string,
): Promise<{ data: EventOutcomeReceiptTypeEvidence[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_outcome_receipt_types', { p_event_id: eventId });
  if (error) return { data: [], error };
  const rows = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const receiptType = text(row.receipt_type) as OutcomeReceiptType | null;
    const matchCount = numberOrNull(row.mutual_match_count);
    const bilateral = numberOrNull(row.bilateral_confirmed_match_count);
    const share = numberOrNull(row.share_of_attested_mutuals);
    if (!receiptType || matchCount == null || bilateral == null || share == null) return [];
    return [{
      receiptType,
      mutualMatchCount: matchCount,
      bilateralConfirmedMatchCount: bilateral,
      shareOfAttestedMutuals: share,
    }];
  });
  return { data: rows, error: null };
}

export async function getEventOutcomeReceiptDomains(
  eventId: string,
): Promise<{ data: EventOutcomeReceiptDomainEvidence[]; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_event_outcome_receipt_domains', { p_event_id: eventId });
  if (error) return { data: [], error };
  const rows = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const intentKey = text(row.intent_key);
    const matchCount = numberOrNull(row.mutual_match_count);
    const compatible = numberOrNull(row.compatible_receipt_match_count);
    const bilateral = numberOrNull(row.bilateral_confirmed_match_count);
    if (!intentKey || matchCount == null || compatible == null || bilateral == null) return [];
    return [{
      intentKey,
      mutualMatchCount: matchCount,
      compatibleReceiptMatchCount: compatible,
      bilateralConfirmedMatchCount: bilateral,
    }];
  });
  return { data: rows, error: null };
}

export async function getCommunityExchangeOutcomeReceiptSummary(
  exchangeId: string,
): Promise<{ data: CommunityExchangeOutcomeReceiptSummary | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('get_community_exchange_outcome_receipt_summary', {
    p_exchange_id: exchangeId,
  });
  const row = asObject(data);
  const communityAName = text(row?.community_a_name);
  const communityBName = text(row?.community_b_name);
  if (error || !row || typeof row.supported !== 'boolean' || !communityAName || !communityBName) {
    return { data: null, error };
  }
  return {
    data: {
      supported: row.supported,
      communityAName,
      communityBName,
      crossCommunityMutualCount: numberOrNull(row.cross_community_mutual_count),
      mutualsWithParticipantReceipt: numberOrNull(row.mutuals_with_participant_receipt),
      compatibleReceiptMatchCount: numberOrNull(row.compatible_receipt_match_count),
      bilateralConfirmedMatchCount: numberOrNull(row.bilateral_confirmed_match_count),
      receiptShareOfCrossCommunityMutuals: numberOrNull(row.receipt_share_of_cross_community_mutuals),
    },
    error: null,
  };
}
