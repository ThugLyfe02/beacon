import { supabase } from '../lib/supabase';
import type { InternalGraphEntityAlias } from './InternalGraphCanonicalizationEngine';

export interface InternalGraphEntityAliasState {
  generatedAt: string;
  canonicalizationVersion: string;
  aliases: InternalGraphEntityAlias[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
