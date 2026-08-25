import type { InterventionRecord } from './VenueInterventionLedger';
import { interventionEffectScore } from './VenueInterventionLedger';

export interface RecommendationReliability {
  commandId: string;
  learningContextKey: string | null;
  measuredCount: number;
  positiveCount: number;
  revertedCount: number;
  meanEffect: number;
  reliability: number;
  status: 'insufficient-data' | 'weak' | 'mixed' | 'reliable';
}

export interface RecommendationReliabilityOptions {
  learningContextKey?: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Reliability can be evaluated globally for diagnostics or scoped to one venue
 * learning context for deployment authority. Supplying a context excludes other
 * contexts instead of allowing evidence from a different floorplan/event regime
 * to inflate a command's local reliability.
 */
export function buildRecommendationReliability(
  records: InterventionRecord[],
  options: RecommendationReliabilityOptions = {},
): RecommendationReliability[] {
  const requestedContext = options.learningContextKey ?? null;
  const eligible = requestedContext === null
    ? records
    : records.filter((record) => record.learningContextKey === requestedContext);
  const grouped = new Map<string, InterventionRecord[]>();
  for (const record of eligible) grouped.set(record.commandId, [...(grouped.get(record.commandId) ?? []), record]);

  const output: RecommendationReliability[] = [];
  for (const [commandId, group] of grouped) {
    const measured = group.filter((record) => record.status === 'measured' && record.outcome);
    const revertedCount = group.filter((record) => record.status === 'reverted').length;
    const scores = measured.map(interventionEffectScore).filter((score): score is number => score !== null);
    const meanEffect = scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const positiveCount = scores.filter((score) => score > 0.08).length;
    const positiveRate = scores.length === 0 ? 0 : positiveCount / scores.length;
    const revertPenalty = group.length === 0 ? 0 : revertedCount / group.length;
    const sampleWeight = Math.min(1, scores.length / 8);
    const reliability = clamp01(sampleWeight * (positiveRate * 0.65 + clamp01((meanEffect + 1) / 2) * 0.35) * (1 - revertPenalty * 0.5));

    let status: RecommendationReliability['status'] = 'insufficient-data';
    if (scores.length >= 3) {
      if (reliability >= 0.72) status = 'reliable';
      else if (reliability >= 0.48) status = 'mixed';
      else status = 'weak';
    }

    output.push({
      commandId,
      learningContextKey: requestedContext,
      measuredCount: scores.length,
      positiveCount,
      revertedCount,
      meanEffect,
      reliability,
      status,
    });
  }

  return output.sort((a, b) => b.reliability - a.reliability || b.measuredCount - a.measuredCount || a.commandId.localeCompare(b.commandId));
}
