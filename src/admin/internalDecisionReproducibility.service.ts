import { supabase } from '../lib/supabase';

export interface InternalDecisionReproducibilityReceipt {
  id: string;
  journalId: string;
  eventId: string | null;
  graphVersion: string;
  evidenceRefDigest: string;
  evidenceRefCount: number;
  policyVersion: string;
  lensFingerprint: string | null;
  admissionState: string;
  admissionAuthority: number;
  calibrationPenalty: number;
  temporalOverlap: number | null;
  routeDiversity: number | null;
  routeCount: number;
  receiptDigest: string;
  createdAt: string;
  expiresAt: string;
}

export interface InternalDecisionReproducibilityComparison {
  receiptId: string;
  journalId: string;
  sealedGraphVersion: string;
  currentGraphVersion: string;
  sameGraphVersion: boolean;
  sameEvidenceRefDigest: boolean;
  sealedRefCount: number;
  currentRefCount: number;
  liveRefCount: number;
  orphanedRefCount: number;
  openConflictCount: number;
  reproducibleNow: boolean;
  operatingRule: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function bool(value: unknown): boolean {
  return value === true;
}
function parseReceipt(value: unknown): InternalDecisionReproducibilityReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.journalId !== 'string'
    || typeof row.graphVersion !== 'string'
    || typeof row.evidenceRefDigest !== 'string'
    || typeof row.policyVersion !== 'string'
    || typeof row.receiptDigest !== 'string'
  ) return null;
  return {
    id: row.id,
    journalId: row.journalId,
    eventId: str(row.eventId),
    graphVersion: row.graphVersion,
    evidenceRefDigest: row.evidenceRefDigest,
    evidenceRefCount: Math.max(0, Math.round(num(row.evidenceRefCount))),
    policyVersion: row.policyVersion,
    lensFingerprint: str(row.lensFingerprint),
    admissionState: str(row.admissionState) ?? 'unknown',
    admissionAuthority: Math.max(0, Math.min(1, num(row.admissionAuthority))),
    calibrationPenalty: Math.max(0, Math.min(0.45, num(row.calibrationPenalty))),
    temporalOverlap: row.temporalOverlap == null ? null : Math.max(0, Math.min(1, num(row.temporalOverlap))),
    routeDiversity: row.routeDiversity == null ? null : Math.max(0, Math.min(1, num(row.routeDiversity))),
    routeCount: Math.max(0, Math.round(num(row.routeCount))),
    receiptDigest: row.receiptDigest,
    createdAt: str(row.createdAt) ?? new Date().toISOString(),
    expiresAt: str(row.expiresAt) ?? new Date().toISOString(),
  };
}

export async function sealInternalDecisionReproducibilityReceipt(input: {
  journalId: string;
  graphVersion: string;
  policyVersion: string;
  lensFingerprint?: string | null;
  calibrationPenalty?: number;
  temporalOverlap?: number | null;
  routeDiversity?: number | null;
  routeCount?: number;
}): Promise<{ id: string; receiptDigest: string; evidenceRefCount: number }> {
  const context: Record<string, unknown> = {
    policyVersion: input.policyVersion.trim(),
    calibrationPenalty: Math.max(0, Math.min(0.45, input.calibrationPenalty ?? 0)),
    routeCount: Math.max(0, Math.min(32, Math.round(input.routeCount ?? 0))),
  };
  if (input.lensFingerprint?.trim()) context.lensFingerprint = input.lensFingerprint.trim();
  if (input.temporalOverlap != null) context.temporalOverlap = Math.max(0, Math.min(1, input.temporalOverlap));
  if (input.routeDiversity != null) context.routeDiversity = Math.max(0, Math.min(1, input.routeDiversity));
  const { data, error } = await supabase.rpc('seal_internal_decision_reproducibility_receipt', {
    p_journal_id: input.journalId,
    p_graph_version: input.graphVersion,
    p_context: context,
  });
  if (error || !data || typeof data !== 'object') throw new Error(error?.message ?? 'Unable to seal decision reproducibility receipt.');
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.receiptDigest !== 'string') throw new Error('Invalid reproducibility receipt response.');
  return { id: row.id, receiptDigest: row.receiptDigest, evidenceRefCount: Math.max(0, Math.round(num(row.evidenceRefCount))) };
}

export async function loadInternalDecisionReproducibilityReceipts(eventId?: string | null): Promise<InternalDecisionReproducibilityReceipt[]> {
  const { data, error } = await supabase.rpc('get_internal_decision_reproducibility_receipts', {
    p_event_id: eventId ?? null,
    p_limit: 320,
  });
  if (error || !data || typeof data !== 'object') throw new Error(error?.message ?? 'Unable to load decision reproducibility receipts.');
  const rows = Array.isArray((data as Record<string, unknown>).receipts) ? (data as Record<string, unknown>).receipts as unknown[] : [];
  return rows.flatMap((item) => {
    const parsed = parseReceipt(item);
    return parsed ? [parsed] : [];
  });
}

export async function compareInternalDecisionReproducibilityReceipt(id: string): Promise<InternalDecisionReproducibilityComparison> {
  const { data, error } = await supabase.rpc('compare_internal_decision_reproducibility_receipt', { p_receipt_id: id });
  if (error || !data || typeof data !== 'object') throw new Error(error?.message ?? 'Unable to compare reproducibility receipt.');
  const row = data as Record<string, unknown>;
  if (typeof row.receiptId !== 'string' || typeof row.journalId !== 'string' || typeof row.sealedGraphVersion !== 'string' || typeof row.currentGraphVersion !== 'string') {
    throw new Error('Invalid reproducibility comparison response.');
  }
  return {
    receiptId: row.receiptId,
    journalId: row.journalId,
    sealedGraphVersion: row.sealedGraphVersion,
    currentGraphVersion: row.currentGraphVersion,
    sameGraphVersion: bool(row.sameGraphVersion),
    sameEvidenceRefDigest: bool(row.sameEvidenceRefDigest),
    sealedRefCount: Math.max(0, Math.round(num(row.sealedRefCount))),
    currentRefCount: Math.max(0, Math.round(num(row.currentRefCount))),
    liveRefCount: Math.max(0, Math.round(num(row.liveRefCount))),
    orphanedRefCount: Math.max(0, Math.round(num(row.orphanedRefCount))),
    openConflictCount: Math.max(0, Math.round(num(row.openConflictCount))),
    reproducibleNow: bool(row.reproducibleNow),
    operatingRule: str(row.operatingRule) ?? 'Reproducibility compares the analytical evidence envelope; it does not certify truth.',
  };
}
