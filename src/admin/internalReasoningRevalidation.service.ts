import { supabase } from '../lib/supabase';

export type InternalReasoningArtifactKind = 'decision_journal' | 'case' | 'machine_manifest';
export type InternalReasoningRevalidationReason = 'evidence_conflict' | 'orphaned_ref' | 'canonical_graph_change' | 'temporal_incoherence' | 'manual_review';
export type InternalReasoningRevalidationStatus = 'open' | 'acknowledged' | 'resolved';

export interface InternalReasoningRevalidationObligation {
  id: string;
  eventId: string | null;
  artifactKind: InternalReasoningArtifactKind;
  artifactId: string;
  graphVersion: string;
  reasonKind: InternalReasoningRevalidationReason;
  sourceId: string | null;
  priority: number;
  status: InternalReasoningRevalidationStatus;
  rationale: string;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  expiresAt: string;
}

export interface InternalReasoningRevalidationState {
  generatedAt: string;
  obligations: InternalReasoningRevalidationObligation[];
  operatingRule: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parse(value: unknown): InternalReasoningRevalidationObligation | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const artifactKind = String(row.artifactKind ?? '') as InternalReasoningArtifactKind;
  const reasonKind = String(row.reasonKind ?? '') as InternalReasoningRevalidationReason;
  const status = String(row.status ?? '') as InternalReasoningRevalidationStatus;
  if (
    typeof row.id !== 'string'
    || typeof row.artifactId !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.rationale !== 'string'
    || !['decision_journal','case','machine_manifest'].includes(artifactKind)
    || !['evidence_conflict','orphaned_ref','canonical_graph_change','temporal_incoherence','manual_review'].includes(reasonKind)
    || !['open','acknowledged','resolved'].includes(status)
  ) return null;
  const priority = Number(row.priority ?? 1);
  return {
    id: row.id,
    eventId: str(row.eventId),
    artifactKind,
    artifactId: row.artifactId,
    graphVersion: row.graphVersion,
    reasonKind,
    sourceId: str(row.sourceId),
    priority: Number.isFinite(priority) ? Math.max(1, Math.min(5, Math.round(priority))) : 1,
    status,
    rationale: row.rationale,
    createdAt: str(row.createdAt) ?? new Date().toISOString(),
    acknowledgedAt: str(row.acknowledgedAt),
    resolvedAt: str(row.resolvedAt),
    resolutionNote: str(row.resolutionNote),
    expiresAt: str(row.expiresAt) ?? new Date().toISOString(),
  };
}

export async function loadInternalReasoningRevalidationQueue(input: {
  eventId?: string | null;
  includeResolved?: boolean;
  limit?: number;
} = {}): Promise<InternalReasoningRevalidationState> {
  const { data, error } = await supabase.rpc('get_internal_reasoning_revalidation_obligations', {
    p_event_id: input.eventId ?? null,
    p_include_resolved: input.includeResolved ?? false,
    p_limit: Math.max(1, Math.min(input.limit ?? 240, 800)),
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load reasoning revalidation queue.');
  }
  const row = data as Record<string, unknown>;
  const obligations = Array.isArray(row.obligations) ? row.obligations : [];
  return {
    generatedAt: str(row.generatedAt) ?? new Date().toISOString(),
    obligations: obligations.flatMap((item) => {
      const parsed = parse(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Revalidation obligations are private analytical-memory tasks and never mutate graph truth.',
  };
}

export async function updateInternalReasoningRevalidationObligation(input: {
  id: string;
  status: 'acknowledged' | 'resolved';
  resolutionNote?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('update_internal_reasoning_revalidation_obligation', {
    p_id: input.id,
    p_status: input.status,
    p_resolution_note: input.resolutionNote?.trim() || null,
  });
  if (error) throw new Error(error.message ?? 'Unable to update reasoning revalidation obligation.');
}
