import { supabase } from '../lib/supabase';
import type { InternalGraphEntityAlias } from './InternalGraphCanonicalizationEngine';
import type { InternalGraphPayload } from './InternalGraphEngine';

export interface InternalGraphEntityAliasState {
  generatedAt: string;
  canonicalizationVersion: string;
  aliases: InternalGraphEntityAlias[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRawGraph(value: unknown): InternalGraphPayload {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nodes = Array.isArray(raw.nodes) ? raw.nodes as InternalGraphPayload['nodes'] : [];
  const edges = Array.isArray(raw.edges) ? raw.edges as InternalGraphPayload['edges'] : [];
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    eventId: typeof raw.eventId === 'string' ? raw.eventId : null,
    graphVersion: typeof raw.graphVersion === 'string' ? raw.graphVersion : 'unknown',
    nodeCount: toNumber(raw.nodeCount ?? nodes.length),
    edgeCount: toNumber(raw.edgeCount ?? edges.length),
    nodes,
    edges,
  };
}

function parseAlias(value: unknown): InternalGraphEntityAlias | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.aliasNodeId !== 'string'
    || typeof row.canonicalNodeId !== 'string'
    || typeof row.kind !== 'string'
  ) return null;
  return {
    id: row.id,
    aliasNodeId: row.aliasNodeId,
    canonicalNodeId: row.canonicalNodeId,
    kind: row.kind,
    confidence: Math.max(0, Math.min(1, toNumber(row.confidence))),
    reason: typeof row.reason === 'string' ? row.reason : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : new Date().toISOString(),
  };
}

/**
 * Raw graph access exists only for the operator Entity Resolution workbench so
 * proposed aliases can be inspected before canonicalization. Ordinary internal
 * graph consumers must use loadInternalIntelligenceGraph(), which canonicalizes.
 */
export async function loadRawInternalGraphForEntityResolution(input: {
  eventId?: string | null;
  limit?: number;
} = {}): Promise<InternalGraphPayload> {
  const { data, error } = await supabase.rpc('get_internal_intelligence_graph', {
    p_event_id: input.eventId ?? null,
    p_include_restricted: false,
    p_limit: Math.max(20, Math.min(input.limit ?? 1800, 2000)),
  });
  if (error || !data) {
    console.error('[internalGraphEntityResolution.service] raw graph:', error);
    throw new Error(error?.message ?? 'Unable to load raw graph for entity resolution.');
  }
  return normalizeRawGraph(data);
}

export async function loadInternalGraphEntityAliasState(): Promise<InternalGraphEntityAliasState> {
  const { data, error } = await supabase.rpc('get_internal_graph_entity_aliases');
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraphEntityResolution.service] alias load:', error);
    throw new Error(error?.message ?? 'Unable to load approved entity canonicalization map.');
  }
  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.aliases) ? raw.aliases as unknown[] : [];
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    canonicalizationVersion: typeof raw.canonicalizationVersion === 'string'
      ? raw.canonicalizationVersion
      : '',
    aliases: rows.flatMap((row) => {
      const parsed = parseAlias(row);
      return parsed ? [parsed] : [];
    }),
  };
}

export async function loadInternalGraphEntityAliases(): Promise<InternalGraphEntityAlias[]> {
  return (await loadInternalGraphEntityAliasState()).aliases;
}

export async function approveInternalGraphEntityAlias(input: {
  eventId?: string | null;
  aliasNodeId: string;
  canonicalNodeId: string;
  confidence: number;
  reason?: string | null;
}): Promise<InternalGraphEntityAlias> {
  const { data, error } = await supabase.rpc('approve_internal_graph_entity_alias', {
    p_event_id: input.eventId ?? null,
    p_alias_node_key: input.aliasNodeId,
    p_canonical_node_key: input.canonicalNodeId,
    p_confidence: Math.max(0, Math.min(1, input.confidence)),
    p_reason: input.reason?.trim() || null,
  });
  if (error) throw new Error(error.message ?? 'Unable to approve entity canonicalization.');
  const parsed = parseAlias(data);
  if (!parsed) throw new Error('Entity canonicalization response was invalid.');
  return parsed;
}

export async function revokeInternalGraphEntityAlias(aliasId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_internal_graph_entity_alias', {
    p_alias_id: aliasId,
  });
  if (error) throw new Error(error.message ?? 'Unable to revoke entity canonicalization.');
}
