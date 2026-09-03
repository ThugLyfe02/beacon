import {
  compareVenueLearningContexts,
  type VenueLearningContext,
  type VenueLearningCompatibility,
} from './VenueLearningContext';

export type VenuePlaybookStatus = 'proven' | 'promising' | 'mixed' | 'avoid' | 'insufficient';

export interface VenueHistoricalMeasurementInput {
  eventId: string;
  commandId: string;
  commandKind: string;
  effectScore: number;
  confidence: number;
  measuredAt: number;
  context: VenueLearningContext;
}

export interface VenueHistoricalCloseoutInput {
  eventId: string;
  closedAt: number;
  measuredInterventionCount: number;
  meanMeasuredEffect: number | null;
  positiveRate: number | null;
  meanMeasurementConfidence: number | null;
  evidenceCoverage: number;
}

export interface VenueCurrentMeasurementInput {
  effectScore: number;
  confidence: number;
}

export interface VenuePlaybookEntry {
  commandId: string;
  commandKind: string;
  status: VenuePlaybookStatus;
  sampleSize: number;
  eventCount: number;
  exactContextSamples: number;
  weightedMeanEffect: number;
  weightedPositiveRate: number;
  meanConfidence: number;
  meanTransferWeight: number;
  evidenceScore: number;
  latestEvidenceAt: number;
  mayInformRanking: boolean;
  mayGrantOperationalAuthority: false;
  explanation: string;
}

export interface VenuePortfolioBenchmark {
  historicalEventCount: number;
  measuredHistoricalEventCount: number;
  historicalMedianEffect: number | null;
  historicalMedianCoverage: number | null;
  currentMeanEffect: number | null;
  currentVsHistoryDelta: number | null;
  recentTrendDelta: number | null;
}

export interface VenuePortfolioMemoryState {
  entries: VenuePlaybookEntry[];
  strongest: VenuePlaybookEntry | null;
  benchmark: VenuePortfolioBenchmark;
  compatibleMeasurementCount: number;
  excludedMeasurementCount: number;
  compatibleEventCount: number;
  minimumSamplesPerEntry: number;
  minimumEventsPerEntry: number;
  narrative: string;
}

const MIN_SAMPLES = 3;
const MIN_EVENTS = 2;
const RECENCY_HALF_LIFE_DAYS = 180;
const DAY_MS = 86_400_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampEffect(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function median(values: number[]): number | null {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (usable.length === 0) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[middle - 1] + usable[middle]) / 2 : usable[middle];
}

function recencyWeight(measuredAt: number, now: number): number {
  const ageDays = Math.max(0, (now - measuredAt) / DAY_MS);
  return Math.max(0.2, Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS));
}

function classifyEntry(input: {
  sampleSize: number;
  eventCount: number;
  meanEffect: number;
  positiveRate: number;
  evidenceScore: number;
}): VenuePlaybookStatus {
  if (input.sampleSize < MIN_SAMPLES || input.eventCount < MIN_EVENTS) return 'insufficient';
  if (input.meanEffect <= -0.08 && input.positiveRate <= 0.4 && input.evidenceScore >= 0.55) return 'avoid';
  if (input.meanEffect >= 0.08 && input.positiveRate >= 0.67 && input.evidenceScore >= 0.66) return 'proven';
  if (input.meanEffect >= 0.04 && input.positiveRate >= 0.58 && input.evidenceScore >= 0.54) return 'promising';
  return 'mixed';
}

function explainEntry(entry: Omit<VenuePlaybookEntry, 'explanation'>): string {
  const effect = `${entry.weightedMeanEffect >= 0 ? '+' : ''}${entry.weightedMeanEffect.toFixed(2)}`;
  const support = `${entry.sampleSize} measured intervention${entry.sampleSize === 1 ? '' : 's'} across ${entry.eventCount} ended event${entry.eventCount === 1 ? '' : 's'}`;
  if (entry.status === 'proven') return `${support} produced a ${effect} weighted before/after effect in compatible venue contexts. Treat this as a strong inspection prior, not automatic authority.`;
  if (entry.status === 'promising') return `${support} is directionally positive (${effect}) but still needs live-event evidence and fresh control admission.`;
  if (entry.status === 'avoid') return `${support} is materially negative (${effect}). Beacon should lower this option in ranking until new measured evidence changes the record.`;
  if (entry.status === 'mixed') return `${support} is inconsistent (${effect}); historical evidence should stay secondary to current telemetry.`;
  return `${support} is not enough to establish a repeatable venue pattern yet.`;
}

