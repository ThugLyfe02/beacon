import { supabase } from '../lib/supabase';
import type {
  InternalOperatorAdmissionState,
  InternalOperatorDecisionKind,
} from './InternalOperatorDecisionAdmission';

export type InternalDecisionJournalStatus = 'open' | 'supported' | 'weakened' | 'invalidated' | 'closed';

export interface InternalDecisionJournalEntry {
  id: string;
  eventId: string | null;
  decisionKind: InternalOperatorDecisionKind;
  title: string;
  hypothesis: string;
  disconfirmingCondition: string;
  graphVersion: string;
  admissionState: InternalOperatorAdmissionState;
  admissionAuthority: number;
  evidenceDigest: string;
  status: InternalDecisionJournalStatus;
  conclusionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

export interface InternalDecisionJournalState {
  generatedAt: string;
  entries: InternalDecisionJournalEntry[];
  operatingRule: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseEntry(value: unknown): InternalDecisionJournalEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.title !== 'string'
    || typeof row.hypothesis !== 'string'
    || typeof row.disconfirmingCondition !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.evidenceDigest !== 'string'
  ) return null;
  const decisionKind = String(row.decisionKind ?? '') as InternalOperatorDecisionKind;
  const admissionState = String(row.admissionState ?? '') as InternalOperatorAdmissionState;
  const status = String(row.status ?? '') as InternalDecisionJournalStatus;
  if (![
    'analysis_review', 'target_route_review', 'intervention_review',
    'restricted_forensics_review', 'portable_export_review',
  ].includes(decisionKind)) return null;
  if (![
    'admitted_to_review', 'review_with_caution', 'evidence_remediation_required',
    'capability_required', 'safety_blocked',
  ].includes(admissionState)) return null;
  if (!['open', 'supported', 'weakened', 'invalidated', 'closed'].includes(status)) return null;
  const authority = Number(row.admissionAuthority ?? 0);
  return {
    id: row.id,
    eventId: stringOrNull(row.eventId),
    decisionKind,
    title: row.title,
    hypothesis: row.hypothesis,
    disconfirmingCondition: row.disconfirmingCondition,
    graphVersion: row.graphVersion,
    admissionState,
    admissionAuthority: Number.isFinite(authority) ? Math.max(0, Math.min(1, authority)) : 0,
    evidenceDigest: row.evidenceDigest,
    status,
    conclusionNote: stringOrNull(row.conclusionNote),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    updatedAt: stringOrNull(row.updatedAt) ?? new Date().toISOString(),
    resolvedAt: stringOrNull(row.resolvedAt),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

export async function loadInternalDecisionJournal(eventId?: string | null): Promise<InternalDecisionJournalState> {
  const { data, error } = await supabase.rpc('get_internal_operator_decision_journal', {
    p_event_id: eventId ?? null,
    p_limit: 160,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load operator Decision Journal.');
  }
  const row = data as Record<string, unknown>;
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    generatedAt: stringOrNull(row.generatedAt) ?? new Date().toISOString(),
    entries: entries.flatMap((item) => {
      const parsed = parseEntry(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Decision Journal records graph-evidence hypotheses for operator calibration and never executes decisions.',
  };
}

export async function saveInternalDecisionJournal(input: {
  eventId?: string | null;
  decisionKind: InternalOperatorDecisionKind;
  title: string;
  hypothesis: string;
  disconfirmingCondition: string;
  graphVersion: string;
  admissionState: InternalOperatorAdmissionState;
  admissionAuthority: number;
  evidenceSummary: Record<string, unknown>;
  ttlDays?: number;
}): Promise<{ id: string; evidenceDigest: string; createdAt: string }> {
  const { data, error } = await supabase.rpc('save_internal_operator_decision_journal', {
    p_event_id: input.eventId ?? null,
    p_decision_kind: input.decisionKind,
    p_title: input.title.trim(),
    p_hypothesis: input.hypothesis.trim(),
    p_disconfirming_condition: input.disconfirmingCondition.trim(),
    p_graph_version: input.graphVersion,
    p_admission_state: input.admissionState,
    p_admission_authority: Math.max(0, Math.min(1, input.admissionAuthority)),
    p_evidence_summary: input.evidenceSummary,
    p_ttl_days: Math.max(7, Math.min(input.ttlDays ?? 120, 180)),
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to save Decision Journal hypothesis.');
  }
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.evidenceDigest !== 'string') {
    throw new Error('Decision Journal response was invalid.');
  }
  return {
    id: row.id,
    evidenceDigest: row.evidenceDigest,
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
  };
}

export async function resolveInternalDecisionJournal(input: {
  journalId: string;
  status: Exclude<InternalDecisionJournalStatus, 'open'>;
  conclusionNote: string;
}): Promise<void> {
  const { error } = await supabase.rpc('resolve_internal_operator_decision_journal', {
    p_journal_id: input.journalId,
    p_status: input.status,
    p_conclusion_note: input.conclusionNote.trim(),
  });
  if (error) throw new Error(error.message ?? 'Unable to resolve Decision Journal hypothesis.');
}
