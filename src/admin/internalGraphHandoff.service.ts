import { supabase } from '../lib/supabase';

export type InternalGraphHandoffStatus = 'open' | 'accepted' | 'declined' | 'resolved' | 'withdrawn';

export interface InternalHandoffOperator {
  id: string;
  label: string;
}

export interface InternalGraphHandoffNote {
  id: string;
  authorId: string | null;
  authorLabel: string;
  note: string;
  createdAt: string;
}

export interface InternalGraphCaseHandoff {
  id: string;
  caseId: string;
  caseTitle: string;
  fromOperatorId: string | null;
  fromOperatorLabel: string;
  toOperatorId: string;
  toOperatorLabel: string;
  graphVersion: string;
  perspectiveFingerprint: string | null;
  perspectiveTitle: string | null;
  evidenceDigest: string;
  summary: string;
  nextQuestion: string;
  status: InternalGraphHandoffStatus;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
  expiresAt: string;
  notes: InternalGraphHandoffNote[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseOperator(value: unknown): InternalHandoffOperator | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.label !== 'string') return null;
  return { id: row.id, label: row.label };
}

function parseHandoff(value: unknown): InternalGraphCaseHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const status = String(row.status ?? '') as InternalGraphHandoffStatus;
  if (
    typeof row.id !== 'string'
    || typeof row.caseId !== 'string'
    || typeof row.caseTitle !== 'string'
    || typeof row.toOperatorId !== 'string'
    || typeof row.toOperatorLabel !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.evidenceDigest !== 'string'
    || typeof row.summary !== 'string'
    || typeof row.nextQuestion !== 'string'
    || !['open', 'accepted', 'declined', 'resolved', 'withdrawn'].includes(status)
  ) return null;
  const notes = Array.isArray(row.notes) ? row.notes : [];
  return {
    id: row.id,
    caseId: row.caseId,
    caseTitle: row.caseTitle,
    fromOperatorId: stringOrNull(row.fromOperatorId),
    fromOperatorLabel: typeof row.fromOperatorLabel === 'string' ? row.fromOperatorLabel : 'Deleted operator',
    toOperatorId: row.toOperatorId,
    toOperatorLabel: row.toOperatorLabel,
    graphVersion: row.graphVersion,
    perspectiveFingerprint: stringOrNull(row.perspectiveFingerprint),
    perspectiveTitle: stringOrNull(row.perspectiveTitle),
    evidenceDigest: row.evidenceDigest,
    summary: row.summary,
    nextQuestion: row.nextQuestion,
    status,
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    acceptedAt: stringOrNull(row.acceptedAt),
    resolvedAt: stringOrNull(row.resolvedAt),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
    notes: notes.flatMap((note) => {
      if (!note || typeof note !== 'object') return [];
      const item = note as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.note !== 'string') return [];
      return [{
        id: item.id,
        authorId: stringOrNull(item.authorId),
        authorLabel: typeof item.authorLabel === 'string' ? item.authorLabel : 'Deleted operator',
        note: item.note,
        createdAt: stringOrNull(item.createdAt) ?? new Date().toISOString(),
      }];
    }),
  };
}

export async function loadInternalHandoffOperatorDirectory(): Promise<InternalHandoffOperator[]> {
  const { data, error } = await supabase.rpc('get_internal_handoff_operator_directory');
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load internal operator directory.');
  }
  const rows = Array.isArray((data as Record<string, unknown>).operators)
    ? (data as Record<string, unknown>).operators as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseOperator(row);
    return parsed ? [parsed] : [];
  });
}

export async function loadInternalGraphCaseHandoffs(): Promise<InternalGraphCaseHandoff[]> {
  const { data, error } = await supabase.rpc('get_internal_graph_case_handoffs');
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load investigation handoffs.');
  }
  const rows = Array.isArray((data as Record<string, unknown>).handoffs)
    ? (data as Record<string, unknown>).handoffs as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseHandoff(row);
    return parsed ? [parsed] : [];
  });
}

export async function createInternalGraphCaseHandoff(input: {
  caseId: string;
  toOperator: string;
  graphVersion: string;
  perspectiveFingerprint?: string | null;
  perspectiveTitle?: string | null;
  summary: string;
  nextQuestion: string;
  evidenceSummary: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_internal_graph_case_handoff', {
    p_case_id: input.caseId,
    p_to_operator: input.toOperator,
    p_graph_version: input.graphVersion,
    p_perspective_fingerprint: input.perspectiveFingerprint ?? null,
    p_perspective_title: input.perspectiveTitle ?? null,
    p_summary: input.summary.trim(),
    p_next_question: input.nextQuestion.trim(),
    p_evidence_summary: input.evidenceSummary,
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to create investigation handoff.');
  }
  return data;
}

export async function setInternalGraphCaseHandoffStatus(id: string, status: Exclude<InternalGraphHandoffStatus, 'open'>): Promise<void> {
  const { error } = await supabase.rpc('set_internal_graph_case_handoff_status', {
    p_handoff_id: id,
    p_status: status,
  });
  if (error) throw new Error(error.message ?? 'Unable to update investigation handoff.');
}

export async function addInternalGraphCaseHandoffNote(id: string, note: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_internal_graph_case_handoff_note', {
    p_handoff_id: id,
    p_note: note.trim(),
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to add investigation handoff note.');
  }
  return data;
}
