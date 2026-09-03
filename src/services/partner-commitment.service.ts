import type { PostgrestError } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import type {
  PartnerCommitmentAcceptanceState,
  PartnerCommitmentEvidenceQuality,
  PartnerCommitmentMeasurementReviewState,
  PartnerCommitmentMeasurementState,
  PartnerCommitmentPartyKind,
  PartnerCommitmentScopeKind,
  PartnerCommitmentStatus,
  PartnerCommitmentType,
} from '../partners/PartnerCommitmentModel';

export interface PartnerCommitmentScope {
  scopeId: string;
  scopeKind: PartnerCommitmentScopeKind;
  programId: string | null;
  programName: string | null;
  eventId: string | null;
  exchangeId: string | null;
  communityAId: string;
  communityAName: string;
  communityBId: string;
  communityBName: string;
  hostId: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventEndedAt: string | null;
  scopeState: string;
  callerRoles: string[];
  canPrefillProgram: boolean;
}

export interface PartnerCommitmentRow {
  commitmentId: string;
  revisionId: string;
  revisionNo: number;
  effectiveRevisionId: string | null;
  pendingRevisionId: string | null;
  committedPartyKind: PartnerCommitmentPartyKind;
  committedCommunityId: string | null;
  committedPartyLabel: string;
  commitmentType: PartnerCommitmentType;
  domain: string | null;
  committedQuantity: number;
  windowStart: string | null;
  windowEnd: string | null;
  acceptanceState: PartnerCommitmentAcceptanceState;
  lifecycleStatus: PartnerCommitmentStatus;
  requiredRoles: string[];
  callerPendingDecision: boolean;
  callerCanManage: boolean;
  deliveredQuantity: number | null;
  utilizedQuantity: number | null;
  measurementState: PartnerCommitmentMeasurementState;
  evidenceQuality: PartnerCommitmentEvidenceQuality;
  evidenceSources: string[];
  supportedBilateralOutcomes: number | null;
  supportedWarmIntroductions: number | null;
  sourceTemplateRevisionId: string | null;
  createdAt: string;
  pendingCommitmentType: PartnerCommitmentType | null;
  pendingDomain: string | null;
  pendingCommittedQuantity: number | null;
  pendingAcceptanceState: PartnerCommitmentAcceptanceState | null;
  callerPendingAmendmentDecision: boolean;
  latestMeasurementId: string | null;
  manualMeasurementId: string | null;
  measurementReviewState: PartnerCommitmentMeasurementReviewState;
  callerCanReviewMeasurement: boolean;
}

export interface PartnerCommitmentHistoryRow {
  revisionId: string;
  revisionNo: number;
  commitmentType: PartnerCommitmentType;
  domain: string | null;
  committedQuantity: number;
  windowStart: string | null;
  windowEnd: string | null;
  acceptanceState: PartnerCommitmentAcceptanceState;
  lifecycleStatus: PartnerCommitmentStatus;
  deliveredQuantity: number | null;
  utilizedQuantity: number | null;
  measurementState: PartnerCommitmentMeasurementState;
  evidenceQuality: PartnerCommitmentEvidenceQuality;
  createdAt: string;
}

export interface PartnerProgramCommitmentMemoryRow {
  partyKind: PartnerCommitmentPartyKind;
  partyCommunityId: string | null;
  partyLabel: string;
  commitmentType: PartnerCommitmentType;
  domain: string | null;
  sampleEventCount: number;
  commitmentOccurrences: number;
  measuredEventCount: number;
  measurementCoverage: number;
  averageCommittedQuantity: number;
  averageDeliveredQuantity: number | null;
  averageUtilizedQuantity: number | null;
  utilizedEventCount: number;
  unusedMeasuredEventCount: number;
  zeroUtilizationMeasuredEventCount: number;
  suggestedQuantity: number | null;
  latestEventEndedAt: string | null;
}

