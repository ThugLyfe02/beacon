export type VenueServicePointKind = 'check-in' | 'food' | 'coat-check' | 'restroom' | 'booth' | 'security' | 'other';
export type VenueServicePointState = 'idle' | 'stable' | 'building' | 'congested' | 'recovering';

export interface VenueServicePointInput {
  id: string;
  zoneId: string;
  kind: VenueServicePointKind;
  configuredServers: number;
  observedQueueLength: number;
  previousQueueLength?: number;
  arrivals: number;
  completions: number;
  observationWindowMinutes: number;
  sampleSupport: number;
  confidence: number;
  maxPreferredQueueLength?: number;
}

export interface VenueServicePointMetric {
  id: string;
  zoneId: string;
  kind: VenueServicePointKind;
  state: VenueServicePointState;
  arrivalRatePerMinute: number;
  completionRatePerMinute: number;
  utilizationRatio: number;
  queueGrowthPerMinute: number;
  estimatedWaitMinutes: number | null;
  throughputPerServerPerMinute: number;
  queuePressure: number;
  confidence: number;
  publicEstimateEligible: boolean;
  reasons: string[];
}

export interface VenueServicePointSummary {
  points: VenueServicePointMetric[];
  congestedPointIds: string[];
  meanEstimatedWaitMinutes: number | null;
  totalObservedThroughputPerMinute: number;
  narrative: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Converts aggregate queue observations into throughput and wait estimates for
 * operational service points. The wait estimate uses observed queue length and
 * recent completion throughput; it is intentionally withheld when support or
 * confidence is too weak. No attendee identity or queue trajectory is required.
 */
export function assessVenueServicePoints(inputs: VenueServicePointInput[]): VenueServicePointSummary {
  const points = inputs.map<VenueServicePointMetric>((input) => {
    const windowMinutes = Math.max(0.25, input.observationWindowMinutes);
    const arrivals = Math.max(0, input.arrivals);
    const completions = Math.max(0, input.completions);
    const queueLength = Math.max(0, input.observedQueueLength);
    const previousQueueLength = Math.max(0, input.previousQueueLength ?? queueLength);
    const servers = Math.max(1, Math.floor(input.configuredServers));
    const arrivalRatePerMinute = arrivals / windowMinutes;
    const completionRatePerMinute = completions / windowMinutes;
    const queueGrowthPerMinute = (queueLength - previousQueueLength) / windowMinutes;
    const utilizationRatio = completionRatePerMinute <= 0
      ? (arrivalRatePerMinute > 0 ? 1.5 : 0)
      : arrivalRatePerMinute / completionRatePerMinute;
    const throughputPerServerPerMinute = completionRatePerMinute / servers;
    const preferredQueue = Math.max(1, input.maxPreferredQueueLength ?? servers * 6);
    const queuePressure = clamp01(
      (queueLength / preferredQueue) * 0.55
      + clamp01(Math.max(0, utilizationRatio - 0.8) / 0.7) * 0.3
      + clamp01(Math.max(0, queueGrowthPerMinute) / Math.max(1, arrivalRatePerMinute)) * 0.15,
    );
    const confidence = clamp01(
      input.confidence * 0.55
      + clamp01(input.sampleSupport / 20) * 0.25
      + clamp01(completions / Math.max(4, servers * 2)) * 0.2,
    );
    const estimatedWaitMinutes = completionRatePerMinute > 0.05 && confidence >= 0.58
      ? Math.min(120, queueLength / completionRatePerMinute)
      : null;

    let state: VenueServicePointState = 'stable';
    if (queueLength === 0 && arrivalRatePerMinute < 0.2) state = 'idle';
    else if (queuePressure >= 0.78 || utilizationRatio >= 1.15) state = 'congested';
    else if (queueGrowthPerMinute > 0.2 || utilizationRatio >= 0.95) state = 'building';
    else if (queueGrowthPerMinute < -0.2 && queueLength > 0) state = 'recovering';

    const reasons: string[] = [];
    if (utilizationRatio >= 1.15) reasons.push('observed arrivals materially exceed recent completion throughput');
    if (queueGrowthPerMinute > 0.2) reasons.push('queue length is increasing during the current observation window');
    if (queuePressure >= 0.78) reasons.push('queue pressure is above the preferred operating band');
    if (completionRatePerMinute <= 0.05 && arrivals > 0) reasons.push('recent completion throughput is too low for a defensible wait estimate');
    if (confidence < 0.58) reasons.push('sample support is too weak for a public wait estimate');
    if (reasons.length === 0) reasons.push('arrival, throughput, and queue pressure are within the current operating band');

    return {
      id: input.id,
      zoneId: input.zoneId,
      kind: input.kind,
      state,
      arrivalRatePerMinute,
      completionRatePerMinute,
      utilizationRatio,
      queueGrowthPerMinute,
      estimatedWaitMinutes,
      throughputPerServerPerMinute,
      queuePressure,
      confidence,
      publicEstimateEligible: estimatedWaitMinutes !== null && confidence >= 0.72 && input.sampleSupport >= 8,
      reasons,
    };
  });

  const congestedPointIds = points.filter((point) => point.state === 'congested').map((point) => point.id).sort();
  const waitEstimates = points.map((point) => point.estimatedWaitMinutes).filter((value): value is number => value !== null);
  const meanEstimatedWaitMinutes = waitEstimates.length === 0
    ? null
    : waitEstimates.reduce((sum, value) => sum + value, 0) / waitEstimates.length;
  const totalObservedThroughputPerMinute = points.reduce((sum, point) => sum + point.completionRatePerMinute, 0);

  const narrative = congestedPointIds.length > 0
    ? `${congestedPointIds.length} service point${congestedPointIds.length === 1 ? ' is' : 's are'} operating above the preferred queue band; Beacon can compare staffing, routing, or nearby capacity options without tracking individual queues.`
    : points.length > 0
      ? 'Observed service points are within the current aggregate queue and throughput envelope.'
      : 'No aggregate service-point observations are available.';

  return {
    points,
    congestedPointIds,
    meanEstimatedWaitMinutes,
    totalObservedThroughputPerMinute,
    narrative,
  };
}
