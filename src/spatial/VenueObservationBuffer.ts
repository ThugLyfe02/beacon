import type { VenueObservation } from './VenueObservationContract';

export interface VenueObservationBufferConfig {
  maximumBufferedObservations: number;
  maximumPerSource: number;
  allowedOutOfOrderMs: number;
  maximumObservationAgeMs: number;
  maximumFutureSkewMs: number;
  duplicateWindow: number;
}

export interface VenueObservationBufferSourceState {
  sourceId: string;
  latestObservedAt: number;
  highestSequence: number;
  bufferedCount: number;
  droppedDuplicateCount: number;
  droppedStaleCount: number;
  droppedOverflowCount: number;
}

export interface VenueObservationBufferState {
  buffered: VenueObservation[];
  ready: VenueObservation[];
  watermark: number | null;
  sources: VenueObservationBufferSourceState[];
  acceptedCount: number;
  droppedCount: number;
  reasons: string[];
}

interface SourceAccumulator {
  latestObservedAt: number;
  highestSequence: number;
  buffered: VenueObservation[];
  seenSequences: number[];
  droppedDuplicateCount: number;
  droppedStaleCount: number;
  droppedOverflowCount: number;
}

const DEFAULT_CONFIG: VenueObservationBufferConfig = {
  maximumBufferedObservations: 2_000,
  maximumPerSource: 250,
  allowedOutOfOrderMs: 2_500,
  maximumObservationAgeMs: 120_000,
  maximumFutureSkewMs: 5_000,
  duplicateWindow: 512,
};

function compareObservation(left: VenueObservation, right: VenueObservation): number {
  return left.observedAt - right.observedAt
    || left.sourceId.localeCompare(right.sourceId)
    || left.sequence - right.sequence;
}

function safeConfig(config?: Partial<VenueObservationBufferConfig>): VenueObservationBufferConfig {
  return {
    maximumBufferedObservations: Math.max(100, Math.floor(config?.maximumBufferedObservations ?? DEFAULT_CONFIG.maximumBufferedObservations)),
    maximumPerSource: Math.max(20, Math.floor(config?.maximumPerSource ?? DEFAULT_CONFIG.maximumPerSource)),
    allowedOutOfOrderMs: Math.max(0, Math.floor(config?.allowedOutOfOrderMs ?? DEFAULT_CONFIG.allowedOutOfOrderMs)),
    maximumObservationAgeMs: Math.max(5_000, Math.floor(config?.maximumObservationAgeMs ?? DEFAULT_CONFIG.maximumObservationAgeMs)),
    maximumFutureSkewMs: Math.max(0, Math.floor(config?.maximumFutureSkewMs ?? DEFAULT_CONFIG.maximumFutureSkewMs)),
    duplicateWindow: Math.max(32, Math.floor(config?.duplicateWindow ?? DEFAULT_CONFIG.duplicateWindow)),
  };
}

/**
 * Reorders multi-source venue observations behind a bounded event-time watermark.
 * Real sensing streams arrive late, duplicate packets, and occasionally reorder
 * sequence numbers. Feeding them directly into the twin makes venue state depend
 * on transport timing rather than observation timing.
 *
 * This buffer is deliberately bounded. It drops stale, duplicate, future-skewed,
 * and overflow observations instead of allowing an unhealthy source to create an
 * unbounded memory queue. It is a transport-normalization layer only; it does not
 * increase observation confidence or restore authority to quarantined sensors.
 */
