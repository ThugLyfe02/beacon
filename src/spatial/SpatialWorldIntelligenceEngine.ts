import type { PresenceState, ProximitySignal } from '../presence/PresenceEngine';
import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';

export type CardinalSector = 'north' | 'east' | 'south' | 'west' | 'unknown';
export type TrustBand = 'verified' | 'stable' | 'uncertain' | 'degraded';
export type StoryPhase = 'awakening' | 'forming' | 'alive' | 'resolving' | 'afterglow';

export interface VenueMemorySnapshot {
  venueKey: string;
  sampleSize: number;
  medianFirstMutualMinute: number | null;
  officeHoursConversionRate: number | null;
  coldSignalConversionRate: number | null;
  peakSector: CardinalSector;
  peakMinuteOfDay: number | null;
  confidence: number;
}

export interface SocialCluster {
  id: string;
  sector: CardinalSector;
  memberCount: number;
  averageDistanceFeet: number;
  momentum: number;
  confidence: number;
  mergingWith?: string;
}

export interface OpportunityForecast {
  sector: CardinalSector;
  directionLabel: string;
  confidence: number;
  horizonMinutes: number;
  basis: string;
}

export interface TrustFieldState {
  band: TrustBand;
  confidence: number;
  geometryClarity: number;
  routeBrightness: number;
  motionCalm: number;
  detailMultiplier: number;
  explanation: string;
}

export interface EnvironmentalStoryState {
  phase: StoryPhase;
  lightActivation: number;
  pathEnergy: number;
  skylineActivity: number;
  ambientCalm: number;
  shutdownProgress: number;
  narrative: string;
}

export interface WorldMemoryInsight {
  title: string;
  detail: string;
  confidence: number;
  evidenceCount: number;
}

export interface SpatialWorldIntelligence {
  memoryInsights: WorldMemoryInsight[];
  story: EnvironmentalStoryState;
  clusters: SocialCluster[];
  forecast: OpportunityForecast | null;
  trust: TrustFieldState;
  activeSectorCount: number;
}

export interface SpatialWorldIntelligenceInput {
  presence: PresenceState;
  runtime: RuntimeReliabilitySnapshot;
  eventStartsAt: string;
  eventEndsAt: string;
  mutualMatches: number;
  completedOutcomes?: number;
  venueMemory?: VenueMemorySnapshot | null;
  now?: number;
}

