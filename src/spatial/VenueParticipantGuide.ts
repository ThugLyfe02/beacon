import type {
  LiveVenueServiceGuidance,
  LiveVenueServiceTrend,
} from '../services/venue-participant-guide.service';

export interface VenueParticipantGuideState {
  services: LiveVenueServiceGuidance[];
  primary: LiveVenueServiceGuidance | null;
  clearCount: number;
  steadyCount: number;
  busyCount: number;
  easingCount: number;
  buildingCount: number;
  newestObservedAt: string | null;
  narrative: string;
}

const WAIT_SCORE: Record<LiveVenueServiceGuidance['wait_band'], number> = {
  '<5 min': 0,
  '5-10 min': 1,
  '10-20 min': 2,
  '20+ min': 3,
  unknown: 4,
};

const STATUS_SCORE: Record<LiveVenueServiceGuidance['status'], number> = {
  clear: 0,
  steady: 1,
  busy: 3,
  unknown: 4,
};

const TREND_SCORE: Record<LiveVenueServiceTrend, number> = {
  easing: 0,
  stable: 1,
  unknown: 2,
  building: 3,
};

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Orders already privacy-gated venue service conditions into a useful attendee
 * summary. This is not a popularity model and does not infer hidden demand.
 * Ranking uses only the coarse status, coarse wait band, coarse direction of
 * change, and confidence the participant-safe RPC already released.
 */
export function buildVenueParticipantGuide(
  input: LiveVenueServiceGuidance[],
): VenueParticipantGuideState {
  const services = [...input]
    .filter((service) => Number.isFinite(service.confidence) && service.confidence >= 0.72)
    .sort((left, right) => {
      const statusDelta = STATUS_SCORE[left.status] - STATUS_SCORE[right.status];
      if (statusDelta !== 0) return statusDelta;
      const waitDelta = WAIT_SCORE[left.wait_band] - WAIT_SCORE[right.wait_band];
      if (waitDelta !== 0) return waitDelta;
      const trendDelta = TREND_SCORE[left.trend] - TREND_SCORE[right.trend];
      if (trendDelta !== 0) return trendDelta;
      if (left.confidence !== right.confidence) return right.confidence - left.confidence;
      return left.service_point_id.localeCompare(right.service_point_id);
    });

  const clearCount = services.filter((service) => service.status === 'clear').length;
  const steadyCount = services.filter((service) => service.status === 'steady').length;
  const busyCount = services.filter((service) => service.status === 'busy').length;
  const easingCount = services.filter((service) => service.trend === 'easing').length;
  const buildingCount = services.filter((service) => service.trend === 'building').length;
  const primary = services.find((service) => service.status === 'clear' || service.status === 'steady') ?? null;

  const newestObservedAt = services.reduce<string | null>((latest, service) => {
    const timestamp = Date.parse(service.observed_at);
    if (!Number.isFinite(timestamp)) return latest;
    if (latest == null) return service.observed_at;
    return timestamp > Date.parse(latest) ? service.observed_at : latest;
  }, null);

  let narrative = 'No participant-safe service guidance is available right now.';
  if (services.length > 0 && primary) {
    const trendCopy = primary.trend === 'easing'
      ? ' and is easing'
      : primary.trend === 'building'
        ? ' but is building'
        : '';
    narrative = `${cleanLabel(primary.service_point_id)} is the clearest currently observed option at ${primary.wait_band}${trendCopy}.`;
    if (busyCount > 0) {
      narrative += ` ${busyCount} other service point${busyCount === 1 ? ' is' : 's are'} currently busy.`;
    }
  } else if (services.length > 0 && busyCount === services.length) {
    narrative = `All ${busyCount} currently observed service point${busyCount === 1 ? ' is' : 's are'} busy. Beacon will update this view as new aggregate evidence arrives.`;
  }

  return {
    services,
    primary,
    clearCount,
    steadyCount,
    busyCount,
    easingCount,
    buildingCount,
    newestObservedAt,
    narrative,
  };
}
