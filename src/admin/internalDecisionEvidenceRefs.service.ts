import { supabase } from '../lib/supabase';

export type InternalDecisionEvidenceRefKind = 'route_portfolio' | 'forensic_review' | 'manual_review';

export interface InternalDecisionEvidenceRef {
  journalId: string;
  eventId: string | null;
  graphVersion: string;
  edgeId: string;
  refKind: InternalDecisionEvidenceRefKind;
  createdAt: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseRef(value: unknown): InternalDecisionEvidenceRef | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const refKind = String(row.refKind ?? '') as InternalDecisionEvidenceRefKind;
  if (
    typeof row.journalId !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.edgeId !== 'string'
    || !['route_portfolio', 'forensic_review', 'manual_review'].includes(refKind)
  ) return null;
  return {
    journalId: row.journalId,
    eventId: stringOrNull(row.eventId),
    graphVersion: row.graphVersion,
    edgeId: row.edgeId,
    refKind,
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
  };
}

export async function recordInternalDecisionEvidenceRefs(input: {
  journalId: string;
  graphVersion: string;
  edgeIds: readonly string[];
  refKind: InternalDecisionEvidenceRefKind;
}): Promise<number> {
  const edgeIds = [...new Set(input.edgeIds.filter((edgeId) => edgeId.trim().length > 0))].slice(0, 64);
  if (edgeIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('record_internal_operator_decision_evidence_refs', {
    p_journal_id: input.journalId,
    p_graph_version: input.graphVersion,
    p_edge_ids: edgeIds,
    p_ref_kind: input.refKind,
  });
  if (error) throw new Error(error.message ?? 'Unable to record decision evidence references.');
  const count = Number(data ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export async function loadInternalDecisionEvidenceRefs(input: {
  eventId?: string | null;
  openOnly?: boolean;
  limit?: number;
} = {}): Promise<InternalDecisionEvidenceRef[]> {
  const { data, error } = await supabase.rpc('get_internal_operator_decision_evidence_refs', {
    p_event_id: input.eventId ?? null,
    p_open_only: input.openOnly ?? true,
    p_limit: Math.max(1, Math.min(input.limit ?? 1200, 4000)),
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load decision evidence references.');
  }
  const rows = Array.isArray((data as Record<string, unknown>).refs)
    ? (data as Record<string, unknown>).refs as unknown[]
    : [];
  return rows.flatMap((row) => {
    const parsed = parseRef(row);
    return parsed ? [parsed] : [];
  });
}
