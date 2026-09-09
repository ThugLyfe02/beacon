import type {
  InternalGraphWatchEvent,
  InternalGraphWatchRule,
  InternalGraphWatchtowerState,
} from './internalGraphWatchtower.service';
import type { InternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';

export type InternalWatchtowerIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type InternalWatchtowerIncidentFamily =
  | 'fragility'
  | 'topology_change'
  | 'brokerage'
  | 'motif_shift'
  | 'machine_change'
  | 'other';

export interface InternalWatchtowerIncident {
  id: string;
  family: InternalWatchtowerIncidentFamily;
  severity: InternalWatchtowerIncidentSeverity;
  score: number;
  eventId: string | null;
  title: string;
  summary: string;
  eventCount: number;
  openEventCount: number;
  ruleIds: string[];
  conditionKeys: string[];
  evidenceDigests: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  reasons: string[];
  recommendedReviewSurface: 'InternalForensicsLab' | 'InternalEpochLab' | 'InternalMachineRegistry' | 'InternalTargetRouting' | 'InternalWatchtower';
}

export interface InternalWatchtowerTriageResult {
  generatedAt: string;
  incidents: InternalWatchtowerIncident[];
  openIncidentCount: number;
  criticalIncidentCount: number;
  operatingRule: string;
}

function familyForCondition(conditionKey: string): InternalWatchtowerIncidentFamily {
  const normalized = conditionKey.toLowerCase();
  if (
    normalized.includes('structural_dependence')
    || normalized.includes('articulation')
    || normalized.includes('critical_bridge')
  ) return 'fragility';
  if (
    normalized.includes('node_count')
    || normalized.includes('edge_count')
    || normalized.includes('community_count')
  ) return 'topology_change';
  if (normalized.includes('broker')) return 'brokerage';
  if (normalized.startsWith('motif:')) return 'motif_shift';
  if (normalized.includes('machine_result_changed')) return 'machine_change';
  return 'other';
}

function baseSeverityScore(family: InternalWatchtowerIncidentFamily, conditionKeys: string[]): number {
  if (family === 'fragility') return 7.8;
  if (family === 'topology_change') return 5.6;
  if (family === 'brokerage') return 5.2;
  if (family === 'motif_shift') {
    return conditionKeys.some((key) => key.includes('articulation_dependence')) ? 7.1 : 4.7;
  }
  if (family === 'machine_change') return 4.9;
  return 3.5;
}

function severityForScore(score: number): InternalWatchtowerIncidentSeverity {
  if (score >= 10) return 'critical';
  if (score >= 7.5) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

function reviewSurface(family: InternalWatchtowerIncidentFamily): InternalWatchtowerIncident['recommendedReviewSurface'] {
  if (family === 'fragility') return 'InternalForensicsLab';
  if (family === 'topology_change') return 'InternalEpochLab';
  if (family === 'brokerage') return 'InternalTargetRouting';
  if (family === 'motif_shift') return 'InternalForensicsLab';
  if (family === 'machine_change') return 'InternalMachineRegistry';
  return 'InternalWatchtower';
}

function ruleTitle(ruleById: Map<string, InternalGraphWatchRule>, ruleId: string): string {
  return ruleById.get(ruleId)?.title ?? 'Watchtower condition';
}

function incidentKey(event: InternalGraphWatchEvent): string {
  return `${event.eventId ?? 'global'}|${familyForCondition(event.conditionKey)}`;
}

/**
 * Correlates bounded Watchtower alerts into operator incidents without persisting a
 * second event store. Incidents are derived from the caller's private Watchtower
 * state and can be recomputed after rules, evidence-health policy or scoring changes.
 *
 * Severity describes urgency of graph-condition review, never severity/risk/value of
 * any person or organization.
 */
export function triageInternalWatchtower(input: {
  state: InternalGraphWatchtowerState;
  epistemicHealth?: InternalGraphEpistemicHealth | null;
  now?: number;
}): InternalWatchtowerTriageResult {
  const now = input.now ?? Date.now();
  const ruleById = new Map(input.state.rules.map((rule) => [rule.id, rule] as const));
  const groups = new Map<string, InternalGraphWatchEvent[]>();

  for (const event of input.state.events) {
    const ageMs = now - Date.parse(event.createdAt);
    if (!Number.isFinite(ageMs) || ageMs > 14 * 86_400_000) continue;
    const key = incidentKey(event);
    const rows = groups.get(key) ?? [];
    rows.push(event);
    groups.set(key, rows);
  }

  const incidents: InternalWatchtowerIncident[] = [];
  for (const [key, events] of groups) {
    const ordered = [...events].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const latest = ordered[ordered.length - 1];
    if (!latest) continue;
    const family = familyForCondition(latest.conditionKey);
    const open = ordered.filter((event) => !event.acknowledgedAt);
    const ruleIds = [...new Set(ordered.map((event) => event.ruleId))];
    const conditionKeys = [...new Set(ordered.map((event) => event.conditionKey))];
    const evidenceDigests = [...new Set(ordered.map((event) => event.evidenceDigest))];
    const recurrence = Math.min(3.2, Math.log2(1 + ordered.length) * 1.15);
    const unacknowledgedBoost = Math.min(2.2, open.length * 0.45);
    const latestAgeHours = Math.max(0, (now - Date.parse(latest.createdAt)) / 3_600_000);
    const recencyBoost = latestAgeHours <= 2 ? 1.1 : latestAgeHours <= 12 ? 0.6 : 0.2;
    const epistemicBoost = input.epistemicHealth?.band === 'degraded'
      ? 1.6
      : input.epistemicHealth?.band === 'fragile'
        ? 0.9
        : 0;
    const score = baseSeverityScore(family, conditionKeys) + recurrence + unacknowledgedBoost + recencyBoost + epistemicBoost;
    const severity = severityForScore(score);
    const firstSeenAt = ordered[0]?.createdAt ?? latest.createdAt;
    const lastSeenAt = latest.createdAt;
    const primaryRuleTitle = ruleTitle(ruleById, latest.ruleId);

    const reasons = [
      `${ordered.length} related signal${ordered.length === 1 ? '' : 's'} in the last 14 days`,
      `${open.length} unacknowledged signal${open.length === 1 ? '' : 's'}`,
      `${conditionKeys.length} distinct structural condition${conditionKeys.length === 1 ? '' : 's'} reinforcing this incident family`,
      ...(input.epistemicHealth?.band === 'fragile' || input.epistemicHealth?.band === 'degraded'
        ? [`graph epistemic health is ${input.epistemicHealth.band}; incident review urgency is increased while analytical certainty remains reduced`]
        : []),
      'incident severity ranks graph-condition review urgency only; it is not a risk score for a person or organization',
    ];

    incidents.push({
      id: `incident:${key}`,
      family,
      severity,
      score,
      eventId: latest.eventId,
      title: `${family.replaceAll('_', ' ')} · ${primaryRuleTitle}`,
      summary: `${open.length > 0 ? 'Open' : 'Acknowledged'} Watchtower incident with ${ordered.length} correlated structural signal${ordered.length === 1 ? '' : 's'}.`,
      eventCount: ordered.length,
      openEventCount: open.length,
      ruleIds,
      conditionKeys,
      evidenceDigests,
      firstSeenAt,
      lastSeenAt,
      reasons,
      recommendedReviewSurface: reviewSurface(family),
    });
  }

  incidents.sort((left, right) =>
    right.score - left.score
    || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
    || left.id.localeCompare(right.id));

  return {
    generatedAt: new Date(now).toISOString(),
    incidents,
    openIncidentCount: incidents.filter((incident) => incident.openEventCount > 0).length,
    criticalIncidentCount: incidents.filter((incident) => incident.openEventCount > 0 && incident.severity === 'critical').length,
    operatingRule: 'Watchtower incidents correlate private structural signals for review. They do not target people, predict misconduct, or execute actions.',
  };
}
