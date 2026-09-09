import {
  runInternalGraphAgentOrchestrator,
  type InternalAgentMission,
  type InternalAgentRun,
  type InternalBridgePattern,
} from './InternalGraphStrategyEngine';
import type { InternalGraphPayload } from './InternalGraphEngine';
import {
  analyzeInternalGraphEpistemicHealth,
  type InternalGraphEpistemicHealth,
} from './InternalGraphEpistemicHealthEngine';
import {
  buildInternalTargetRoutingPortfolio,
  type InternalTargetRoutingPortfolio,
} from './InternalTargetRoutingEngine';

export type InternalAdaptiveDecisionPosture =
  | 'evidence_strong'
  | 'review_before_action'
  | 'evidence_fragile'
  | 'evidence_degraded';

export interface InternalAdaptiveAgentRun extends InternalAgentRun {
  epistemicHealth: InternalGraphEpistemicHealth;
  routingPortfolio: InternalTargetRoutingPortfolio | null;
  decisionPosture: InternalAdaptiveDecisionPosture;
  confidenceMultiplier: number;
  replacedLegacyPathfinder: boolean;
  operatingPrinciples: string[];
}

function confidenceMultiplier(health: InternalGraphEpistemicHealth): number {
  if (health.band === 'strong') return 1;
  if (health.band === 'usable') return 0.88;
  if (health.band === 'fragile') return 0.66;
  return 0.48;
}

function decisionPosture(health: InternalGraphEpistemicHealth): InternalAdaptiveDecisionPosture {
  if (health.band === 'strong') return 'evidence_strong';
  if (health.band === 'usable') return 'review_before_action';
  if (health.band === 'fragile') return 'evidence_fragile';
  return 'evidence_degraded';
}

function adaptivePathfinderMission(input: {
  portfolio: InternalTargetRoutingPortfolio;
  payload: InternalGraphPayload;
  targetQuery: string;
  confidence: number;
}): InternalAgentMission | null {
  const best = input.portfolio.routes[0];
  if (!best) return null;
  const nodeById = new Map(input.payload.nodes.map((node) => [node.id, node] as const));
  const sharedBottlenecks = input.portfolio.structuralSinglePointNodeIds;
  const confidenceFloor = best.confidenceFloor.toLowerCase();
  const routeDiversity = Math.round(input.portfolio.routeDiversity * 100);
  const priority = Math.max(
    1,
    (8 + Math.min(4, best.score) + input.portfolio.routeDiversity * 2) * input.confidence,
  );

  return {
    id: `adaptive-pathfinder:${input.portfolio.sourceNodeId}:${best.targetNodeId}`,
    agent: 'Pathfinder',
    priority,
    title: `Diversified route intelligence: ${input.targetQuery}`,
    thesis: `${input.portfolio.routes.length} ranked route${input.portfolio.routes.length === 1 ? '' : 's'} reach ${best.targetLabel}; the best route has a ${confidenceFloor} confidence floor and the portfolio is ${routeDiversity}% structurally diverse.`,
    evidence: [
      `best route: ${best.nodeIds.map((id) => nodeById.get(id)?.label ?? id).join(' → ')}`,
      `${Math.round(best.verifiedEdgeRatio * 100)}% verified edges · ${Math.round(best.freshness * 100)}% freshness · ${best.hopCount} hops`,
      `${best.articulationExposure} articulation exposure · ${best.graphBridgeExposure} graph-bridge exposure`,
      `${input.portfolio.candidatePathCount} candidate paths evaluated; ${input.portfolio.routes.length} diversity-selected`,
      ...(sharedBottlenecks.length > 0
        ? [`${sharedBottlenecks.length} shared structural single-point bottleneck${sharedBottlenecks.length === 1 ? '' : 's'} across alternatives`]
        : ['no shared interior single-point bottleneck across selected alternatives']),
      ...best.warnings.map((warning) => `route warning: ${warning}`),
    ],
    nodeIds: [...new Set(best.nodeIds.concat(sharedBottlenecks))],
    recommendedAction: 'Inspect route evidence, bottleneck dependence and current consent/context before deciding whether any human-mediated introduction or outreach is appropriate.',
    autonomy: 'analysis_only',
    requiresHumanApproval: true,
  };
}

