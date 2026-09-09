import type { InternalGraphEdge, InternalGraphPayload } from './InternalGraphEngine';
import type { InternalTargetRoute } from './InternalTargetRoutingEngine';

export type InternalTimelineEventKind = 'first_observed' | 'reobserved';

export interface InternalTimelineEvent {
  id: string;
  timestamp: string;
  kind: InternalTimelineEventKind;
  edgeId: string;
  relation: string;
  sourceNodeId: string;
  targetNodeId: string;
  confidence: InternalGraphEdge['confidence'];
  evidenceCount: number;
}

export interface InternalTimelineEpisode {
  id: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  relationCount: number;
  relationFamilies: string[];
  verifiedRatio: number;
}

export interface InternalRelationProgression {
  pairKey: string;
  leftNodeId: string;
  rightNodeId: string;
  observedStages: Array<{
    relation: string;
    stage: number;
    firstSeenAt: string;
    confidence: InternalGraphEdge['confidence'];
    edgeId: string;
  }>;
  chronologyGap: boolean;
  gapReasons: string[];
}

export interface InternalRouteTemporalCoherence {
  routeId: string;
  overlapScore: number;
  hasSharedObservationWindow: boolean;
  sharedWindowStart: string | null;
  sharedWindowEnd: string | null;
  nearestGapDays: number;
  reasons: string[];
}

export interface InternalAgenticTimelineReport {
  generatedAt: string;
  graphVersion: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  events: InternalTimelineEvent[];
  episodes: InternalTimelineEpisode[];
  progressions: InternalRelationProgression[];
  chronologyGapCount: number;
  operatingRule: string;
}

const PROGRESSION_STAGE: Record<string, number> = {
  signaled: 1,
  mutual_with: 2,
  office_hours_with: 3,
  outcome_aligned: 4,
  outcome_completed: 5,
};

function safeTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalPair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function timelineEvents(payload: InternalGraphPayload): InternalTimelineEvent[] {
  const result: InternalTimelineEvent[] = [];
  for (const edge of payload.edges) {
    const first = safeTime(edge.firstSeenAt);
    const last = safeTime(edge.lastSeenAt);
    if (first != null) {
      result.push({
        id: `first:${edge.id}`,
        timestamp: new Date(first).toISOString(),
        kind: 'first_observed',
        edgeId: edge.id,
        relation: edge.relation,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        confidence: edge.confidence,
        evidenceCount: edge.evidenceCount,
      });
    }
    if (last != null && first != null && last > first && edge.evidenceCount >= 2) {
      result.push({
        id: `reobserved:${edge.id}`,
        timestamp: new Date(last).toISOString(),
        kind: 'reobserved',
        edgeId: edge.id,
        relation: edge.relation,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        confidence: edge.confidence,
        evidenceCount: edge.evidenceCount,
      });
    }
  }
  return result.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.id.localeCompare(right.id));
}

function buildEpisodes(events: InternalTimelineEvent[], gapDays = 7): InternalTimelineEpisode[] {
  if (events.length === 0) return [];
  const gapMs = gapDays * 86_400_000;
  const groups: InternalTimelineEvent[][] = [];
  let current: InternalTimelineEvent[] = [];
  let previousTime: number | null = null;
  for (const event of events) {
    const time = Date.parse(event.timestamp);
    if (current.length > 0 && previousTime != null && time - previousTime > gapMs) {
      groups.push(current);
      current = [];
    }
    current.push(event);
    previousTime = time;
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => {
    const relations = [...new Set(group.map((event) => event.relation))].sort();
    const verifiedCount = group.filter((event) => event.confidence === 'VERIFIED').length;
    return {
      id: `episode:${index}:${group[0]?.timestamp ?? 'unknown'}`,
      startedAt: group[0]?.timestamp ?? new Date(0).toISOString(),
      endedAt: group[group.length - 1]?.timestamp ?? new Date(0).toISOString(),
      eventCount: group.length,
      relationCount: relations.length,
      relationFamilies: relations,
      verifiedRatio: group.length > 0 ? verifiedCount / group.length : 0,
    };
  });
}

