import type { InterventionRecord } from './VenueInterventionLedger';
import { interventionEffectScore } from './VenueInterventionLedger';

export interface VenueOutcomePattern {
  key: string;
  commandId: string;
  targetZoneIds: string[];
  learningContextKey: string | null;
  sampleSize: number;
  meanEffect: number;
  confidence: number;
  positiveRate: number;
}

export interface VenueOutcomeLearningState {
  patterns: VenueOutcomePattern[];
  strongest: VenueOutcomePattern | null;
  minimumSamples: number;
  learningContextKey: string | null;
  excludedContextMismatches: number;
}

export interface VenueOutcomeLearningOptions {
  learningContextKey?: string;
  minimumSamples?: number;
}

const MIN_SAMPLES = 3;

/**
 * Learns only from measured operator interventions. It does not treat a
 * recommendation as success, and it does not infer causal certainty from a
 * single event. When a learning context is supplied, records from any other
 * context are excluded rather than being silently blended into local authority.
 */
export function buildVenueOutcomeLearning(
  records: InterventionRecord[],
  options: VenueOutcomeLearningOptions = {},
): VenueOutcomeLearningState {
  const minimumSamples = Math.max(MIN_SAMPLES, options.minimumSamples ?? MIN_SAMPLES);
  const requestedContext = options.learningContextKey ?? null;
  const measuredAll = records.filter((record) => record.status === 'measured' && record.outcome);
  const measured = requestedContext === null
    ? measuredAll
    : measuredAll.filter((record) => record.learningContextKey === requestedContext);
  const excludedContextMismatches = measuredAll.length - measured.length;
  const groups = new Map<string, InterventionRecord[]>();

  for (const record of measured) {
    const contextKey = record.learningContextKey ?? 'unscoped';
    const key = `${contextKey}|${record.commandId}|${[...record.targetZoneIds].sort().join(',')}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const patterns: VenueOutcomePattern[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < minimumSamples) continue;
    const scores = group
      .map(interventionEffectScore)
      .filter((score): score is number => score !== null);
    if (scores.length < minimumSamples) continue;

    const meanEffect = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const positiveRate = scores.filter((score) => score > 0.08).length / scores.length;
    const confidence = Math.max(0, Math.min(1, 0.45 + Math.min(0.35, scores.length * 0.06) + Math.abs(meanEffect) * 0.2));
    const sample = group[0];

    patterns.push({
      key,
      commandId: sample.commandId,
      targetZoneIds: sample.targetZoneIds,
      learningContextKey: sample.learningContextKey ?? null,
      sampleSize: scores.length,
      meanEffect,
      confidence,
      positiveRate,
    });
  }

  patterns.sort((a, b) => {
    if (a.meanEffect !== b.meanEffect) return b.meanEffect - a.meanEffect;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.key.localeCompare(b.key);
  });

  return {
    patterns,
    strongest: patterns[0] ?? null,
    minimumSamples,
    learningContextKey: requestedContext,
    excludedContextMismatches,
  };
}
