import type { InternalDecisionRetrospectiveRow } from './internalDecisionJournal.service';
import type { InternalGraphEpistemicHealth } from './InternalGraphEpistemicHealthEngine';
import type { InternalAgenticTimelineReport } from './InternalAgenticTimelineEngine';
import type { InternalTargetRoutingPortfolio } from './InternalTargetRoutingEngine';
import type { InternalWatchtowerTriageResult } from './InternalWatchtowerTriageEngine';
import type { InternalDecisionDependencyReport } from './InternalDecisionDependencyEngine';

export type InternalAssumptionFreshness = 'current' | 'review_due' | 'stale';

export interface InternalStaleAssumption {
  journalId: string;
  decisionKind: string;
  freshness: InternalAssumptionFreshness;
  score: number;
  reasons: string[];
  recommendedSurface:
    | 'InternalDecisionJournal'
    | 'InternalAgenticTimeline'
    | 'InternalEvidenceDebt'
    | 'InternalTargetRouting'
    | 'InternalWatchtower'
    | 'InternalEvidenceConflicts';
}

export interface InternalAssumptionStalenessReport {
  generatedAt: string;
  currentCount: number;
  reviewDueCount: number;
  staleCount: number;
  assumptions: InternalStaleAssumption[];
  operatingRule: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function freshness(score: number): InternalAssumptionFreshness {
  if (score >= 0.62) return 'stale';
  if (score >= 0.3) return 'review_due';
  return 'current';
}

/**
 * Detect when an open analytical hypothesis deserves revalidation because the
 * evidence environment materially changed. "Stale" means the old evidence
 * envelope is no longer a safe current baseline; it does NOT mean the hypothesis
 * is false, nor does this engine modify graph evidence or journal outcomes.
 *
 * Conflict-driven staleness is dependency-specific: a conflict may affect a
 * hypothesis only when that hypothesis explicitly recorded one of the conflicted
 * evidence edge ids. Beacon never guesses historical dependencies for old entries.
 */
export function analyzeInternalAssumptionStaleness(input: {
  currentGraphVersion: string;
  retrospectives: InternalDecisionRetrospectiveRow[];
  epistemicHealth: InternalGraphEpistemicHealth;
  timeline: InternalAgenticTimelineReport;
  routingPortfolio?: InternalTargetRoutingPortfolio | null;
  watchtowerTriage?: InternalWatchtowerTriageResult | null;
  decisionDependencies?: InternalDecisionDependencyReport | null;
}): InternalAssumptionStalenessReport {
  const currentRoute = input.routingPortfolio?.routes[0] ?? null;
  const currentRouteDiversity = input.routingPortfolio?.routeDiversity ?? null;
  const currentOpenIncidents = input.watchtowerTriage?.openIncidentCount ?? 0;
  const currentCriticalIncidents = input.watchtowerTriage?.criticalIncidentCount ?? 0;
  const dependencyByJournal = new Map(
    (input.decisionDependencies?.dependencies ?? []).map((dependency) => [dependency.journalId, dependency] as const),
  );

  const assumptions = input.retrospectives
    .filter((row) => row.status === 'open')
    .map<InternalStaleAssumption>((row) => {
      const reasons: string[] = [];
      let score = 0;
      let recommendedSurface: InternalStaleAssumption['recommendedSurface'] = 'InternalDecisionJournal';

      const conflictDependency = dependencyByJournal.get(row.journalId);
      if (conflictDependency) {
        score += Math.min(0.48, 0.2 + conflictDependency.maxReviewPriority * 0.055 + Math.min(0.08, conflictDependency.conflictIds.length * 0.02));
        reasons.push(...conflictDependency.reasons);
        reasons.push('this conflict signal is dependency-specific because the hypothesis explicitly recorded one or more conflicted evidence edge ids');
        recommendedSurface = 'InternalEvidenceConflicts';
      }

      if (row.createdGraphVersion !== input.currentGraphVersion) {
        score += 0.34;
        reasons.push('canonical graph version changed since the hypothesis was sealed');
      }

      const healthDrop = row.createdHealthScore - input.epistemicHealth.score;
      if (healthDrop >= 0.08) {
        score += Math.min(0.25, 0.08 + healthDrop * 0.7);
        reasons.push(`graph epistemic health fell ${Math.round(healthDrop * 100)} points from the decision-time baseline`);
        if (!conflictDependency) recommendedSurface = 'InternalEvidenceDebt';
      }

      const ambiguityRise = input.epistemicHealth.ambiguousEdgeRatio - row.createdAmbiguousRatio;
      if (ambiguityRise >= 0.04) {
        score += Math.min(0.16, 0.05 + ambiguityRise * 0.8);
        reasons.push(`ambiguous-evidence share rose ${Math.round(ambiguityRise * 100)} points`);
        if (!conflictDependency) recommendedSurface = 'InternalEvidenceDebt';
      }

      if (input.timeline.chronologyGapCount > row.createdChronologyGaps) {
        const delta = input.timeline.chronologyGapCount - row.createdChronologyGaps;
        score += Math.min(0.18, 0.06 + delta * 0.025);
        reasons.push(`${delta} new retained chronology gap${delta === 1 ? '' : 's'} appeared since the hypothesis baseline`);
        if (!conflictDependency) recommendedSurface = 'InternalAgenticTimeline';
      }

      if (
        row.createdRouteDiversity != null
        && currentRouteDiversity != null
        && row.decisionKind !== 'analysis_review'
        && row.createdRouteDiversity - currentRouteDiversity >= 0.15
      ) {
        score += Math.min(0.18, 0.06 + (row.createdRouteDiversity - currentRouteDiversity) * 0.4);
        reasons.push(`route diversity fell from ${Math.round(row.createdRouteDiversity * 100)}% to ${Math.round(currentRouteDiversity * 100)}%`);
        if (!conflictDependency) recommendedSurface = 'InternalTargetRouting';
      }

      if (
        row.createdSharedBottlenecks < (input.routingPortfolio?.structuralSinglePointNodeIds.length ?? 0)
        && currentRoute
      ) {
        score += 0.09;
        reasons.push('the current target-route portfolio has more shared structural bottlenecks than the decision-time baseline');
        if (!conflictDependency) recommendedSurface = 'InternalTargetRouting';
      }

      if (currentCriticalIncidents > row.createdCriticalIncidents) {
        score += Math.min(0.2, 0.08 + (currentCriticalIncidents - row.createdCriticalIncidents) * 0.04);
        reasons.push('new critical Watchtower incident pressure exists relative to the decision-time baseline');
        if (!conflictDependency) recommendedSurface = 'InternalWatchtower';
      } else if (currentOpenIncidents - row.createdOpenIncidents >= 3) {
        score += 0.08;
        reasons.push('open Watchtower incident load materially increased since the hypothesis was sealed');
        if (!conflictDependency) recommendedSurface = 'InternalWatchtower';
      }

      const normalized = clamp01(score);
      const state = freshness(normalized);
      if (reasons.length === 0) reasons.push('no material change detected relative to the retained decision-time analytical baseline');
      if (state !== 'current') {
        reasons.push('revalidation is required before treating the old hypothesis as a current analytical baseline; staleness is not invalidation');
      }

      return {
        journalId: row.journalId,
        decisionKind: row.decisionKind,
        freshness: state,
        score: normalized,
        reasons,
        recommendedSurface,
      };
    })
    .sort((left, right) => right.score - left.score || left.journalId.localeCompare(right.journalId));

  return {
    generatedAt: new Date().toISOString(),
    currentCount: assumptions.filter((item) => item.freshness === 'current').length,
    reviewDueCount: assumptions.filter((item) => item.freshness === 'review_due').length,
    staleCount: assumptions.filter((item) => item.freshness === 'stale').length,
    assumptions,
    operatingRule: 'Assumption Staleness flags open hypotheses whose analytical environment changed materially. Conflict-driven revalidation requires explicit decision-edge dependency refs. It never marks a hypothesis false automatically, changes graph evidence, or infers anything about the people represented by the graph.',
  };
}
