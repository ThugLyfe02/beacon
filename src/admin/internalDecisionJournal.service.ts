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

export interface InternalDecisionRetrospectiveMetrics {
  healthScore: number;
  verifiedRatio: number;
  ambiguousRatio: number;
  freshRatio: number;
  repeatedRatio: number;
  routeDiversity?: number | null;
  routeCount: number;
  sharedBottlenecks: number;
  temporalOverlap?: number | null;
  chronologyGaps: number;
  openIncidents: number;
  criticalIncidents: number;
  calibrationPenalty: number;
}

export interface InternalDecisionRetrospectiveRow {
  journalId: string;
  decisionKind: InternalOperatorDecisionKind;
  status: InternalDecisionJournalStatus;
  admissionAuthority: number;
  createdGraphVersion: string;
  createdHealthScore: number;
  createdVerifiedRatio: number;
  createdAmbiguousRatio: number;
  createdFreshRatio: number;
  createdRepeatedRatio: number;
  createdRouteDiversity: number | null;
  createdRouteCount: number;
  createdSharedBottlenecks: number;
  createdTemporalOverlap: number | null;
  createdChronologyGaps: number;
  createdOpenIncidents: number;
  createdCriticalIncidents: number;
  createdCalibrationPenalty: number;
  resolvedGraphVersion: string | null;
  resolvedHealthScore: number | null;
  resolvedVerifiedRatio: number | null;
  resolvedAmbiguousRatio: number | null;
  resolvedFreshRatio: number | null;
  resolvedRepeatedRatio: number | null;
  resolvedRouteDiversity: number | null;
  resolvedRouteCount: number | null;
  resolvedSharedBottlenecks: number | null;
  resolvedTemporalOverlap: number | null;
  resolvedChronologyGaps: number | null;
  resolvedOpenIncidents: number | null;
  resolvedCriticalIncidents: number | null;
  resolvedCalibrationPenalty: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded01(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
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
  return {
    id: row.id,
    eventId: stringOrNull(row.eventId),
    decisionKind,
    title: row.title,
    hypothesis: row.hypothesis,
    disconfirmingCondition: row.disconfirmingCondition,
    graphVersion: row.graphVersion,
    admissionState,
    admissionAuthority: bounded01(row.admissionAuthority),
    evidenceDigest: row.evidenceDigest,
    status,
    conclusionNote: stringOrNull(row.conclusionNote),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    updatedAt: stringOrNull(row.updatedAt) ?? new Date().toISOString(),
    resolvedAt: stringOrNull(row.resolvedAt),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

function parseRetrospective(value: unknown): InternalDecisionRetrospectiveRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const journalId = stringOrNull(row.journalId);
  const createdGraphVersion = stringOrNull(row.createdGraphVersion);
  const decisionKind = String(row.decisionKind ?? '') as InternalOperatorDecisionKind;
  const status = String(row.status ?? '') as InternalDecisionJournalStatus;
  if (!journalId || !createdGraphVersion) return null;
  if (!['analysis_review','target_route_review','intervention_review','restricted_forensics_review','portable_export_review'].includes(decisionKind)) return null;
  if (!['open','supported','weakened','invalidated','closed'].includes(status)) return null;
  return {
    journalId,
    decisionKind,
    status,
    admissionAuthority: bounded01(row.admissionAuthority),
    createdGraphVersion,
    createdHealthScore: bounded01(row.createdHealthScore),
    createdVerifiedRatio: bounded01(row.createdVerifiedRatio),
    createdAmbiguousRatio: bounded01(row.createdAmbiguousRatio),
    createdFreshRatio: bounded01(row.createdFreshRatio),
    createdRepeatedRatio: bounded01(row.createdRepeatedRatio),
    createdRouteDiversity: numberOrNull(row.createdRouteDiversity),
    createdRouteCount: Number(row.createdRouteCount ?? 0),
    createdSharedBottlenecks: Number(row.createdSharedBottlenecks ?? 0),
    createdTemporalOverlap: numberOrNull(row.createdTemporalOverlap),
    createdChronologyGaps: Number(row.createdChronologyGaps ?? 0),
    createdOpenIncidents: Number(row.createdOpenIncidents ?? 0),
    createdCriticalIncidents: Number(row.createdCriticalIncidents ?? 0),
    createdCalibrationPenalty: Math.max(0, Math.min(0.45, Number(row.createdCalibrationPenalty ?? 0))),
    resolvedGraphVersion: stringOrNull(row.resolvedGraphVersion),
    resolvedHealthScore: numberOrNull(row.resolvedHealthScore),
    resolvedVerifiedRatio: numberOrNull(row.resolvedVerifiedRatio),
    resolvedAmbiguousRatio: numberOrNull(row.resolvedAmbiguousRatio),
    resolvedFreshRatio: numberOrNull(row.resolvedFreshRatio),
    resolvedRepeatedRatio: numberOrNull(row.resolvedRepeatedRatio),
    resolvedRouteDiversity: numberOrNull(row.resolvedRouteDiversity),
    resolvedRouteCount: numberOrNull(row.resolvedRouteCount),
    resolvedSharedBottlenecks: numberOrNull(row.resolvedSharedBottlenecks),
    resolvedTemporalOverlap: numberOrNull(row.resolvedTemporalOverlap),
    resolvedChronologyGaps: numberOrNull(row.resolvedChronologyGaps),
    resolvedOpenIncidents: numberOrNull(row.resolvedOpenIncidents),
    resolvedCriticalIncidents: numberOrNull(row.resolvedCriticalIncidents),
    resolvedCalibrationPenalty: numberOrNull(row.resolvedCalibrationPenalty),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    resolvedAt: stringOrNull(row.resolvedAt),
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

export async function recordInternalDecisionContext(input: {
  journalId: string;
  phase: 'created' | 'resolved';
  graphVersion: string;
  metrics: InternalDecisionRetrospectiveMetrics;
}): Promise<void> {
  const { error } = await supabase.rpc('record_internal_operator_decision_context', {
    p_journal_id: input.journalId,
    p_phase: input.phase,
    p_graph_version: input.graphVersion,
    p_metrics: {
      healthScore: bounded01(input.metrics.healthScore),
      verifiedRatio: bounded01(input.metrics.verifiedRatio),
      ambiguousRatio: bounded01(input.metrics.ambiguousRatio),
      freshRatio: bounded01(input.metrics.freshRatio),
      repeatedRatio: bounded01(input.metrics.repeatedRatio),
      ...(input.metrics.routeDiversity == null ? {} : { routeDiversity: bounded01(input.metrics.routeDiversity) }),
      routeCount: Math.max(0, Math.min(32, Math.round(input.metrics.routeCount))),
      sharedBottlenecks: Math.max(0, Math.min(64, Math.round(input.metrics.sharedBottlenecks))),
      ...(input.metrics.temporalOverlap == null ? {} : { temporalOverlap: bounded01(input.metrics.temporalOverlap) }),
      chronologyGaps: Math.max(0, Math.round(input.metrics.chronologyGaps)),
      openIncidents: Math.max(0, Math.round(input.metrics.openIncidents)),
      criticalIncidents: Math.max(0, Math.round(input.metrics.criticalIncidents)),
      calibrationPenalty: Math.max(0, Math.min(0.45, input.metrics.calibrationPenalty)),
    },
  });
  if (error) throw new Error(error.message ?? 'Unable to record bounded decision retrospective context.');
}

export async function loadInternalDecisionRetrospectives(eventId?: string | null): Promise<InternalDecisionRetrospectiveRow[]> {
  const { data, error } = await supabase.rpc('get_internal_operator_decision_retrospectives', {
    p_event_id: eventId ?? null,
    p_limit: 180,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load decision retrospectives.');
  }
  const rows = Array.isArray((data as Record<string, unknown>).rows)
    ? (data as Record<string, unknown>).rows as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseRetrospective(row);
    return parsed ? [parsed] : [];
  });
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
