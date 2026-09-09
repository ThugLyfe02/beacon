import { supabase } from '../lib/supabase';

export type InternalGraphCaseStatus = 'active' | 'paused' | 'archived';
export type InternalGraphCaseFindingClass =
  | 'path'
  | 'broker'
  | 'bridge'
  | 'drift'
  | 'motif'
  | 'fragility'
  | 'ecosystem_gap';

export interface InternalGraphCasePin {
  nodeId: string;
  label: string;
  kind: string;
  note: string | null;
  pinnedAt: string;
}

export interface InternalGraphCaseFinding {
  id: string;
  key: string;
  class: InternalGraphCaseFindingClass;
  summary: string;
  score: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface InternalGraphCase {
  id: string;
  title: string;
  objective: string | null;
  targetQuery: string | null;
  scopeEventId: string | null;
  status: InternalGraphCaseStatus;
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt: string | null;
  pins: InternalGraphCasePin[];
  findings: InternalGraphCaseFinding[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCase(value: unknown): InternalGraphCase | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : null;
  if (!id) return null;
  const status = ['active', 'paused', 'archived'].includes(String(row.status))
    ? row.status as InternalGraphCaseStatus
    : 'active';
  return {
    id,
    title: typeof row.title === 'string' ? row.title : 'Untitled case',
    objective: typeof row.objective === 'string' ? row.objective : null,
    targetQuery: typeof row.targetQuery === 'string' ? row.targetQuery : null,
    scopeEventId: typeof row.scopeEventId === 'string' ? row.scopeEventId : null,
    status,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    lastEvaluatedAt: typeof row.lastEvaluatedAt === 'string' ? row.lastEvaluatedAt : null,
    pins: (Array.isArray(row.pins) ? row.pins : []).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const pin = item as Record<string, unknown>;
      const nodeId = typeof pin.nodeId === 'string' ? pin.nodeId : null;
      if (!nodeId) return [];
      return [{
        nodeId,
        label: typeof pin.label === 'string' ? pin.label : nodeId,
        kind: typeof pin.kind === 'string' ? pin.kind : 'unknown',
        note: typeof pin.note === 'string' ? pin.note : null,
        pinnedAt: typeof pin.pinnedAt === 'string' ? pin.pinnedAt : new Date().toISOString(),
      }];
    }),
    findings: (Array.isArray(row.findings) ? row.findings : []).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const finding = item as Record<string, unknown>;
      const findingId = typeof finding.id === 'string' ? finding.id : null;
      const key = typeof finding.key === 'string' ? finding.key : null;
      const findingClass = ['path', 'broker', 'bridge', 'drift', 'motif', 'fragility', 'ecosystem_gap'].includes(String(finding.class))
        ? finding.class as InternalGraphCaseFindingClass
        : null;
      if (!findingId || !key || !findingClass) return [];
      return [{
        id: findingId,
        key,
        class: findingClass,
        summary: typeof finding.summary === 'string' ? finding.summary : '',
        score: toNumber(finding.score),
        firstSeenAt: typeof finding.firstSeenAt === 'string' ? finding.firstSeenAt : new Date().toISOString(),
        lastSeenAt: typeof finding.lastSeenAt === 'string' ? finding.lastSeenAt : new Date().toISOString(),
      }];
    }),
  };
}

export async function loadInternalGraphCases(): Promise<InternalGraphCase[]> {
  const { data, error } = await supabase.rpc('get_internal_graph_cases');
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraphCasebook.service] load cases:', error);
    throw new Error(error?.message ?? 'Unable to load Casebook.');
  }
  const raw = data as Record<string, unknown>;
  return (Array.isArray(raw.cases) ? raw.cases : []).flatMap((item) => {
    const normalized = normalizeCase(item);
    return normalized ? [normalized] : [];
  });
}

export async function createInternalGraphCase(input: {
  title: string;
  objective?: string | null;
  targetQuery?: string | null;
  scopeEventId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_internal_graph_case', {
    p_title: input.title.trim(),
    p_objective: input.objective?.trim() || null,
    p_target_query: input.targetQuery?.trim() || null,
    p_scope_event_id: input.scopeEventId ?? null,
  });
  if (error || typeof data !== 'string') {
    console.error('[internalGraphCasebook.service] create case:', error);
    throw new Error(error?.message ?? 'Unable to create Casebook case.');
  }
  return data;
}

export async function pinInternalGraphCaseNode(caseId: string, nodeId: string, note?: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('pin_internal_graph_case_node', {
    p_case_id: caseId,
    p_node_key: nodeId,
    p_note: note?.trim() || null,
  });
  if (error) {
    console.error('[internalGraphCasebook.service] pin node:', error);
    throw new Error(error.message ?? 'Unable to pin graph node.');
  }
  return data === true;
}

export async function setInternalGraphCaseStatus(caseId: string, status: InternalGraphCaseStatus): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_internal_graph_case_status', {
    p_case_id: caseId,
    p_status: status,
  });
  if (error) {
    console.error('[internalGraphCasebook.service] case status:', error);
    throw new Error(error.message ?? 'Unable to update case status.');
  }
  return data === true;
}

export async function upsertInternalGraphCaseFinding(input: {
  caseId: string;
  key: string;
  class: InternalGraphCaseFindingClass;
  summary: string;
  score: number;
  evidence?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_internal_graph_case_finding', {
    p_case_id: input.caseId,
    p_finding_key: input.key,
    p_finding_class: input.class,
    p_summary: input.summary,
    p_score: input.score,
    p_evidence: input.evidence ?? {},
  });
  if (error || typeof data !== 'string') {
    console.error('[internalGraphCasebook.service] finding:', error);
    throw new Error(error?.message ?? 'Unable to persist case finding.');
  }
  return data;
}