function buildProgressions(payload: InternalGraphPayload): InternalRelationProgression[] {
  const nodeById = new Map(payload.nodes.map((node) => [node.id, node] as const));
  const byPair = new Map<string, InternalGraphEdge[]>();
  for (const edge of payload.edges) {
    if (!(edge.relation in PROGRESSION_STAGE)) continue;
    const left = nodeById.get(edge.source);
    const right = nodeById.get(edge.target);
    if (!left || !right || left.kind !== 'person' || right.kind !== 'person') continue;
    const key = canonicalPair(edge.source, edge.target);
    const rows = byPair.get(key) ?? [];
    rows.push(edge);
    byPair.set(key, rows);
  }

  const result: InternalRelationProgression[] = [];
  for (const [pairKey, edges] of byPair) {
    const stages = edges.flatMap((edge) => {
      const time = safeTime(edge.firstSeenAt);
      if (time == null) return [];
      return [{
        relation: edge.relation,
        stage: PROGRESSION_STAGE[edge.relation] ?? 0,
        firstSeenAt: new Date(time).toISOString(),
        confidence: edge.confidence,
        edgeId: edge.id,
      }];
    }).sort((left, right) => left.stage - right.stage || Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt));
    if (stages.length < 2) continue;

    const gapReasons: string[] = [];
    for (let index = 1; index < stages.length; index += 1) {
      const previous = stages[index - 1];
      const current = stages[index];
      if (Date.parse(current.firstSeenAt) < Date.parse(previous.firstSeenAt)) {
        gapReasons.push(`${current.relation.replaceAll('_', ' ')} was first observed before earlier-stage ${previous.relation.replaceAll('_', ' ')} evidence in the retained graph.`);
      }
    }
    const [leftNodeId, rightNodeId] = pairKey.split('|');
    result.push({
      pairKey,
      leftNodeId,
      rightNodeId,
      observedStages: stages,
      chronologyGap: gapReasons.length > 0,
      gapReasons: gapReasons.length > 0
        ? [...gapReasons, 'This is an observation-order gap, not proof that real-world events occurred out of order; earlier evidence may be missing from Beacon.']
        : [],
    });
  }
  return result.sort((left, right) => Number(right.chronologyGap) - Number(left.chronologyGap) || right.observedStages.length - left.observedStages.length || left.pairKey.localeCompare(right.pairKey));
}

/**
 * Measures whether all edges in one structural route have overlapping retained
 * observation windows. A low score means the path may connect the same entities
 * across different periods; it does NOT mean the relationships were false.
 */
export function analyzeInternalRouteTemporalCoherence(route: InternalTargetRoute): InternalRouteTemporalCoherence {
  if (route.edges.length === 0) {
    return {
      routeId: route.id,
      overlapScore: 0,
      hasSharedObservationWindow: false,
      sharedWindowStart: null,
      sharedWindowEnd: null,
      nearestGapDays: 0,
      reasons: ['No route edges are available for temporal-coherence analysis.'],
    };
  }
  const starts = route.edges.map((edge) => safeTime(edge.firstSeenAt)).filter((value): value is number => value != null);
  const ends = route.edges.map((edge) => safeTime(edge.lastSeenAt)).filter((value): value is number => value != null);
  if (starts.length !== route.edges.length || ends.length !== route.edges.length) {
    return {
      routeId: route.id,
      overlapScore: 0.35,
      hasSharedObservationWindow: false,
      sharedWindowStart: null,
      sharedWindowEnd: null,
      nearestGapDays: 0,
      reasons: ['At least one route edge lacks a parseable observation window; temporal coherence is incomplete.'],
    };
  }
  const sharedStart = Math.max(...starts);
  const sharedEnd = Math.min(...ends);
  if (sharedStart <= sharedEnd) {
    return {
      routeId: route.id,
      overlapScore: 1,
      hasSharedObservationWindow: true,
      sharedWindowStart: new Date(sharedStart).toISOString(),
      sharedWindowEnd: new Date(sharedEnd).toISOString(),
      nearestGapDays: 0,
      reasons: [
        'Every edge in this structural route has at least one overlapping retained observation window.',
        'Temporal overlap supports contemporaneous structural interpretation but does not prove availability, consent, or causation.',
      ],
    };
  }
  const gapDays = Math.max(0, (sharedStart - sharedEnd) / 86_400_000);
  const score = 0.2 + Math.exp(-gapDays / 180) * 0.65;
  return {
    routeId: route.id,
    overlapScore: Math.max(0.2, Math.min(0.85, score)),
    hasSharedObservationWindow: false,
    sharedWindowStart: null,
    sharedWindowEnd: null,
    nearestGapDays: gapDays,
    reasons: [
      `The route's retained edge-observation windows do not all overlap; nearest aggregate gap is about ${Math.round(gapDays)} days.`,
      'The route remains structurally explainable, but a point-in-time interpretation should be treated with caution.',
      'No causal or real-world availability conclusion is inferred from observation timing.',
    ],
  };
}

/**
 * Build a chronological map from retained first-party graph evidence. Sequence is
 * descriptive only: earlier/later observations do not imply causation, intent, or
 * that unobserved real-world events did not occur.
 */
export function buildInternalAgenticTimeline(payload: InternalGraphPayload): InternalAgenticTimelineReport {
  const events = timelineEvents(payload);
  const progressions = buildProgressions(payload);
  return {
    generatedAt: new Date().toISOString(),
    graphVersion: payload.graphVersion,
    firstObservedAt: events[0]?.timestamp ?? null,
    lastObservedAt: events[events.length - 1]?.timestamp ?? null,
    events,
    episodes: buildEpisodes(events),
    progressions,
    chronologyGapCount: progressions.filter((item) => item.chronologyGap).length,
    operatingRule: 'Agentic Timeline orders retained graph observations and tests temporal coherence. Sequence describes Beacon evidence timing only; it never proves causation, intent, or the absence of unobserved real-world events.',
  };
}