function epistemicSentinelMission(health: InternalGraphEpistemicHealth): InternalAgentMission | null {
  if (health.band === 'strong' || health.band === 'usable') return null;
  const degraded = health.band === 'degraded';
  return {
    id: `sentinel:epistemic-health:${health.graphVersion}`,
    agent: 'Sentinel',
    priority: degraded ? 15 : 12,
    title: degraded ? 'Graph evidence is degraded' : 'Graph evidence is fragile',
    thesis: `Constellation epistemic health is ${health.band.toUpperCase()} at ${Math.round(health.score * 100)}%; strategic conclusions should be down-weighted until evidence quality improves.`,
    evidence: [
      `${Math.round(health.verifiedEdgeRatio * 100)}% verified · ${Math.round(health.ambiguousEdgeRatio * 100)}% ambiguous`,
      `${Math.round(health.freshEdgeRatio * 100)}% fresh · ${Math.round(health.staleEdgeRatio * 100)}% stale`,
      `${Math.round(health.repeatedEvidenceRatio * 100)}% repeated evidence`,
      ...health.warnings.slice(0, 5),
    ],
    nodeIds: [],
    recommendedAction: degraded
      ? 'Pause high-consequence graph-driven decisions. Refresh stale evidence, resolve ambiguous edges and canonicalize fragmented context before relying on topology.'
      : 'Require manual evidence review for high-consequence conclusions and prioritize graph-quality remediation before intervention.',
    autonomy: 'analysis_only',
    requiresHumanApproval: true,
  };
}

/**
 * Adaptive orchestration composes existing deterministic mission generation with
 * graph-wide epistemic health and diversified, block-safe target routing.
 *
 * It intentionally changes analytical confidence, not human value. A weak graph
 * lowers the authority of every non-safety mission instead of lowering a person,
 * organization, community or target score.
 */
export function runAdaptiveInternalGraphAgentOrchestrator(input: {
  current: InternalGraphPayload;
  previous?: InternalGraphPayload | null;
  patterns?: InternalBridgePattern[];
  suppressions?: ReadonlySet<string>;
  targetQuery?: string | null;
  sourceNodeId?: string | null;
}): InternalAdaptiveAgentRun {
  const {
    current,
    previous = null,
    patterns = [],
    suppressions = new Set<string>(),
    targetQuery = null,
    sourceNodeId = null,
  } = input;

  const baseline = runInternalGraphAgentOrchestrator({
    current,
    previous,
    patterns,
    suppressions,
    targetQuery,
    sourceNodeId,
  });
  const epistemicHealth = analyzeInternalGraphEpistemicHealth(current);
  const multiplier = confidenceMultiplier(epistemicHealth);
  const normalizedTarget = targetQuery?.trim() || null;
  const routingPortfolio = normalizedTarget && sourceNodeId
    ? buildInternalTargetRoutingPortfolio({
        payload: current,
        sourceNodeId,
        targetQuery: normalizedTarget,
        patterns,
        suppressions,
        maxRoutes: 8,
        maxHops: 6,
      })
    : null;

  const missions = baseline.missions
    .filter((mission) => mission.agent !== 'Pathfinder')
    .map((mission) => ({
      ...mission,
      priority: mission.agent === 'Sentinel'
        ? mission.priority
        : Math.max(1, mission.priority * multiplier),
      evidence: mission.agent === 'Sentinel'
        ? mission.evidence
        : [...mission.evidence, `epistemic confidence multiplier ${multiplier.toFixed(2)} (${epistemicHealth.band})`],
    }));

  const pathfinder = routingPortfolio && normalizedTarget
    ? adaptivePathfinderMission({
        portfolio: routingPortfolio,
        payload: current,
        targetQuery: normalizedTarget,
        confidence: multiplier,
      })
    : null;
  if (pathfinder) missions.push(pathfinder);

  const healthMission = epistemicSentinelMission(epistemicHealth);
  if (healthMission) missions.push(healthMission);

  missions.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

  return {
    ...baseline,
    missionCount: missions.length,
    missions,
    epistemicHealth,
    routingPortfolio,
    decisionPosture: decisionPosture(epistemicHealth),
    confidenceMultiplier: multiplier,
    replacedLegacyPathfinder: Boolean(routingPortfolio),
    operatingRule: 'Adaptive agents detect, rank, route and self-calibrate against graph evidence quality. Weak evidence reduces analytical authority; it never reduces a human score. Agents do not message users, create introductions, bypass blocks, or mutate relationships without explicit operator approval.',
    operatingPrinciples: [
      'Graph evidence quality gates analytical confidence.',
      'Target routing uses diverse alternatives, not one cheapest path.',
      'Authoritative block suppressions remain binding during route enumeration.',
      'Historical bridge evidence is observational and may rank routes but cannot authorize action.',
      'Fragile or degraded epistemic health raises a Sentinel remediation mission.',
      'Every social or relationship intervention remains human-approved.',
    ],
  };
}