export interface EventPartnerCommitmentSummary {
  exchangeLedgerCount: number;
  acceptedCommitmentCount: number;
  scheduledOrDeliveringCount: number;
  fulfilledCommitmentCount: number;
  partiallyFulfilledCount: number;
  unresolvedCommitmentCount: number;
  pendingAmendmentCount: number;
  manualReviewPendingCount: number;
  manualDisputeCount: number;
  closedWithoutMeasurementCount: number;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

async function idempotencyKey(prefix: string): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(24);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `partner-commitment-${prefix}-${token}`;
}

function mapScope(data: unknown): PartnerCommitmentScope | null {
  const row = asObject(data);
  const scopeId = text(row?.scope_id);
  const scopeKind = text(row?.scope_kind) as PartnerCommitmentScopeKind | null;
  const communityAId = text(row?.community_a_id);
  const communityAName = text(row?.community_a_name);
  const communityBId = text(row?.community_b_id);
  const communityBName = text(row?.community_b_name);
  const scopeState = text(row?.scope_state);
  if (!row || !scopeId || !scopeKind || !communityAId || !communityAName || !communityBId || !communityBName || !scopeState) return null;
  return {
    scopeId,
    scopeKind,
    programId: text(row.program_id),
    programName: text(row.program_name),
    eventId: text(row.event_id),
    exchangeId: text(row.exchange_id),
    communityAId,
    communityAName,
    communityBId,
    communityBName,
    hostId: text(row.host_id),
    eventStartsAt: text(row.event_starts_at),
    eventEndsAt: text(row.event_ends_at),
    eventEndedAt: text(row.event_ended_at),
    scopeState,
    callerRoles: stringArray(row.caller_roles),
    canPrefillProgram: row.can_prefill_program === true,
  };
}

function mapLedgerRow(raw: unknown): PartnerCommitmentRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const commitmentId = text(row.commitment_id);
  const revisionId = text(row.revision_id);
  const partyLabel = text(row.committed_party_label);
  const commitmentType = text(row.commitment_type) as PartnerCommitmentType | null;
  const acceptanceState = text(row.acceptance_state) as PartnerCommitmentAcceptanceState | null;
  const lifecycleStatus = text(row.lifecycle_status) as PartnerCommitmentStatus | null;
  const createdAt = text(row.created_at);
  const committedQuantity = numberOrNull(row.committed_quantity);
  if (!commitmentId || !revisionId || !partyLabel || !commitmentType || !acceptanceState || !lifecycleStatus || !createdAt || committedQuantity == null) return null;
  return {
    commitmentId,
    revisionId,
    revisionNo: numberOrNull(row.revision_no) ?? 1,
    effectiveRevisionId: text(row.effective_revision_id),
    pendingRevisionId: text(row.pending_revision_id),
    committedPartyKind: (text(row.committed_party_kind) ?? 'community') as PartnerCommitmentPartyKind,
    committedCommunityId: text(row.committed_community_id),
    committedPartyLabel: partyLabel,
    commitmentType,
    domain: text(row.domain),
    committedQuantity,
    windowStart: text(row.window_start),
    windowEnd: text(row.window_end),
    acceptanceState,
    lifecycleStatus,
    requiredRoles: stringArray(row.required_roles),
    callerPendingDecision: row.caller_pending_decision === true,
    callerCanManage: row.caller_can_manage === true,
    deliveredQuantity: numberOrNull(row.delivered_quantity),
    utilizedQuantity: numberOrNull(row.utilized_quantity),
    measurementState: (text(row.measurement_state) ?? 'not-measured') as PartnerCommitmentMeasurementState,
    evidenceQuality: (text(row.evidence_quality) ?? 'insufficient') as PartnerCommitmentEvidenceQuality,
    evidenceSources: stringArray(row.evidence_sources),
    supportedBilateralOutcomes: numberOrNull(row.supported_bilateral_outcomes),
    supportedWarmIntroductions: numberOrNull(row.supported_warm_introductions),
    sourceTemplateRevisionId: text(row.source_template_revision_id),
    createdAt,
    pendingCommitmentType: text(row.pending_commitment_type) as PartnerCommitmentType | null,
    pendingDomain: text(row.pending_domain),
    pendingCommittedQuantity: numberOrNull(row.pending_committed_quantity),
    pendingAcceptanceState: text(row.pending_acceptance_state) as PartnerCommitmentAcceptanceState | null,
    callerPendingAmendmentDecision: row.caller_pending_amendment_decision === true,
    latestMeasurementId: text(row.latest_measurement_id),
    manualMeasurementId: text(row.manual_measurement_id),
    measurementReviewState: (text(row.measurement_review_state) ?? 'not-required') as PartnerCommitmentMeasurementReviewState,
    callerCanReviewMeasurement: row.caller_can_review_measurement === true,
  };
}

