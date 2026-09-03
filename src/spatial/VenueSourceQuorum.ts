import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

export type QuorumState = 'healthy' | 'degraded' | 'lost';

export interface VenueSourceVote {
  sourceId: string;
  sourceKind: 'ble' | 'wifi' | 'camera' | 'manual' | 'edge' | 'other';
  observedAt: number;
  confidence: number;
  healthy: boolean;
  zoneCoverage: number;
}

export interface VenueSourceQuorumState {
  state: QuorumState;
  agreeingSources: number;
  requiredSources: number;
  coverage: number;
  confidence: number;
  dissentingSourceIds: string[];
  reason: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Requires a minimum healthy sensing quorum before a venue snapshot is allowed
 * to carry strong operational authority. This is intentionally source-agnostic:
 * BLE, Wi-Fi, camera, manual, or edge inputs can participate without any one
 * hardware vendor becoming a single point of truth.
 */
export function evaluateVenueSourceQuorum(
  twin: VenueTwinSnapshot,
  sources: VenueSourceVote[],
  requiredSources = 2,
  minimumSourceConfidence = 0.55,
): VenueSourceQuorumState {
  const usable = sources.filter((source) => source.healthy && source.confidence >= minimumSourceConfidence);
  const coverage = sources.length === 0 ? 0 : sources.reduce((sum, source) => sum + clamp01(source.zoneCoverage), 0) / sources.length;
  const sourceConfidence = usable.length === 0 ? 0 : usable.reduce((sum, source) => sum + source.confidence, 0) / usable.length;
  const confidence = clamp01(sourceConfidence * 0.6 + twin.overallConfidence * 0.4);
  const dissentingSourceIds = sources
    .filter((source) => !source.healthy || source.confidence < minimumSourceConfidence)
    .map((source) => source.sourceId)
    .sort();

  if (usable.length < Math.max(1, requiredSources - 1) || confidence < 0.42) {
    return {
      state: 'lost',
      agreeingSources: usable.length,
      requiredSources,
      coverage,
      confidence,
      dissentingSourceIds,
      reason: 'The venue does not currently have enough independent healthy sensing support for control-grade conclusions.',
    };
  }

  if (usable.length < requiredSources || confidence < 0.68 || coverage < 0.55) {
    return {
      state: 'degraded',
      agreeingSources: usable.length,
      requiredSources,
      coverage,
      confidence,
      dissentingSourceIds,
      reason: 'The venue remains observable, but cross-source support is incomplete and should reduce recommendation authority.',
    };
  }

  return {
    state: 'healthy',
    agreeingSources: usable.length,
    requiredSources,
    coverage,
    confidence,
    dissentingSourceIds,
    reason: 'Independent sensing sources provide enough healthy support for aggregate venue state.',
  };
}