export function bufferVenueObservations(
  observations: VenueObservation[],
  now = Date.now(),
  configInput?: Partial<VenueObservationBufferConfig>,
): VenueObservationBufferState {
  const config = safeConfig(configInput);
  const sourceMap = new Map<string, SourceAccumulator>();
  let acceptedCount = 0;
  let droppedCount = 0;
  const reasons: string[] = [];

  const orderedInput = [...observations].sort((left, right) =>
    left.receivedAt - right.receivedAt
      || left.sourceId.localeCompare(right.sourceId)
      || left.sequence - right.sequence,
  );

  for (const observation of orderedInput) {
    let source = sourceMap.get(observation.sourceId);
    if (!source) {
      source = {
        latestObservedAt: Number.NEGATIVE_INFINITY,
        highestSequence: -1,
        buffered: [],
        seenSequences: [],
        droppedDuplicateCount: 0,
        droppedStaleCount: 0,
        droppedOverflowCount: 0,
      };
      sourceMap.set(observation.sourceId, source);
    }

    const ageMs = now - observation.observedAt;
    if (ageMs > config.maximumObservationAgeMs || observation.observedAt > now + config.maximumFutureSkewMs) {
      source.droppedStaleCount += 1;
      droppedCount += 1;
      continue;
    }

    if (source.seenSequences.includes(observation.sequence)) {
      source.droppedDuplicateCount += 1;
      droppedCount += 1;
      continue;
    }

    source.seenSequences.push(observation.sequence);
    if (source.seenSequences.length > config.duplicateWindow) {
      source.seenSequences.splice(0, source.seenSequences.length - config.duplicateWindow);
    }

    source.latestObservedAt = Math.max(source.latestObservedAt, observation.observedAt);
    source.highestSequence = Math.max(source.highestSequence, observation.sequence);
    source.buffered.push(observation);
    source.buffered.sort(compareObservation);
    acceptedCount += 1;

    if (source.buffered.length > config.maximumPerSource) {
      const overflow = source.buffered.length - config.maximumPerSource;
      source.buffered.splice(0, overflow);
      source.droppedOverflowCount += overflow;
      droppedCount += overflow;
      acceptedCount -= overflow;
    }
  }

  const finiteLatestTimes = [...sourceMap.values()]
    .map((source) => source.latestObservedAt)
    .filter(Number.isFinite);
  const watermark = finiteLatestTimes.length === 0
    ? null
    : Math.min(...finiteLatestTimes) - config.allowedOutOfOrderMs;

  const ready: VenueObservation[] = [];
  const buffered: VenueObservation[] = [];
  for (const source of sourceMap.values()) {
    for (const observation of source.buffered) {
      if (watermark !== null && observation.observedAt <= watermark) ready.push(observation);
      else buffered.push(observation);
    }
  }

  ready.sort(compareObservation);
  buffered.sort(compareObservation);

  if (buffered.length > config.maximumBufferedObservations) {
    const keep = buffered.slice(-config.maximumBufferedObservations);
    const dropped = buffered.length - keep.length;
    droppedCount += dropped;
    acceptedCount -= dropped;
    buffered.splice(0, buffered.length, ...keep);
    reasons.push(`${dropped} buffered observation${dropped === 1 ? ' was' : 's were'} dropped to preserve the global memory bound`);
  }

  const sources = [...sourceMap.entries()].map<VenueObservationBufferSourceState>(([sourceId, source]) => ({
    sourceId,
    latestObservedAt: Number.isFinite(source.latestObservedAt) ? source.latestObservedAt : 0,
    highestSequence: source.highestSequence,
    bufferedCount: source.buffered.length,
    droppedDuplicateCount: source.droppedDuplicateCount,
    droppedStaleCount: source.droppedStaleCount,
    droppedOverflowCount: source.droppedOverflowCount,
  })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const duplicateDrops = sources.reduce((sum, source) => sum + source.droppedDuplicateCount, 0);
  const staleDrops = sources.reduce((sum, source) => sum + source.droppedStaleCount, 0);
  const sourceOverflowDrops = sources.reduce((sum, source) => sum + source.droppedOverflowCount, 0);
  if (duplicateDrops > 0) reasons.push(`${duplicateDrops} duplicate observation${duplicateDrops === 1 ? ' was' : 's were'} suppressed by source sequence`);
  if (staleDrops > 0) reasons.push(`${staleDrops} stale or materially future-skewed observation${staleDrops === 1 ? ' was' : 's were'} rejected`);
  if (sourceOverflowDrops > 0) reasons.push(`${sourceOverflowDrops} per-source overflow observation${sourceOverflowDrops === 1 ? ' was' : 's were'} dropped`);
  if (reasons.length === 0) reasons.push('observation streams fit within the configured lateness, duplicate, and memory bounds');

  return {
    buffered,
    ready,
    watermark,
    sources,
    acceptedCount: Math.max(0, acceptedCount),
    droppedCount,
    reasons,
  };
}