export async function ensurePartnerCommitmentScope(input:
  | { scopeKind: 'program-template'; programId: string }
  | { scopeKind: 'event-exchange'; exchangeId: string },
): Promise<{ data: PartnerCommitmentScope | null; error: PostgrestError | null }> {
  const ensureRpc = input.scopeKind === 'program-template'
    ? supabase.rpc('ensure_partner_program_commitment_scope', { p_program_id: input.programId })
    : supabase.rpc('ensure_partner_exchange_commitment_scope', { p_exchange_id: input.exchangeId });
  const { data: scopeId, error } = await ensureRpc;
  if (error || typeof scopeId !== 'string') return { data: null, error };
  const result = await supabase.rpc('get_partner_commitment_scope', { p_scope_id: scopeId });
  return { data: result.error ? null : mapScope(result.data), error: result.error };
}

export async function getPartnerCommitmentLedger(scopeId: string): Promise<{
  data: PartnerCommitmentRow[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_commitment_ledger', { p_scope_id: scopeId });
  if (error) return { data: [], error };
  return {
    data: (Array.isArray(data) ? data : []).flatMap((row) => {
      const mapped = mapLedgerRow(row);
      return mapped ? [mapped] : [];
    }),
    error: null,
  };
}

export async function proposePartnerCommitment(input: {
  scopeId: string;
  partyKind: PartnerCommitmentPartyKind;
  communityId?: string | null;
  commitmentType: PartnerCommitmentType;
  domain?: string | null;
  committedQuantity: number;
  windowStart?: string | null;
  windowEnd?: string | null;
}): Promise<{ commitmentId: string | null; error: PostgrestError | null }> {
  const key = await idempotencyKey('propose');
  const { data, error } = await supabase.rpc('propose_partner_commitment', {
    p_scope_id: input.scopeId,
    p_party_kind: input.partyKind,
    p_community_id: input.communityId ?? null,
    p_commitment_type: input.commitmentType,
    p_domain: input.domain ?? null,
    p_committed_quantity: input.committedQuantity,
    p_window_start: input.windowStart ?? null,
    p_window_end: input.windowEnd ?? null,
    p_idempotency_key: key,
  });
  return { commitmentId: typeof data === 'string' ? data : null, error };
}

export async function revisePartnerCommitment(input: {
  commitmentId: string;
  commitmentType: PartnerCommitmentType;
  domain?: string | null;
  committedQuantity: number;
  windowStart?: string | null;
  windowEnd?: string | null;
}): Promise<{ revisionId: string | null; error: PostgrestError | null }> {
  const key = await idempotencyKey('revise');
  const { data, error } = await supabase.rpc('revise_partner_commitment', {
    p_commitment_id: input.commitmentId,
    p_commitment_type: input.commitmentType,
    p_domain: input.domain ?? null,
    p_committed_quantity: input.committedQuantity,
    p_window_start: input.windowStart ?? null,
    p_window_end: input.windowEnd ?? null,
    p_idempotency_key: key,
  });
  return { revisionId: typeof data === 'string' ? data : null, error };
}

export async function decidePartnerCommitment(
  revisionId: string,
  decision: 'accepted' | 'rejected' | 'withdrawn',
): Promise<{ state: PartnerCommitmentAcceptanceState | null; error: PostgrestError | null }> {
  const key = await idempotencyKey(`decision-${decision}`);
  const { data, error } = await supabase.rpc('decide_partner_commitment_revision', {
    p_revision_id: revisionId,
    p_decision: decision,
    p_idempotency_key: key,
  });
  const state = typeof data === 'string' ? data as PartnerCommitmentAcceptanceState : null;
  return { state, error };
}

export async function refreshPartnerCommitmentMeasurement(
  revisionId: string,
): Promise<{ measurementId: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.rpc('refresh_partner_commitment_measurement', {
    p_revision_id: revisionId,
  });
  return { measurementId: typeof data === 'string' ? data : null, error };
}

export async function recordManualPartnerCommitmentMeasurement(input: {
  revisionId: string;
  deliveredQuantity: number;
  utilizedQuantity: number;
}): Promise<{ measurementId: string | null; error: PostgrestError | null }> {
  const key = await idempotencyKey('manual-measurement');
  const { data, error } = await supabase.rpc('record_manual_partner_commitment_measurement', {
    p_revision_id: input.revisionId,
    p_delivered_quantity: input.deliveredQuantity,
    p_utilized_quantity: input.utilizedQuantity,
    p_idempotency_key: key,
  });
  return { measurementId: typeof data === 'string' ? data : null, error };
}

export async function reviewPartnerCommitmentMeasurement(
  measurementId: string,
  decision: 'acknowledged' | 'disputed',
): Promise<{ state: PartnerCommitmentMeasurementReviewState | null; error: PostgrestError | null }> {
  const key = await idempotencyKey(`manual-review-${decision}`);
  const { data, error } = await supabase.rpc('review_partner_commitment_manual_measurement', {
    p_measurement_id: measurementId,
    p_decision: decision,
    p_idempotency_key: key,
  });
  return {
    state: typeof data === 'string' ? data as PartnerCommitmentMeasurementReviewState : null,
    error,
  };
}

export async function advancePartnerCommitment(
  revisionId: string,
  targetStatus: 'scheduled' | 'delivering' | 'fulfilled' | 'partially_fulfilled' | 'cancelled' | 'not_fulfilled',
): Promise<{ changed: boolean; error: PostgrestError | null }> {
  const key = await idempotencyKey(`state-${targetStatus}`);
  const { data, error } = await supabase.rpc('advance_partner_commitment', {
    p_revision_id: revisionId,
    p_target_status: targetStatus,
    p_idempotency_key: key,
  });
  return { changed: data === true, error };
}

export async function prefillPartnerProgramCommitments(exchangeId: string): Promise<{
  createdCount: number;
  error: PostgrestError | null;
}> {
  const key = await idempotencyKey('prefill');
  const { data, error } = await supabase.rpc('prefill_partner_program_commitments', {
    p_exchange_id: exchangeId,
    p_idempotency_key: key,
  });
  return { createdCount: numberOrNull(data) ?? 0, error };
}

export async function getPartnerCommitmentHistory(commitmentId: string): Promise<{
  data: PartnerCommitmentHistoryRow[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_commitment_history', {
    p_commitment_id: commitmentId,
  });
  if (error) return { data: [], error };
  const rows = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const revisionId = text(row.revision_id);
    const type = text(row.commitment_type) as PartnerCommitmentType | null;
    const createdAt = text(row.created_at);
    const committed = numberOrNull(row.committed_quantity);
    if (!revisionId || !type || !createdAt || committed == null) return [];
    return [{
      revisionId,
      revisionNo: numberOrNull(row.revision_no) ?? 1,
      commitmentType: type,
      domain: text(row.domain),
      committedQuantity: committed,
      windowStart: text(row.window_start),
      windowEnd: text(row.window_end),
      acceptanceState: (text(row.acceptance_state) ?? 'awaiting-acceptance') as PartnerCommitmentAcceptanceState,
      lifecycleStatus: (text(row.lifecycle_status) ?? 'proposed') as PartnerCommitmentStatus,
      deliveredQuantity: numberOrNull(row.delivered_quantity),
      utilizedQuantity: numberOrNull(row.utilized_quantity),
      measurementState: (text(row.measurement_state) ?? 'not-measured') as PartnerCommitmentMeasurementState,
      evidenceQuality: (text(row.evidence_quality) ?? 'insufficient') as PartnerCommitmentEvidenceQuality,
      createdAt,
    }];
  });
  return { data: rows, error: null };
}

