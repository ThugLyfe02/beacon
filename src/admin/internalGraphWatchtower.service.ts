import { supabase } from '../lib/supabase';

export type InternalGraphWatchRuleKind =
  | 'metric_threshold'
  | 'metric_delta'
  | 'motif_threshold'
  | 'machine_digest_changed';

export type InternalGraphWatchMetricKey =
  | 'node_count'
  | 'edge_count'
  | 'community_count'
  | 'articulation_count'
  | 'critical_bridge_count'
  | 'structural_dependence'
  | 'broker_count'
  | 'new_broker_count';

export type InternalGraphWatchMotifKey =
  | 'triadic_closure'
  | 'cross_community_context_bridge'
  | 'relationship_outcome_ladder'
  | 'repeated_cross_community_edge'
  | 'articulation_dependence'
  | 'multi_community_broker';

export type InternalGraphWatchComparator = 'gte' | 'lte';

export interface InternalGraphWatchRule {
  id: string;
  title: string;
  eventId: string | null;
  ruleKind: InternalGraphWatchRuleKind;
  metricKey: InternalGraphWatchMetricKey | null;
  motifKey: InternalGraphWatchMotifKey | null;
  recipeId: string | null;
  comparator: InternalGraphWatchComparator | null;
  threshold: number | null;
  enabled: boolean;
  cooldownMinutes: number;
  lastValue: number | null;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface InternalGraphWatchEvent {
  id: string;
  ruleId: string;
  eventId: string | null;
  epochId: string | null;
  manifestId: string | null;
  conditionKey: string;
  observedValue: number | null;
  previousValue: number | null;
  evidenceDigest: string;
  createdAt: string;
  acknowledgedAt: string | null;
  expiresAt: string;
}

export interface InternalGraphWatchtowerState {
  generatedAt: string;
  rules: InternalGraphWatchRule[];
  events: InternalGraphWatchEvent[];
  operatingRule: string;
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseRule(value: unknown): InternalGraphWatchRule | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
  const ruleKind = String(row.ruleKind ?? '') as InternalGraphWatchRuleKind;
  if (!['metric_threshold', 'metric_delta', 'motif_threshold', 'machine_digest_changed'].includes(ruleKind)) return null;
  const metricKeyRaw = stringOrNull(row.metricKey);
  const motifKeyRaw = stringOrNull(row.motifKey);
  const comparatorRaw = stringOrNull(row.comparator);
  return {
    id: row.id,
    title: row.title,
    eventId: stringOrNull(row.eventId),
    ruleKind,
    metricKey: metricKeyRaw as InternalGraphWatchMetricKey | null,
    motifKey: motifKeyRaw as InternalGraphWatchMotifKey | null,
    recipeId: stringOrNull(row.recipeId),
    comparator: comparatorRaw === 'gte' || comparatorRaw === 'lte' ? comparatorRaw : null,
    threshold: finiteOrNull(row.threshold),
    enabled: row.enabled === true,
    cooldownMinutes: Math.max(5, Number(row.cooldownMinutes ?? 60) || 60),
    lastValue: finiteOrNull(row.lastValue),
    lastEvaluatedAt: stringOrNull(row.lastEvaluatedAt),
    lastTriggeredAt: stringOrNull(row.lastTriggeredAt),
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

function parseEvent(value: unknown): InternalGraphWatchEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string'
    || typeof row.ruleId !== 'string'
    || typeof row.conditionKey !== 'string'
    || typeof row.evidenceDigest !== 'string'
  ) return null;
  return {
    id: row.id,
    ruleId: row.ruleId,
    eventId: stringOrNull(row.eventId),
    epochId: stringOrNull(row.epochId),
    manifestId: stringOrNull(row.manifestId),
    conditionKey: row.conditionKey,
    observedValue: finiteOrNull(row.observedValue),
    previousValue: finiteOrNull(row.previousValue),
    evidenceDigest: row.evidenceDigest,
    createdAt: stringOrNull(row.createdAt) ?? new Date().toISOString(),
    acknowledgedAt: stringOrNull(row.acknowledgedAt),
    expiresAt: stringOrNull(row.expiresAt) ?? new Date().toISOString(),
  };
}

export async function loadInternalGraphWatchtower(): Promise<InternalGraphWatchtowerState> {
  const { data, error } = await supabase.rpc('get_internal_graph_watchtower');
  if (error || !data || typeof data !== 'object') {
    throw new Error(error?.message ?? 'Unable to load Constellation Watchtower.');
  }
  const row = data as Record<string, unknown>;
  const rules = Array.isArray(row.rules) ? row.rules : [];
  const events = Array.isArray(row.events) ? row.events : [];
  return {
    generatedAt: stringOrNull(row.generatedAt) ?? new Date().toISOString(),
    rules: rules.flatMap((item) => {
      const parsed = parseRule(item);
      return parsed ? [parsed] : [];
    }),
    events: events.flatMap((item) => {
      const parsed = parseEvent(item);
      return parsed ? [parsed] : [];
    }),
    operatingRule: typeof row.operatingRule === 'string'
      ? row.operatingRule
      : 'Watchtower monitors aggregate graph conditions only and never performs social actions.',
  };
}

export async function saveInternalGraphWatchRule(input: {
  title: string;
  eventId?: string | null;
  ruleKind: InternalGraphWatchRuleKind;
  metricKey?: InternalGraphWatchMetricKey | null;
  motifKey?: InternalGraphWatchMotifKey | null;
  recipeId?: string | null;
  comparator?: InternalGraphWatchComparator | null;
  threshold?: number | null;
  cooldownMinutes?: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_internal_graph_watch_rule', {
    p_title: input.title.trim(),
    p_event_id: input.eventId ?? null,
    p_rule_kind: input.ruleKind,
    p_metric_key: input.metricKey ?? null,
    p_motif_key: input.motifKey ?? null,
    p_recipe_id: input.recipeId ?? null,
    p_comparator: input.comparator ?? null,
    p_threshold: input.threshold ?? null,
    p_cooldown_minutes: Math.max(5, Math.min(input.cooldownMinutes ?? 60, 10_080)),
  });
  if (error || typeof data !== 'string') {
    throw new Error(error?.message ?? 'Unable to save Watchtower rule.');
  }
  return data;
}

export async function setInternalGraphWatchRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_internal_graph_watch_rule_enabled', {
    p_rule_id: ruleId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message ?? 'Unable to update Watchtower rule.');
}

export async function acknowledgeInternalGraphWatchEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_internal_graph_watch_event', {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message ?? 'Unable to acknowledge Watchtower event.');
}
