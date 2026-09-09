import { supabase } from '../lib/supabase';

export type InternalEvidenceConflictKind =
  | 'provenance_disagreement'
  | 'temporal_overlap'
  | 'state_collision'
  | 'scope_mismatch'
  | 'manual_review';
export type InternalEvidenceConflictStatus = 'open' | 'resolved' | 'dismissed';

export interface InternalEvidenceConflict {
  id: string;
  eventId: string | null;
  graphVersion: string;
  leftEdgeId: string;
  rightEdgeId: string;
  kind: InternalEvidenceConflictKind;
  reviewPriority: number;
  rationale: string;
  status: InternalEvidenceConflictStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

export interface InternalEvidenceConflictState {
  generatedAt: string;
  conflicts: InternalEvidenceConflict[];
  operatingRule: string;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseConflict(value: unknown): InternalEvidenceConflict | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = String(row.kind ?? '') as InternalEvidenceConflictKind;
  const status = String(row.status ?? '') as InternalEvidenceConflictStatus;
  if (
    typeof row.id !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.leftEdgeId !== 'string'
    || typeof row.rightEdgeId !== 'string'
    || typeof row.rationale !== 'string'
    || !['provenance_disagreement', 'temporal_overlap', 'state_collision', 'scope_mismatch', 'manual_review'].includes(kind)
    || !['open', 'resolved', 'dismissed'].includes(status)
  ) return null;
  const priority = Number(row.reviewPriority ?? 3);
  return {
    id: row.id,
    eventId: stringOrNull(row.eventId),
    graphVersion: row.graphVersion,
    leftEdgeId: row.leftEdgeId,
    rightEdgeId: row.rightEdgeId,
    kind,
    reviewPriority: Number.isFinite(priority) ? Math.max(1, Math.min(5, Math.round(priority))) : 3,
    rationale: row.rationale,
    status,
    resolutionNote: stringOrNull(row.resolutionNote),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    updatedAt: stringOrNull(row.updatedAt) ?? new Date().toISOString(),
    resolvedAt: stringOrNull(row.resolvedAt),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

export async function loadInternalEvidenceConflicts(input: {
  eventId?: string | null;
  includeClosed?: boolean;
  limit?: number;
} = {}): Promise<InternalEvidenceConflictState> {
  const { data, error } = await supabase.rpc('get_internal_graph_evidence_conflicts', {
    p_event_id: input.eventId ?? null,
    p_include_closed: input.includeClosed ?? false,
    p_limit: Math.max(1, Math.min(input.limit ?? 160, 300)),
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load Evidence Conflict Ledger.');
  }
  const row = data as Record<string, unknown>;
  const conflicts = Array.isArray(row.conflicts) ? row.conflicts : [];
  return {
    generatedAt: stringOrNull(row.generatedAt) ?? new Date().toISOString(),
    conflicts: conflicts.flatMap((item) => {
      const parsed = parseConflict(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Evidence conflicts are operator-confirmed review state and never rewrite canonical graph truth.',
  };
}

export async function createInternalEvidenceConflict(input: {
  eventId?: string | null;
  graphVersion: string;
  leftEdgeId: string;
  rightEdgeId: string;
  kind: InternalEvidenceConflictKind;
  reviewPriority: number;
  rationale: string;
  ttlDays?: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_internal_graph_evidence_conflict', {
    p_event_id: input.eventId ?? null,
    p_graph_version: input.graphVersion,
    p_left_edge_id: input.leftEdgeId,
    p_right_edge_id: input.rightEdgeId,
    p_conflict_kind: input.kind,
    p_review_priority: Math.max(1, Math.min(5, Math.round(input.reviewPriority))),
    p_rationale: input.rationale.trim(),
    p_ttl_days: Math.max(7, Math.min(input.ttlDays ?? 180, 365)),
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to create evidence conflict.');
  }
  return data;
}

export async function resolveInternalEvidenceConflict(input: {
  conflictId: string;
  status: Exclude<InternalEvidenceConflictStatus, 'open'>;
  resolutionNote: string;
}): Promise<void> {
  const { error } = await supabase.rpc('resolve_internal_graph_evidence_conflict', {
    p_conflict_id: input.conflictId,
    p_status: input.status,
    p_resolution_note: input.resolutionNote.trim(),
  });
  if (error) throw new Error(error.message ?? 'Unable to close evidence conflict.');
}