export async function getPartnerProgramCommitmentMemory(programId: string): Promise<{
  data: PartnerProgramCommitmentMemoryRow[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_program_commitment_memory', {
    p_program_id: programId,
  });
  if (error) return { data: [], error };
  const rows = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const partyLabel = text(row.party_label);
    const commitmentType = text(row.commitment_type) as PartnerCommitmentType | null;
    if (!partyLabel || !commitmentType) return [];
    return [{
      partyKind: (text(row.party_kind) ?? 'community') as PartnerCommitmentPartyKind,
      partyCommunityId: text(row.party_community_id),
      partyLabel,
      commitmentType,
      domain: text(row.domain),
      sampleEventCount: numberOrNull(row.sample_event_count) ?? 0,
      commitmentOccurrences: numberOrNull(row.commitment_occurrences) ?? 0,
      measuredEventCount: numberOrNull(row.measured_event_count) ?? 0,
      measurementCoverage: numberOrNull(row.measurement_coverage) ?? 0,
      averageCommittedQuantity: numberOrNull(row.average_committed_quantity) ?? 0,
      averageDeliveredQuantity: numberOrNull(row.average_delivered_quantity),
      averageUtilizedQuantity: numberOrNull(row.average_utilized_quantity),
      utilizedEventCount: numberOrNull(row.utilized_event_count) ?? 0,
      unusedMeasuredEventCount: numberOrNull(row.unused_measured_event_count) ?? 0,
      zeroUtilizationMeasuredEventCount: numberOrNull(row.zero_utilization_measured_event_count) ?? 0,
      suggestedQuantity: numberOrNull(row.suggested_quantity),
      latestEventEndedAt: text(row.latest_event_ended_at),
    }];
  });
  return { data: rows, error: null };
}

