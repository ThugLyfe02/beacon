import { supabase } from '../lib/supabase';
import type { InternalGraphAnalysis } from './InternalGraphEngine';
import type { InternalGraphStructuralForensics } from './InternalGraphForensicsEngine';
import type { InternalGraphMotif } from './InternalGraphMotifEngine';
import type {
  InternalGraphEpoch,
  InternalGraphEpochBroker,
  InternalGraphEpochCommunity,
  InternalGraphEpochHistory,
  InternalGraphEpochMotif,
} from './InternalGraphEpochEngine';

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCommunity(value: unknown): InternalGraphEpochCommunity | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  return {
    id: toNumber(row.id),
    label: typeof row.label === 'string' ? row.label : 'Community',
    size: toNumber(row.size),
    personCount: toNumber(row.personCount),
    cohesion: Math.max(0, Math.min(1, toNumber(row.cohesion))),
    memberAliases: toStringArray(row.memberAliases),
  };
}

function normalizeBroker(value: unknown): InternalGraphEpochBroker | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const subjectAlias = typeof row.subjectAlias === 'string' ? row.subjectAlias : null;
  if (!subjectAlias) return null;
  return {
    subjectAlias,
    rank: toNumber(row.rank),
    forensicScore: toNumber(row.forensicScore),
    brokerScore: toNumber(row.brokerScore),
    participationCoefficient: Math.max(0, Math.min(1, toNumber(row.participationCoefficient))),
    effectiveSize: Math.max(0, toNumber(row.effectiveSize)),
    redundancyRatio: Math.max(0, Math.min(1, toNumber(row.redundancyRatio))),
    articulation: row.articulation === true,
    crossCommunityCount: Math.max(0, toNumber(row.crossCommunityCount)),
  };
}

function normalizeMotif(value: unknown): InternalGraphEpochMotif | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const key = typeof row.key === 'string' ? row.key : null;
  if (!key) return null;
  return {
    key,
    count: Math.max(0, toNumber(row.count)),
    strength: Math.max(0, toNumber(row.strength)),
    class: typeof row.class === 'string' ? row.class : null,
  };
}

function normalizeEpoch(value: unknown): InternalGraphEpoch | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const epochId = typeof row.epochId === 'string' ? row.epochId : null;
  const eventId = typeof row.eventId === 'string' ? row.eventId : null;
  if (!epochId || !eventId) return null;
  return {
    epochId,
    eventId,
    eventName: typeof row.eventName === 'string' ? row.eventName : 'Unnamed event',
    capturedAt: typeof row.capturedAt === 'string' ? row.capturedAt : new Date().toISOString(),
    topologyDigest: typeof row.topologyDigest === 'string' ? row.topologyDigest : '',
    nodeCount: Math.max(0, toNumber(row.nodeCount)),
    edgeCount: Math.max(0, toNumber(row.edgeCount)),
    communityCount: Math.max(0, toNumber(row.communityCount)),
    articulationCount: Math.max(0, toNumber(row.articulationCount)),
    criticalBridgeCount: Math.max(0, toNumber(row.criticalBridgeCount)),
    structuralDependence: Math.max(0, Math.min(1, toNumber(row.structuralDependence))),
    communities: (Array.isArray(row.communities) ? row.communities : []).flatMap((item) => {
      const normalized = normalizeCommunity(item);
      return normalized ? [normalized] : [];
    }),
    brokers: (Array.isArray(row.brokers) ? row.brokers : []).flatMap((item) => {
      const normalized = normalizeBroker(item);
      return normalized ? [normalized] : [];
    }),
    motifs: (Array.isArray(row.motifs) ? row.motifs : []).flatMap((item) => {
      const normalized = normalizeMotif(item);
      return normalized ? [normalized] : [];
    }),
  };
}

export async function recordInternalGraphEpoch(input: {
  eventId: string;
  analysis: InternalGraphAnalysis;
  forensics: InternalGraphStructuralForensics;
  motifs: InternalGraphMotif[];
}): Promise<string> {
  const payload = {
    analysisVersion: 'forensics-v1',
    articulationCount: input.forensics.articulationNodeIds.length,
    criticalBridgeCount: input.forensics.criticalBridges.length,
    structuralDependence: input.forensics.structuralDependence,
    communities: input.analysis.communities.map((community) => ({
      id: community.id,
      label: community.label,
      nodeIds: community.nodeIds,
      cohesion: community.cohesion,
    })),
    brokers: input.forensics.brokers.slice(0, 100).map((broker) => ({
      nodeId: broker.nodeId,
      forensicScore: broker.forensicScore,
      brokerScore: broker.brokerScore,
      participationCoefficient: broker.participationCoefficient,
      effectiveSize: broker.effectiveSize,
      redundancyRatio: broker.redundancyRatio,
      articulation: broker.articulation,
      crossCommunityCount: broker.crossCommunityCount,
    })),
  };

  const motifPayload = input.motifs.map((motif) => ({
    key: motif.key,
    class: motif.class,
    count: motif.count,
    strength: motif.strength,
  }));

  const { data, error } = await supabase.rpc('record_internal_graph_epoch', {
    p_event_id: input.eventId,
    p_analysis: payload,
    p_motifs: motifPayload,
  });
  if (error || typeof data !== 'string') {
    console.error('[internalGraphEpoch.service] record epoch:', error);
    throw new Error(error?.message ?? 'Unable to record graph epoch.');
  }
  return data;
}

export async function loadInternalGraphEpochHistory(limit = 48): Promise<InternalGraphEpochHistory> {
  const { data, error } = await supabase.rpc('get_internal_graph_epoch_history', {
    p_limit: Math.max(1, Math.min(limit, 120)),
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraphEpoch.service] epoch history:', error);
    throw new Error(error?.message ?? 'Unable to load longitudinal graph memory.');
  }
  const row = data as Record<string, unknown>;
  return {
    generatedAt: typeof row.generatedAt === 'string' ? row.generatedAt : new Date().toISOString(),
    retentionNote: typeof row.retentionNote === 'string' ? row.retentionNote : 'Longitudinal graph memory is bounded.',
    epochs: (Array.isArray(row.epochs) ? row.epochs : []).flatMap((item) => {
      const normalized = normalizeEpoch(item);
      return normalized ? [normalized] : [];
    }),
  };
}
