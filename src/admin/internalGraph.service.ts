import { supabase } from '../lib/supabase';
import type {
  InternalGraphConfidence,
  InternalGraphPayload,
} from './InternalGraphEngine';
import type { InternalBridgePattern } from './InternalGraphStrategyEngine';

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

export type InternalBridgeDisposition = 'watching' | 'introduced' | 'dismissed';
export type InternalBridgeObservedStage =
  | 'none'
  | 'mutual'
  | 'office_hours'
  | 'outcome_aligned'
  | 'outcome_completed';

export interface InternalBridgeWatch {
  id: string;
  eventId: string | null;
  sourceNodeId: string;
  targetNodeId: string;
  viaNodeId: string;
  initialScore: number;
  rationale: string[];
  disposition: InternalBridgeDisposition;
  observedStage: InternalBridgeObservedStage;
  introducedAt: string | null;
  firstObservedAt: string | null;
  createdAt: string;
}

export interface InternalBridgeCalibration {
  total: number;
  introduced: number;
  mutualOrBetter: number;
  officeHoursOrBetter: number;
  outcomeAlignedOrBetter: number;
  outcomeCompleted: number;
}

export interface InternalBridgeWatchSummary {
  generatedAt: string;
  watches: InternalBridgeWatch[];
  calibration: InternalBridgeCalibration;
  attributionNote: string;
}

export interface InternalGraphEventSummary {
  eventId: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  finalizedAt: string | null;
  venueKey: string | null;
  participantCount: number;
  mutualCount: number;
  officeHoursCompleted: number;
  outcomeCompleted: number;
}

export interface InternalGraphEventSequence {
  generatedAt: string;
  events: InternalGraphEventSummary[];
}

export interface InternalBridgePatternCalibration {
  generatedAt: string;
  patterns: InternalBridgePattern[];
  attributionNote: string;
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

function toFiniteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeGraphPayload(data: unknown): InternalGraphPayload {
  const payload = (data && typeof data === 'object' ? data : {}) as Partial<InternalGraphPayload>;
  return {
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
    eventId: typeof payload.eventId === 'string' ? payload.eventId : null,
    graphVersion: typeof payload.graphVersion === 'string' ? payload.graphVersion : 'unknown',
    nodeCount: Number(payload.nodeCount ?? payload.nodes?.length ?? 0),
    edgeCount: Number(payload.edgeCount ?? payload.edges?.length ?? 0),
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    edges: Array.isArray(payload.edges) ? payload.edges : [],
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
  return normalizeGraphPayload(data);
}

export async function loadInternalGraphEventSequence(limit = 36): Promise<InternalGraphEventSequence> {
  const { data, error } = await supabase.rpc('get_internal_graph_event_sequence', {
    p_limit: Math.max(2, Math.min(limit, 120)),
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraph.service] event sequence:', error);
    throw new Error(error?.message ?? 'Unable to load graph event sequence.');
  }
  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.events) ? raw.events : [];
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    events: rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const eventId = typeof row.eventId === 'string' ? row.eventId : null;
      if (!eventId) return [];
      return [{
        eventId,
        name: typeof row.name === 'string' ? row.name : 'Unnamed event',
        startsAt: typeof row.startsAt === 'string' ? row.startsAt : null,
        endsAt: typeof row.endsAt === 'string' ? row.endsAt : null,
        finalizedAt: typeof row.finalizedAt === 'string' ? row.finalizedAt : null,
        venueKey: typeof row.venueKey === 'string' ? row.venueKey : null,
        participantCount: toFiniteNumber(row.participantCount),
        mutualCount: toFiniteNumber(row.mutualCount),
        officeHoursCompleted: toFiniteNumber(row.officeHoursCompleted),
        outcomeCompleted: toFiniteNumber(row.outcomeCompleted),
      }];
    }),
  };
}

export async function loadInternalBridgePatternCalibration(): Promise<InternalBridgePatternCalibration> {
  const { data, error } = await supabase.rpc('get_internal_bridge_pattern_calibration');
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraph.service] bridge patterns:', error);
    throw new Error(error?.message ?? 'Unable to load historical bridge patterns.');
  }
  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.patterns) ? raw.patterns : [];
  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    attributionNote: typeof raw.attributionNote === 'string'
      ? raw.attributionNote
      : 'Pattern rates describe chronology, not causal estimates.',
    patterns: rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const connectorKind = typeof row.connectorKind === 'string' ? row.connectorKind : null;
      if (!connectorKind) return [];
      return [{
        connectorKind,
        sampleSize: toFiniteNumber(row.sampleSize),
        introducedRate: toFiniteNumber(row.introducedRate),
        mutualRate: toFiniteNumber(row.mutualRate),
        officeHoursRate: toFiniteNumber(row.officeHoursRate),
        outcomeRate: toFiniteNumber(row.outcomeRate),
        completedRate: toFiniteNumber(row.completedRate),
        averageInitialScore: toFiniteNumber(row.averageInitialScore),
        confidence: Math.max(0, Math.min(1, toFiniteNumber(row.confidence))),
        lastObservedAt: typeof row.lastObservedAt === 'string' ? row.lastObservedAt : null,
      }];
    }),
  };
}

