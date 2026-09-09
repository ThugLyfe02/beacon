import { supabase } from '../lib/supabase';
import type { InternalGraphConfidence } from './InternalGraphEngine';
import type { InternalGraphPerspectiveDefinition } from './InternalGraphPerspectiveEngine';

export interface InternalSavedGraphPerspective extends InternalGraphPerspectiveDefinition {
  builtin: false;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface InternalGraphPerspectiveCatalog {
  generatedAt: string;
  perspectives: InternalSavedGraphPerspective[];
  operatingRule: string;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 40);
}

function parseDefinition(id: string, title: string, description: string, value: unknown): InternalSavedGraphPerspective | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const floor = String(row.confidenceFloor ?? 'DERIVED') as InternalGraphConfidence;
  if (!['VERIFIED', 'DERIVED', 'AMBIGUOUS'].includes(floor)) return null;
  const minEvidence = Number(row.minEvidenceCount ?? 1);
  const maxAgeRaw = row.maxAgeDays;
  const maxAge = maxAgeRaw == null ? null : Number(maxAgeRaw);
  return {
    id,
    title,
    description,
    focusKinds: stringArray(row.focusKinds),
    relations: stringArray(row.relations),
    confidenceFloor: floor,
    minEvidenceCount: Number.isFinite(minEvidence) ? Math.max(1, Math.min(20, Math.floor(minEvidence))) : 1,
    maxAgeDays: maxAge == null || !Number.isFinite(maxAge) ? null : Math.max(1, Math.min(3650, Math.floor(maxAge))),
    includeIsolates: row.includeIsolates === true,
    builtin: false,
    createdAt: '',
    updatedAt: '',
    expiresAt: '',
  };
}

function parsePerspective(value: unknown): InternalSavedGraphPerspective | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
  const parsed = parseDefinition(
    row.id,
    row.title,
    typeof row.description === 'string' ? row.description : '',
    row.definition,
  );
  if (!parsed) return null;
  parsed.createdAt = typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();
  parsed.updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : parsed.createdAt;
  parsed.expiresAt = typeof row.expiresAt === 'string' ? row.expiresAt : parsed.createdAt;
  return parsed;
}

export async function loadInternalGraphPerspectives(): Promise<InternalGraphPerspectiveCatalog> {
  const { data, error } = await supabase.rpc('get_internal_graph_perspectives');
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load private graph Perspectives.');
  }
  const row = data as Record<string, unknown>;
  const perspectives = Array.isArray(row.perspectives) ? row.perspectives : [];
  return {
    generatedAt: typeof row.generatedAt === 'string' ? row.generatedAt : new Date().toISOString(),
    perspectives: perspectives.flatMap((item) => {
      const parsed = parsePerspective(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Perspectives filter already-authorized graph evidence only.',
  };
}

export async function saveInternalGraphPerspective(input: {
  id?: string | null;
  title: string;
  description?: string | null;
  definition: Omit<InternalGraphPerspectiveDefinition, 'id' | 'title' | 'description' | 'builtin'>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_internal_graph_perspective', {
    p_id: input.id ?? null,
    p_title: input.title.trim(),
    p_description: input.description?.trim() || null,
    p_definition: {
      focusKinds: input.definition.focusKinds,
      relations: input.definition.relations,
      confidenceFloor: input.definition.confidenceFloor,
      minEvidenceCount: input.definition.minEvidenceCount,
      maxAgeDays: input.definition.maxAgeDays,
      includeIsolates: input.definition.includeIsolates,
    },
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to save graph Perspective.');
  }
  return data;
}

export async function deleteInternalGraphPerspective(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_internal_graph_perspective', { p_id: id });
  if (error) throw new Error(error.message ?? 'Unable to delete graph Perspective.');
  return data === true;
}
