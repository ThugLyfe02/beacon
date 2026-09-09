import { supabase } from '../lib/supabase';

export type InternalCaseMemoryKind =
  | 'checkpoint'
  | 'question'
  | 'verification'
  | 'decision'
  | 'timeline'
  | 'handoff'
  | 'note';

export interface InternalCaseMemoryEntry {
  id: string;
  authorId: string | null;
  authorLabel: string;
  kind: InternalCaseMemoryKind;
  graphVersion: string;
  perspectiveFingerprint: string | null;
  evidenceDigest: string;
  title: string;
  body: string;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByLabel: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface InternalCaseCollaborationState {
  generatedAt: string;
  caseId: string;
  caseTitle: string;
  assignedOperatorId: string | null;
  assignedOperatorLabel: string | null;
  assignedAt: string | null;
  entries: InternalCaseMemoryEntry[];
  operatingRule: string;
}

export interface InternalCaseRehydrationEntry {
  id: string;
  kind: InternalCaseMemoryKind;
  title: string;
  authorLabel: string;
  createdAt: string;
  graphVersion: string;
  resolvedAt: string | null;
}

export interface InternalCaseRehydrationState {
  generatedAt: string;
  caseId: string;
  caseTitle: string;
  currentGraphVersion: string;
  lastSeenAt: string | null;
  lastSeenGraphVersion: string | null;
  graphVersionChanged: boolean;
  newMemoryCount: number;
  openQuestionCount: number;
  assignmentChanged: boolean;
  assignedOperatorId: string | null;
  assignedOperatorLabel: string | null;
  lastMemoryAt: string | null;
  newMemoryByKind: Record<string, number>;
  latestNewEntries: InternalCaseRehydrationEntry[];
  recommendedSurface: string;
  operatingRule: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseKind(value: unknown): InternalCaseMemoryKind | null {
  const kind = String(value ?? '') as InternalCaseMemoryKind;
  return ['checkpoint', 'question', 'verification', 'decision', 'timeline', 'handoff', 'note'].includes(kind) ? kind : null;
}

function parseEntry(value: unknown): InternalCaseMemoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = parseKind(row.kind);
  if (
    typeof row.id !== 'string'
    || !kind
    || typeof row.graphVersion !== 'string'
    || typeof row.evidenceDigest !== 'string'
    || typeof row.title !== 'string'
    || typeof row.body !== 'string'
  ) return null;
  return {
    id: row.id,
    authorId: stringOrNull(row.authorId),
    authorLabel: typeof row.authorLabel === 'string' ? row.authorLabel : 'Deleted operator',
    kind,
    graphVersion: row.graphVersion,
    perspectiveFingerprint: stringOrNull(row.perspectiveFingerprint),
    evidenceDigest: row.evidenceDigest,
    title: row.title,
    body: row.body,
    resolvedAt: stringOrNull(row.resolvedAt),
    resolvedById: stringOrNull(row.resolvedById),
    resolvedByLabel: stringOrNull(row.resolvedByLabel),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

function parseRehydrationEntry(value: unknown): InternalCaseRehydrationEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = parseKind(row.kind);
  if (typeof row.id !== 'string' || !kind || typeof row.title !== 'string' || typeof row.graphVersion !== 'string') return null;
  return {
    id: row.id,
    kind,
    title: row.title,
    authorLabel: typeof row.authorLabel === 'string' ? row.authorLabel : 'Deleted operator',
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    graphVersion: row.graphVersion,
    resolvedAt: stringOrNull(row.resolvedAt),
  };
}

export async function loadInternalCaseCollaboration(caseId: string): Promise<InternalCaseCollaborationState> {
  const { data, error } = await supabase.rpc('get_internal_graph_case_collaboration', {
    p_case_id: caseId,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load collaborative case memory.');
  }
  const row = data as Record<string, unknown>;
  if (typeof row.caseId !== 'string' || typeof row.caseTitle !== 'string') {
    throw new Error('Collaborative case response was invalid.');
  }
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    generatedAt: stringOrNull(row.generatedAt) ?? new Date().toISOString(),
    caseId: row.caseId,
    caseTitle: row.caseTitle,
    assignedOperatorId: stringOrNull(row.assignedOperatorId),
    assignedOperatorLabel: stringOrNull(row.assignedOperatorLabel),
    assignedAt: stringOrNull(row.assignedAt),
    entries: entries.flatMap((item) => {
      const parsed = parseEntry(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Collaborative Case Memory stores bounded reasoning bound to canonical graph versions and evidence digests.',
  };
}

export async function loadInternalCaseRehydration(caseId: string): Promise<InternalCaseRehydrationState> {
  const { data, error } = await supabase.rpc('get_internal_graph_case_rehydration', {
    p_case_id: caseId,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to rehydrate investigation case.');
  }
  const row = data as Record<string, unknown>;
  if (typeof row.caseId !== 'string' || typeof row.caseTitle !== 'string' || typeof row.currentGraphVersion !== 'string') {
    throw new Error('Case rehydration response was invalid.');
  }
  const byKindRaw = row.newMemoryByKind && typeof row.newMemoryByKind === 'object'
    ? row.newMemoryByKind as Record<string, unknown>
    : {};
  const newMemoryByKind: Record<string, number> = {};
  for (const [key, value] of Object.entries(byKindRaw)) {
    const numeric = Number(value ?? 0);
    if (Number.isFinite(numeric) && numeric >= 0) newMemoryByKind[key] = numeric;
  }
  const latest = Array.isArray(row.latestNewEntries) ? row.latestNewEntries : [];
  return {
    generatedAt: stringOrNull(row.generatedAt) ?? new Date().toISOString(),
    caseId: row.caseId,
    caseTitle: row.caseTitle,
    currentGraphVersion: row.currentGraphVersion,
    lastSeenAt: stringOrNull(row.lastSeenAt),
    lastSeenGraphVersion: stringOrNull(row.lastSeenGraphVersion),
    graphVersionChanged: row.graphVersionChanged === true,
    newMemoryCount: Number(row.newMemoryCount ?? 0),
    openQuestionCount: Number(row.openQuestionCount ?? 0),
    assignmentChanged: row.assignmentChanged === true,
    assignedOperatorId: stringOrNull(row.assignedOperatorId),
    assignedOperatorLabel: stringOrNull(row.assignedOperatorLabel),
    lastMemoryAt: stringOrNull(row.lastMemoryAt),
    newMemoryByKind,
    latestNewEntries: latest.flatMap((item) => {
      const parsed = parseRehydrationEntry(item);
      return parsed ? [parsed] : [];
    }),
    recommendedSurface: typeof row.recommendedSurface === 'string' ? row.recommendedSurface : 'InternalCollaborativeCaseMemory',
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Case Rehydration derives what changed since the operator last reviewed the case without storing graph snapshots.',
  };
}

export async function markInternalCaseSeen(caseId: string, graphVersion: string): Promise<void> {
  const { error } = await supabase.rpc('mark_internal_graph_case_seen', {
    p_case_id: caseId,
    p_graph_version: graphVersion,
  });
  if (error) throw new Error(error.message ?? 'Unable to acknowledge case rehydration state.');
}

export async function resolveInternalCaseQuestion(caseId: string, entryId: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_internal_graph_case_question', {
    p_case_id: caseId,
    p_entry_id: entryId,
  });
  if (error) throw new Error(error.message ?? 'Unable to resolve case-memory question.');
}

export async function assignInternalGraphCase(caseId: string, operatorId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_internal_graph_case', {
    p_case_id: caseId,
    p_operator_id: operatorId,
  });
  if (error) throw new Error(error.message ?? 'Unable to assign investigation case.');
}

export async function appendInternalCaseMemory(input: {
  caseId: string;
  kind: InternalCaseMemoryKind;
  graphVersion: string;
  perspectiveFingerprint?: string | null;
  title: string;
  body: string;
  evidenceSummary?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('append_internal_graph_case_memory', {
    p_case_id: input.caseId,
    p_entry_kind: input.kind,
    p_graph_version: input.graphVersion,
    p_perspective_fingerprint: input.perspectiveFingerprint ?? null,
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_evidence_summary: input.evidenceSummary ?? {},
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to append collaborative case memory.');
  }
  return data;
}