export async function loadInternalGraphExportPayload(input: {
  eventId?: string | null;
  includeRestricted?: boolean;
  limit?: number;
} = {}): Promise<InternalGraphPayload> {
  const { data, error } = await supabase.rpc('get_internal_graph_export_payload', {
    p_event_id: input.eventId ?? null,
    p_include_restricted: input.includeRestricted ?? false,
    p_limit: Math.max(20, Math.min(input.limit ?? 1800, 2000)),
  });
  if (error || !data) {
    console.error('[internalGraph.service] export payload:', error);
    throw new Error(error?.message ?? 'Unable to load graph export payload.');
  }
  return normalizeGraphPayload(data);
}

export async function getInternalBridgeSuppressions(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('get_internal_bridge_suppressions');
  if (error) {
    console.error('[internalGraph.service] bridge suppressions:', error);
    throw new Error('Unable to establish bridge-safety suppressions.');
  }
  return new Set(Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : []);
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

export async function watchInternalGraphBridge(input: {
  sourceUserId: string;
  targetUserId: string;
  viaNodeId: string;
  eventId?: string | null;
  score: number;
  rationale: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc('watch_internal_graph_bridge', {
    p_source_user_id: input.sourceUserId,
    p_target_user_id: input.targetUserId,
    p_via_node_key: input.viaNodeId,
    p_event_id: input.eventId ?? null,
    p_initial_score: Math.max(0, input.score),
    p_rationale: input.rationale,
  });
  if (error || typeof data !== 'string') {
    console.error('[internalGraph.service] bridge watch:', error);
    throw new Error(error?.message ?? 'Unable to watch this bridge candidate.');
  }
  return data;
}

export async function setInternalBridgeDisposition(
  watchId: string,
  disposition: InternalBridgeDisposition,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_internal_bridge_disposition', {
    p_watch_id: watchId,
    p_disposition: disposition,
  });
  if (error) {
    console.error('[internalGraph.service] bridge disposition:', error);
    throw new Error(error.message ?? 'Unable to update bridge disposition.');
  }
  return data === true;
}

export async function getInternalBridgeWatchSummary(): Promise<InternalBridgeWatchSummary> {
  const { data, error } = await supabase.rpc('get_internal_bridge_watch_summary');
  if (error || !data || typeof data !== 'object') {
    console.error('[internalGraph.service] bridge summary:', error);
    throw new Error(error?.message ?? 'Unable to load bridge feedback.');
  }

  const raw = data as Record<string, unknown>;
  const calibrationRaw = raw.calibration && typeof raw.calibration === 'object'
    ? raw.calibration as Record<string, unknown>
    : {};
  const watchesRaw = Array.isArray(raw.watches) ? raw.watches : [];

  return {
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    attributionNote: typeof raw.attributionNote === 'string'
      ? raw.attributionNote
      : 'Observed stages are chronology, not causal attribution.',
    calibration: {
      total: toFiniteNumber(calibrationRaw.total),
      introduced: toFiniteNumber(calibrationRaw.introduced),
      mutualOrBetter: toFiniteNumber(calibrationRaw.mutualOrBetter),
      officeHoursOrBetter: toFiniteNumber(calibrationRaw.officeHoursOrBetter),
      outcomeAlignedOrBetter: toFiniteNumber(calibrationRaw.outcomeAlignedOrBetter),
      outcomeCompleted: toFiniteNumber(calibrationRaw.outcomeCompleted),
    },
    watches: watchesRaw.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const watch = item as Record<string, unknown>;
      const id = typeof watch.id === 'string' ? watch.id : null;
      const sourceNodeId = typeof watch.sourceNodeId === 'string' ? watch.sourceNodeId : null;
      const targetNodeId = typeof watch.targetNodeId === 'string' ? watch.targetNodeId : null;
      const viaNodeId = typeof watch.viaNodeId === 'string' ? watch.viaNodeId : null;
      if (!id || !sourceNodeId || !targetNodeId || !viaNodeId) return [];
      const disposition = ['watching', 'introduced', 'dismissed'].includes(String(watch.disposition))
        ? watch.disposition as InternalBridgeDisposition
        : 'watching';
      const observedStage = ['none', 'mutual', 'office_hours', 'outcome_aligned', 'outcome_completed'].includes(String(watch.observedStage))
        ? watch.observedStage as InternalBridgeObservedStage
        : 'none';
      return [{
        id,
        eventId: typeof watch.eventId === 'string' ? watch.eventId : null,
        sourceNodeId,
        targetNodeId,
        viaNodeId,
        initialScore: toFiniteNumber(watch.initialScore),
        rationale: Array.isArray(watch.rationale)
          ? watch.rationale.filter((reason): reason is string => typeof reason === 'string')
          : [],
        disposition,
        observedStage,
        introducedAt: typeof watch.introducedAt === 'string' ? watch.introducedAt : null,
        firstObservedAt: typeof watch.firstObservedAt === 'string' ? watch.firstObservedAt : null,
        createdAt: typeof watch.createdAt === 'string' ? watch.createdAt : new Date().toISOString(),
      }];
    }),
  };
}
