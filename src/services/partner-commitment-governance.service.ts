import type { PostgrestError } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';

export type PartnerCommitmentPreflightSeverity = 'block' | 'review' | 'info';
export type PartnerCommitmentCloseoutState = 'pending' | 'settled' | 'disputed' | 'stale' | 'missing';

export interface PartnerCommitmentIntegrity {
  valid: boolean;
  sealedRevisionCount: number;
  acceptedRevisionCount: number;
  firstInvalidRevisionId: string | null;
  scopeFingerprint: string | null;
}

export interface PartnerCommitmentPreflightIssue {
  severity: PartnerCommitmentPreflightSeverity;
  issueCode: string;
  commitmentId: string | null;
  revisionId: string | null;
  partyLabel: string | null;
  detail: string;
  suggestedAction: string;
}

export interface PartnerCommitmentCloseout {
  snapshotId: string;
  snapshotNo: number;
  snapshotHash: string;
  settlementState: PartnerCommitmentCloseoutState;
  isCurrent: boolean;
  eventEndedAt: string;
  commitmentCount: number;
  terminalCommitmentCount: number;
  measuredCommitmentCount: number;
  manualPendingCount: number;
  manualDisputeCount: number;
  callerCanDecide: boolean;
  createdAt: string;
}

export interface PartnerProgramSettlementSummary {
  endedEventCount: number;
  eventScopeCount: number;
  settledScopeCount: number;
  pendingScopeCount: number;
  disputedScopeCount: number;
  staleScopeCount: number;
  settlementCoverage: number;
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

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function idempotencyKey(prefix: string): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(24);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `partner-governance-${prefix}-${token}`;
}

export async function getPartnerCommitmentIntegrity(scopeId: string): Promise<{
  data: PartnerCommitmentIntegrity | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('verify_partner_commitment_scope_integrity', {
    p_scope_id: scopeId,
  });
  const row = asObject(data);
  if (error || !row || typeof row.valid !== 'boolean') return { data: null, error };
  return {
    data: {
      valid: row.valid,
      sealedRevisionCount: finite(row.sealed_revision_count) ?? 0,
      acceptedRevisionCount: finite(row.accepted_revision_count) ?? 0,
      firstInvalidRevisionId: text(row.first_invalid_revision_id),
      scopeFingerprint: text(row.scope_fingerprint),
    },
    error: null,
  };
}

export async function getPartnerCommitmentExecutionPreflight(scopeId: string): Promise<{
  data: PartnerCommitmentPreflightIssue[];
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_commitment_execution_preflight', {
    p_scope_id: scopeId,
  });
  if (error) return { data: [], error };
  const rows = (Array.isArray(data) ? data : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const severity = text(row.severity) as PartnerCommitmentPreflightSeverity | null;
    const issueCode = text(row.issue_code);
    const detail = text(row.detail);
    const suggestedAction = text(row.suggested_action);
    if (!severity || !issueCode || !detail || !suggestedAction) return [];
    if (!['block', 'review', 'info'].includes(severity)) return [];
    return [{
      severity,
      issueCode,
      commitmentId: text(row.commitment_id),
      revisionId: text(row.revision_id),
      partyLabel: text(row.party_label),
      detail,
      suggestedAction,
    }];
  });
  return { data: rows, error: null };
}

export async function getPartnerCommitmentCloseout(scopeId: string): Promise<{
  data: PartnerCommitmentCloseout | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_commitment_closeout', {
    p_scope_id: scopeId,
  });
  const row = asObject(data);
  const snapshotId = text(row?.snapshot_id);
  const snapshotHash = text(row?.snapshot_hash);
  const state = text(row?.settlement_state) as PartnerCommitmentCloseoutState | null;
  const eventEndedAt = text(row?.event_ended_at);
  const createdAt = text(row?.created_at);
  if (error || !row || !snapshotId || !snapshotHash || !state || !eventEndedAt || !createdAt) {
    return { data: null, error };
  }
  return {
    data: {
      snapshotId,
      snapshotNo: finite(row.snapshot_no) ?? 1,
      snapshotHash,
      settlementState: state,
      isCurrent: row.is_current === true,
      eventEndedAt,
      commitmentCount: finite(row.commitment_count) ?? 0,
      terminalCommitmentCount: finite(row.terminal_commitment_count) ?? 0,
      measuredCommitmentCount: finite(row.measured_commitment_count) ?? 0,
      manualPendingCount: finite(row.manual_pending_count) ?? 0,
      manualDisputeCount: finite(row.manual_dispute_count) ?? 0,
      callerCanDecide: row.caller_can_decide === true,
      createdAt,
    },
    error: null,
  };
}

export async function capturePartnerCommitmentCloseout(scopeId: string): Promise<{
  snapshotId: string | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('capture_partner_commitment_closeout_snapshot', {
    p_scope_id: scopeId,
  });
  return { snapshotId: typeof data === 'string' ? data : null, error };
}

export async function decidePartnerCommitmentCloseout(
  snapshotId: string,
  decision: 'acknowledged' | 'disputed',
): Promise<{ state: PartnerCommitmentCloseoutState | null; error: PostgrestError | null }> {
  const key = await idempotencyKey(`closeout-${decision}`);
  const { data, error } = await supabase.rpc('decide_partner_commitment_closeout', {
    p_snapshot_id: snapshotId,
    p_decision: decision,
    p_idempotency_key: key,
  });
  const state = typeof data === 'string' ? data as PartnerCommitmentCloseoutState : null;
  return { state, error };
}

export async function getPartnerProgramSettlementSummary(programId: string): Promise<{
  data: PartnerProgramSettlementSummary | null;
  error: PostgrestError | null;
}> {
  const { data, error } = await supabase.rpc('get_partner_program_commitment_settlement_summary', {
    p_program_id: programId,
  });
  const row = asObject(data);
  if (error || !row) return { data: null, error };
  return {
    data: {
      endedEventCount: finite(row.ended_event_count) ?? 0,
      eventScopeCount: finite(row.event_scope_count) ?? 0,
      settledScopeCount: finite(row.settled_scope_count) ?? 0,
      pendingScopeCount: finite(row.pending_scope_count) ?? 0,
      disputedScopeCount: finite(row.disputed_scope_count) ?? 0,
      staleScopeCount: finite(row.stale_scope_count) ?? 0,
      settlementCoverage: finite(row.settlement_coverage) ?? 0,
    },
    error: null,
  };
}