const SECTOR_ORDER: CardinalSector[] = ['north', 'east', 'south', 'west'];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sectorForBearing(bearing?: number): CardinalSector {
  if (bearing == null || !Number.isFinite(bearing)) return 'unknown';
  const normalized = ((bearing % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return 'north';
  if (normalized < 135) return 'east';
  if (normalized < 225) return 'south';
  return 'west';
}

function signalFreshness(signal: ProximitySignal, now: number): number {
  if (!signal.timestamp) return 0.55;
  const ageMs = Math.max(0, now - signal.timestamp);
  return clamp01(1 - ageMs / 90_000);
}

function buildTrust(
  presence: PresenceState,
  runtime: RuntimeReliabilitySnapshot,
  now: number,
): TrustFieldState {
  const visible = presence.visibleTargets;
  const freshness = visible.length === 0
    ? 0.5
    : visible.reduce((sum, signal) => sum + signalFreshness(signal, now), 0) / visible.length;
  const bearingCoverage = visible.length === 0
    ? 0
    : visible.filter((signal) => Number.isFinite(signal.bearingFromObserverDeg)).length / visible.length;
  const runtimeWeight = runtime.health === 'healthy'
    ? 1
    : runtime.health === 'degraded'
      ? 0.66
      : runtime.health === 'paused'
        ? 0.42
        : 0.24;
  const confidence = clamp01(runtimeWeight * 0.55 + freshness * 0.3 + bearingCoverage * 0.15);
  const band: TrustBand = confidence >= 0.84
    ? 'verified'
    : confidence >= 0.64
      ? 'stable'
      : confidence >= 0.4
        ? 'uncertain'
        : 'degraded';

  return {
    band,
    confidence,
    geometryClarity: 0.35 + confidence * 0.65,
    routeBrightness: 0.25 + confidence * 0.75,
    motionCalm: 0.35 + confidence * 0.65,
    detailMultiplier: 0.3 + confidence * 0.7,
    explanation: band === 'verified'
      ? 'Live field geometry is backed by fresh, reliable presence signals.'
      : band === 'stable'
        ? 'The field is stable, with minor uncertainty in direction or freshness.'
        : band === 'uncertain'
          ? 'Beacon is reducing visual certainty while live signals settle.'
          : 'The field is intentionally simplified until reliable presence returns.',
  };
}

function buildClusters(signals: ProximitySignal[], now: number): SocialCluster[] {
  const grouped = new Map<CardinalSector, ProximitySignal[]>();
  for (const signal of signals) {
    const sector = sectorForBearing(signal.bearingFromObserverDeg);
    if (sector === 'unknown') continue;
    const current = grouped.get(sector) ?? [];
    current.push(signal);
    grouped.set(sector, current);
  }

  const clusters = SECTOR_ORDER.flatMap((sector) => {
    const members = grouped.get(sector) ?? [];
    if (members.length < 2) return [];
    const averageDistanceFeet = members.reduce((sum, item) => sum + item.distanceFeet, 0) / members.length;
    const averageFreshness = members.reduce((sum, item) => sum + signalFreshness(item, now), 0) / members.length;
    const closeRatio = members.filter((item) => item.distanceFeet <= 20).length / members.length;
    const momentum = clamp01(members.length / 8 * 0.45 + closeRatio * 0.35 + averageFreshness * 0.2);
    const confidence = clamp01(0.45 + Math.min(members.length, 6) * 0.07 + averageFreshness * 0.13);
    return [{
      id: `cluster-${sector}`,
      sector,
      memberCount: members.length,
      averageDistanceFeet,
      momentum,
      confidence,
    }];
  });

  for (let index = 0; index < clusters.length; index += 1) {
    const current = clusters[index];
    const next = clusters[(index + 1) % clusters.length];
    if (!next || current === next) continue;
    const distanceGap = Math.abs(current.averageDistanceFeet - next.averageDistanceFeet);
    if (distanceGap <= 8 && current.momentum + next.momentum >= 1.15) {
      current.mergingWith = next.id;
    }
  }

  return clusters.sort((left, right) => right.momentum - left.momentum);
}

function buildForecast(
  clusters: SocialCluster[],
  memory: VenueMemorySnapshot | null | undefined,
): OpportunityForecast | null {
  const strongest = clusters[0];
  if (!strongest && (!memory || memory.confidence < 0.55 || memory.peakSector === 'unknown')) return null;

  const liveSector = strongest?.sector ?? memory!.peakSector;
  const liveStrength = strongest?.momentum ?? 0;
  const memoryAgreement = memory?.peakSector === liveSector ? memory.confidence : 0;
  const confidence = clamp01(liveStrength * 0.68 + memoryAgreement * 0.32);
  if (confidence < 0.42) return null;

  return {
    sector: liveSector,
    directionLabel: liveSector === 'north' ? 'north side'
      : liveSector === 'east' ? 'east side'
        : liveSector === 'south' ? 'south side'
          : 'west side',
    confidence,
    horizonMinutes: confidence > 0.76 ? 4 : 7,
    basis: memoryAgreement > 0.5
      ? 'Live cluster momentum agrees with this venue’s historical pattern.'
      : 'Fresh aggregate movement indicates that opportunity density is building there.',
  };
}

function buildStory(
  input: SpatialWorldIntelligenceInput,
  trust: TrustFieldState,
): EnvironmentalStoryState {
  const now = input.now ?? Date.now();
  const startsAt = Date.parse(input.eventStartsAt);
  const endsAt = Date.parse(input.eventEndsAt);
  const duration = Math.max(1, endsAt - startsAt);
  const elapsed = clamp01((now - startsAt) / duration);
  const postEventElapsed = now > endsAt ? clamp01((now - endsAt) / (20 * 60_000)) : 0;
  const densityEnergy = clamp01(input.presence.density / 16);
  const outcomeCalm = clamp01((input.completedOutcomes ?? input.mutualMatches) / 6);

  let phase: StoryPhase = 'forming';
  if (now < startsAt + 12 * 60_000) phase = 'awakening';
  else if (now >= endsAt) phase = 'afterglow';
  else if (elapsed > 0.78) phase = 'resolving';
  else if (densityEnergy > 0.45 || input.presence.momentumScore > 25) phase = 'alive';

  return {
    phase,
    lightActivation: clamp01(0.12 + densityEnergy * 0.62 + elapsed * 0.2),
    pathEnergy: clamp01(input.presence.momentumScore / 100 * 0.52 + input.mutualMatches / 5 * 0.36 + densityEnergy * 0.12),
    skylineActivity: clamp01(densityEnergy * 0.55 + input.presence.tensionScore / 100 * 0.3 + elapsed * 0.15),
    ambientCalm: clamp01(0.22 + outcomeCalm * 0.5 + (phase === 'resolving' ? 0.18 : 0) + trust.motionCalm * 0.1),
    shutdownProgress: phase === 'afterglow' ? postEventElapsed : 0,
    narrative: phase === 'awakening'
      ? 'The district is waking as verified attendees enter the field.'
      : phase === 'alive'
        ? 'The environment is responding to live density, routes and real interaction momentum.'
        : phase === 'resolving'
          ? 'The field is calming around completed connections while unfinished paths remain visible.'
          : phase === 'afterglow'
            ? 'The district is powering down gradually and transferring meaningful activity into memory.'
            : 'Independent pockets of activity are beginning to form across the room.',
  };
}

function buildMemoryInsights(memory?: VenueMemorySnapshot | null): WorldMemoryInsight[] {
  if (!memory || memory.sampleSize < 3 || memory.confidence < 0.45) return [];
  const insights: WorldMemoryInsight[] = [];
  if (memory.medianFirstMutualMinute != null) {
    insights.push({
      title: 'This venue has a repeatable opening rhythm',
      detail: `Across prior verified events, first mutuals typically form around minute ${Math.round(memory.medianFirstMutualMinute)}.`,
      confidence: memory.confidence,
      evidenceCount: memory.sampleSize,
    });
  }
  if (memory.officeHoursConversionRate != null && memory.coldSignalConversionRate != null) {
    const lift = memory.officeHoursConversionRate - memory.coldSignalConversionRate;
    if (lift >= 0.08) {
      insights.push({
        title: 'Structured introductions perform better here',
        detail: `Office Hours converts approximately ${Math.round(lift * 100)} points better than cold signals at this venue.`,
        confidence: memory.confidence,
        evidenceCount: memory.sampleSize,
      });
    }
  }
  if (memory.peakSector !== 'unknown') {
    insights.push({
      title: 'A recurring activity zone exists',
      detail: `Aggregate event memory shows the ${memory.peakSector} side repeatedly becoming active during peak periods.`,
      confidence: memory.confidence,
      evidenceCount: memory.sampleSize,
    });
  }
  return insights.slice(0, 3);
}

/**
 * Converts current aggregate presence plus privacy-preserving venue memory into a
 * world model. It predicts opportunity density, never a person’s intent or path.
 * No raw movement trail, identity history, or individual behavioral dossier is
 * produced. Historical claims remain confidence and sample-size gated.
 */
export function buildSpatialWorldIntelligence(
  input: SpatialWorldIntelligenceInput,
): SpatialWorldIntelligence {
  const now = input.now ?? Date.now();
  const trust = buildTrust(input.presence, input.runtime, now);
  const clusters = buildClusters(input.presence.visibleTargets, now);
  const forecast = buildForecast(clusters, input.venueMemory);
  const story = buildStory(input, trust);

  return {
    memoryInsights: buildMemoryInsights(input.venueMemory),
    story,
    clusters,
    forecast,
    trust,
    activeSectorCount: new Set(clusters.map((cluster) => cluster.sector)).size,
  };
}
