import { supabase } from '../lib/supabase';
import type {
  InternalGraphConfidence,
  InternalGraphPayload,
} from './InternalGraphEngine';

export type InternalGraphCapability =
  | 'graph_read'
  | 'graph_restricted'
  | 'graph_manage'
  | 'graph_export';

export interface InternalOperatorContext {
  allowed: boolean;
  capabilities: InternalGraphCapability[];
  expiresAt: string | null;
}

interface GraphAssertionInput {
  subjectUserId: string;
  entityKind: 'organization' | 'domain' | 'project' | 'topic' | 'venue' | 'event' | 'role';
  entityLabel: string;
  relation: string;
  confidence: InternalGraphConfidence;
  sourceUri?: string | null;
  note?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
}

function normalizeOperatorContext(value: unknown): InternalOperatorContext {
  if (!value || typeof value !== 'object') {
    return { allowed: false, capabilities: [], expiresAt: null };
  }
  const raw = value as Record<string, unknown>;
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((item): item is InternalGraphCapability =>
        typeof item === 'string'
        && ['graph_read', 'graph_restricted', 'graph_manage', 'graph_export'].includes(item))
    : [];
  return {
    allowed: raw.allowed === true,
    capabilities,
    expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
  };
}

export async function getInternalOperatorContext(): Promise<InternalOperatorContext> {
  const { data, error } = await supabase.rpc('get_internal_operator_context');
  if (error) {
    console.error('[internalGraph.service] operator context:', error);
    return { allowed: false, capabilities: [], expiresAt: null };
  }
  return normalizeOperatorContext(data);
}

export async function loadInternalIntelligenceGraph(input: {
  eventId?: string | null;
  includeRestricted?: boolean;
  limit?: number;
} = {}): Promise<InternalGraphPayload> {
  const { data, error } = await supabase.rpc('get_internal_intelligence_graph', {
    p_event_id: input.eventId ?? null,
    p_include_restricted: input.includeRestricted ?? false,
    p_limit: Math.max(20, Math.min(input.limit ?? 900, 2000)),
  });

  if (error || !data) {
    console.error('[internalGraph.service] graph load:', error);
    throw new Error(error?.message ?? 'Unable to load internal intelligence graph.');
  }

  const payload = data as InternalGraphPayload;
  return {
    generatedAt: payload.generatedAt,
    eventId: payload.eventId ?? null,
    graphVersion: payload.graphVersion,
    nodeCount: Number(payload.nodeCount ?? payload.nodes?.length ?? 0),
    edgeCount: Number(payload.edgeCount ?? payload.edges?.length ?? 0),
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    edges: Array.isArray(payload.edges) ? payload.edges : [],
  };
}

export async function addInternalGraphAssertion(input: GraphAssertionInput): Promise<string> {
  const { data, error } = await supabase.rpc('add_internal_graph_assertion', {
    p_subject_user_id: input.subjectUserId,
    p_entity_kind: input.entityKind,
    p_entity_label: input.entityLabel.trim(),
    p_relation: input.relation.trim(),
    p_confidence: input.confidence,
    p_source_uri: input.sourceUri?.trim() || null,
    p_note: input.note?.trim() || null,
    p_observed_at: input.observedAt ?? new Date().toISOString(),
    p_expires_at: input.expiresAt ?? null,
  });

  if (error || typeof data !== 'string') {
    console.error('[internalGraph.service] assertion add:', error);
    throw new Error(error?.message ?? 'Unable to add graph bridge assertion.');
  }
  return data;
}