interface WeightedSample {
  row: VenueHistoricalMeasurementInput;
  compatibility: VenueLearningCompatibility;
  weight: number;
}

/**
 * Turns a host's own ended-event measurements into a repeat-event playbook.
 * Historical evidence can inform ranking, but it can never make a command
 * action-ready: current telemetry, release pinning, deployment maturity,
 * authorization, and control admission remain mandatory every time.
 *
 * Cross-customer evidence is intentionally absent. The portfolio is a private
 * compounding asset for the host that generated the measured outcomes.
 */
export function buildVenuePortfolioMemory(input: {
  currentContext: VenueLearningContext;
  history: VenueHistoricalMeasurementInput[];
  closeouts: VenueHistoricalCloseoutInput[];
  currentMeasurements?: VenueCurrentMeasurementInput[];
  now?: number;
}): VenuePortfolioMemoryState {
  const now = input.now ?? Date.now();
  const weighted: WeightedSample[] = [];
  let excludedMeasurementCount = 0;

  for (const row of input.history) {
    if (!Number.isFinite(row.effectScore) || !Number.isFinite(row.confidence) || !Number.isFinite(row.measuredAt)) {
      excludedMeasurementCount += 1;
      continue;
    }
    const compatibility = compareVenueLearningContexts(row.context, input.currentContext);
    if (!compatibility.mayInformRanking || compatibility.transferWeight < 0.2) {
      excludedMeasurementCount += 1;
      continue;
    }
    const confidence = clamp01(row.confidence);
    const weight = confidence * compatibility.transferWeight * recencyWeight(row.measuredAt, now);
    if (weight < 0.08) {
      excludedMeasurementCount += 1;
      continue;
    }
    weighted.push({ row, compatibility, weight });
  }

  const byCommand = new Map<string, WeightedSample[]>();
  for (const item of weighted) {
    const key = `${item.row.commandKind}|${item.row.commandId}`;
    byCommand.set(key, [...(byCommand.get(key) ?? []), item]);
  }

  const entries: VenuePlaybookEntry[] = [];
  for (const group of byCommand.values()) {
    const totalWeight = group.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) continue;

    const weightedMeanEffect = group.reduce(
      (sum, item) => sum + clampEffect(item.row.effectScore) * item.weight,
      0,
    ) / totalWeight;
    const weightedPositiveRate = group.reduce(
      (sum, item) => sum + (item.row.effectScore > 0.08 ? item.weight : 0),
      0,
    ) / totalWeight;
    const meanConfidence = group.reduce(
      (sum, item) => sum + clamp01(item.row.confidence) * item.weight,
      0,
    ) / totalWeight;
    const meanTransferWeight = group.reduce(
      (sum, item) => sum + item.compatibility.transferWeight * item.weight,
      0,
    ) / totalWeight;
    const eventCount = new Set(group.map((item) => item.row.eventId)).size;
    const exactContextSamples = group.filter((item) => item.compatibility.transferClass === 'exact').length;
    const supportScore = clamp01((eventCount / 4) * 0.6 + (group.length / 8) * 0.4);
    const consistencyScore = clamp01(Math.abs(weightedPositiveRate - 0.5) * 2);
    const evidenceScore = clamp01(
      supportScore * 0.32
      + meanConfidence * 0.24
      + meanTransferWeight * 0.24
      + consistencyScore * 0.2,
    );
    const status = classifyEntry({
      sampleSize: group.length,
      eventCount,
      meanEffect: weightedMeanEffect,
      positiveRate: weightedPositiveRate,
      evidenceScore,
    });

    const partial: Omit<VenuePlaybookEntry, 'explanation'> = {
      commandId: group[0].row.commandId,
      commandKind: group[0].row.commandKind,
      status,
      sampleSize: group.length,
      eventCount,
      exactContextSamples,
      weightedMeanEffect,
      weightedPositiveRate,
      meanConfidence,
      meanTransferWeight,
      evidenceScore,
      latestEvidenceAt: Math.max(...group.map((item) => item.row.measuredAt)),
      mayInformRanking: status !== 'insufficient' && meanTransferWeight >= 0.5,
      mayGrantOperationalAuthority: false,
    };
    entries.push({ ...partial, explanation: explainEntry(partial) });
  }

  entries.sort((a, b) => {
    const statusWeight: Record<VenuePlaybookStatus, number> = {
      proven: 5,
      promising: 4,
      mixed: 3,
      avoid: 2,
      insufficient: 1,
    };
    if (statusWeight[a.status] !== statusWeight[b.status]) return statusWeight[b.status] - statusWeight[a.status];
    if (a.evidenceScore !== b.evidenceScore) return b.evidenceScore - a.evidenceScore;
    if (a.weightedMeanEffect !== b.weightedMeanEffect) return b.weightedMeanEffect - a.weightedMeanEffect;
    return a.commandId.localeCompare(b.commandId);
  });

  const validCloseouts = input.closeouts.filter((row) => Number.isFinite(row.closedAt));
  const measuredCloseouts = validCloseouts.filter((row) => row.meanMeasuredEffect !== null && row.measuredInterventionCount > 0);
  const historicalMedianEffect = median(measuredCloseouts.map((row) => row.meanMeasuredEffect as number));
  const historicalMedianCoverage = median(validCloseouts.map((row) => clamp01(row.evidenceCoverage)));

  const currentMeasurements = (input.currentMeasurements ?? [])
    .filter((row) => Number.isFinite(row.effectScore) && Number.isFinite(row.confidence) && row.confidence >= 0.45);
  const currentWeight = currentMeasurements.reduce((sum, row) => sum + clamp01(row.confidence), 0);
  const currentMeanEffect = currentWeight <= 0
    ? null
    : currentMeasurements.reduce((sum, row) => sum + clampEffect(row.effectScore) * clamp01(row.confidence), 0) / currentWeight;
  const currentVsHistoryDelta = currentMeanEffect === null || historicalMedianEffect === null
    ? null
    : currentMeanEffect - historicalMedianEffect;

  const byCloseDate = [...measuredCloseouts].sort((a, b) => b.closedAt - a.closedAt);
  const recent = byCloseDate.slice(0, 3).map((row) => row.meanMeasuredEffect as number);
  const prior = byCloseDate.slice(3, 6).map((row) => row.meanMeasuredEffect as number);
  const recentMedian = median(recent);
  const priorMedian = median(prior);
  const recentTrendDelta = recentMedian === null || priorMedian === null ? null : recentMedian - priorMedian;

  const compatibleEventCount = new Set(weighted.map((item) => item.row.eventId)).size;
  const strongest = entries.find((entry) => entry.status === 'proven' || entry.status === 'promising') ?? entries[0] ?? null;
  const narrative = strongest
    ? `${compatibleEventCount} prior event${compatibleEventCount === 1 ? '' : 's'} contain context-compatible measured evidence. ${strongest.commandId} is the strongest historical inspection prior; it still cannot bypass live control admission.`
    : validCloseouts.length > 0
      ? `${validCloseouts.length} prior venue closeout${validCloseouts.length === 1 ? '' : 's'} exist, but compatible measured evidence is not mature enough to form a playbook.`
      : 'No prior ended-event evidence is available for this venue yet. The first measured event establishes the private baseline.';

  return {
    entries,
    strongest,
    benchmark: {
      historicalEventCount: validCloseouts.length,
      measuredHistoricalEventCount: measuredCloseouts.length,
      historicalMedianEffect,
      historicalMedianCoverage,
      currentMeanEffect,
      currentVsHistoryDelta,
      recentTrendDelta,
    },
    compatibleMeasurementCount: weighted.length,
    excludedMeasurementCount,
    compatibleEventCount,
    minimumSamplesPerEntry: MIN_SAMPLES,
    minimumEventsPerEntry: MIN_EVENTS,
    narrative,
  };
}