export async function getEventPartnerCommitmentSummary(eventId: string): Promise<{
  data: EventPartnerCommitmentSummary | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_event_partner_commitment_summary', { p_event_id: eventId });
  const row = asObject(data);
  if (error || !row) return { data: null, error };
  return {
    data: {
      exchangeLedgerCount: numberOrNull(row.exchange_ledger_count) ?? 0,
      acceptedCommitmentCount: numberOrNull(row.accepted_commitment_count) ?? 0,
      scheduledOrDeliveringCount: numberOrNull(row.scheduled_or_delivering_count) ?? 0,
      fulfilledCommitmentCount: numberOrNull(row.fulfilled_commitment_count) ?? 0,
      partiallyFulfilledCount: numberOrNull(row.partially_fulfilled_count) ?? 0,
      unresolvedCommitmentCount: numberOrNull(row.unresolved_commitment_count) ?? 0,
      pendingAmendmentCount: numberOrNull(row.pending_amendment_count) ?? 0,
      manualReviewPendingCount: numberOrNull(row.manual_review_pending_count) ?? 0,
      manualDisputeCount: numberOrNull(row.manual_dispute_count) ?? 0,
      closedWithoutMeasurementCount: numberOrNull(row.closed_without_measurement_count) ?? 0,
    },
    error: null,
  };
}
