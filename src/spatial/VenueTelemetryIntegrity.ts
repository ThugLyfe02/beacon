import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type TelemetryIntegrityLevel = 'good' | 'degraded' | 'unsafe';

export interface TelemetrySourceHealth {
  sourceId: string;
  observedAt: number;
  receivedAt: number;
  sequence?: number;
  previousSequence?: number;
  confidence: number;
}

export interface VenueTelemetryIntegrity {
  level: TelemetryIntegrityLevel;
  score: number;
  maxSkewMs: number;
  staleSourceCount: number;
  sequenceGapCount: number;
  lowConfidenceSourceCount: number;
  reasons: string[];
}

const MAX_GOOD_SKEW_MS = 3_000;
const MAX_ALLOWED_SKEW_MS = 12_000;
const STALE_SOURCE_MS = 20_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Validates temporal coherence before venue data is allowed to drive operational
 * recommendations. Indoor sensing pipelines often merge several clocks and
 * transports; a coherent twin must therefore treat time alignment, freshness,
 * sequence continuity and source confidence as first-class evidence.
 */
export function assessVenueTelemetryIntegrity(
  snapshot: VenueTwinSnapshot,
  sources: TelemetrySourceHealth[],
  now = Date.now(),
): VenueTelemetryIntegrity {
  if (sources.length === 0) {
    return {
      level: 'unsafe',
      score: 0,
      maxSkewMs: 0,
      staleSourceCount: 0,
      sequenceGapCount: 0,
      lowConfidenceSourceCount: 0,
      reasons: ['No telemetry sources are available to support the venue snapshot.'],
    };
  }

  const observedTimes = sources.map((source) => source.observedAt);
  const maxSkewMs = Math.max(...observedTimes) - Math.min(...observedTimes);
  const staleSourceCount = sources.filter((source) => now - source.observedAt > STALE_SOURCE_MS).length;
  const sequenceGapCount = sources.filter((source) =>
    source.sequence !== undefined
      && source.previousSequence !== undefined
      && source.sequence > source.previousSequence + 1,
  ).length;
  const lowConfidenceSourceCount = sources.filter((source) => source.confidence < 0.55).length;
  const transportDelayPenalty = sources.reduce((sum, source) => {
    const delay = Math.max(0, source.receivedAt - source.observedAt);
    return sum + clamp01(delay / 15_000);
  }, 0) / sources.length;

  const skewPenalty = maxSkewMs <= MAX_GOOD_SKEW_MS
    ? 0
    : clamp01((maxSkewMs - MAX_GOOD_SKEW_MS) / (MAX_ALLOWED_SKEW_MS - MAX_GOOD_SKEW_MS));
  const stalePenalty = staleSourceCount / sources.length;
  const gapPenalty = sequenceGapCount / sources.length;
  const confidencePenalty = lowConfidenceSourceCount / sources.length;
  const twinPenalty = 1 - clamp01(snapshot.overallConfidence);

  const score = clamp01(
    1
      - skewPenalty * 0.28
      - stalePenalty * 0.26
      - gapPenalty * 0.14
      - confidencePenalty * 0.14
      - transportDelayPenalty * 0.08
      - twinPenalty * 0.1,
  );

  const reasons: string[] = [];
  if (maxSkewMs > MAX_GOOD_SKEW_MS) reasons.push(`Telemetry clocks differ by ${Math.round(maxSkewMs / 1000)}s.`);
  if (staleSourceCount > 0) reasons.push(`${staleSourceCount} telemetry source${staleSourceCount === 1 ? ' is' : 's are'} stale.`);
  if (sequenceGapCount > 0) reasons.push(`${sequenceGapCount} source stream${sequenceGapCount === 1 ? ' has' : 's have'} sequence gaps.`);
  if (lowConfidenceSourceCount > 0) reasons.push(`${lowConfidenceSourceCount} source${lowConfidenceSourceCount === 1 ? ' is' : 's are'} below the confidence floor.`);
  if (reasons.length === 0) reasons.push('Telemetry streams are temporally coherent and support operational use.');

  const level: TelemetryIntegrityLevel = score >= 0.82 && maxSkewMs <= MAX_GOOD_SKEW_MS
    ? 'good'
    : score >= 0.58 && maxSkewMs <= MAX_ALLOWED_SKEW_MS
      ? 'degraded'
      : 'unsafe';

  return { level, score, maxSkewMs, staleSourceCount, sequenceGapCount, lowConfidenceSourceCount, reasons };
}
