import type { InterventionRecord } from './VenueInterventionLedger';
import { interventionEffectScore } from './VenueInterventionLedger';

export interface RecommendationReliability {
  commandId: string;
  measuredCount: number;
  positiveCount: number;
  revertedCount: number;
  meanEffect: number;
  reliability: number;
  status: 'insufficient-data' | 'weak' | 'mixed' | 'reliable';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildRecommendationReliability(records: InterventionRecord[]): RecommendationReliability[] {
  const grouped = new Map<string, InterventionRecord[]>();
  for (const record of records) grouped.set(record.commandId, [...(grouped.get(record.commandId) ?? []), record]);

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

    output.push({ commandId, measuredCount: scores.length, positiveCount, revertedCount, meanEffect, reliability, status });
  }

  return output.sort((a, b) => b.reliability - a.reliability || b.measuredCount - a.measuredCount || a.commandId.localeCompare(b.commandId));
}
