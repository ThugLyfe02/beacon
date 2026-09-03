import type { ProximitySignal } from '../presence/PresenceEngine';
import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';
import type { SpatialWorldOrchestration } from './SpatialWorldOrchestrator';
import type { SpatialLayoutNode } from './SpatialLayoutEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

export type SpatialLandmarkKind = 'mutual' | 'declared-fit' | 'cluster' | 'forecast' | 'field-center';

export interface SpatialLandmark {
  id: string;
  kind: SpatialLandmarkKind;
  title: string;
  detail: string;
  position: [number, number, number];
  confidence: number;
  salience: number;
  targetId?: string;
  /** Used when evidence is categorical/verified rather than probabilistic. */
  evidenceLabel?: string;
}

export interface SpatialLandmarkState {
  landmarks: SpatialLandmark[];
  active: SpatialLandmark | null;
  activeIndex: number;
  canCycle: boolean;
}

export interface SpatialLandmarkInput {
  visibleTargets: ProximitySignal[];
  intelligence: SpatialWorldIntelligence;
  orchestration: SpatialWorldOrchestration;
  activeLandmarkId?: string | null;
  layout?: SpatialLayoutNode[];
}

const SECTOR_POSITION: Record<'north' | 'east' | 'south' | 'west', [number, number, number]> = {
  north: [0, -1.4, -8.2],
  east: [8.2, -1.4, 0],
  south: [0, -1.4, 8.2],
  west: [-8.2, -1.4, 0],
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function intentLabel(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function declaredFitDetail(target: ProximitySignal): string {
  const theyCanHelp = (target.declaredFitTheyCanHelp ?? []).slice(0, 2).map(intentLabel);
  const iCanHelp = (target.declaredFitICanHelp ?? []).slice(0, 2).map(intentLabel);
  const parts: string[] = [];
  if (theyCanHelp.length > 0) parts.push(`they can help: ${theyCanHelp.join(', ')}`);
  if (iCanHelp.length > 0) parts.push(`you can help: ${iCanHelp.join(', ')}`);
  return parts.join(' · ') || 'Explicit event selections overlap for this pair.';
}

/**
 * Builds camera-addressable landmarks from only already-visible people and
 * aggregate world state. Landmarks are explainable scene anchors, never hidden
 * recommendations or inferred personal intent.
 *
 * Declared-fit landmarks come only from the caller's pairwise explicit-intent
 * intersection already attached to a visible proximity signal. They do not
 * reveal a peer's full declaration and do not make non-fit attendees disappear.
 */
export function buildSpatialLandmarks(input: SpatialLandmarkInput): SpatialLandmarkState {
  const landmarks: SpatialLandmark[] = [];
  const layoutByTarget = new Map(
    (input.layout ?? []).map((node) => [node.target.targetId, node.position] as const),
  );

  const mutuals = input.visibleTargets
    .filter((target) => target.mutual)
    .sort((left, right) => left.distanceFeet - right.distanceFeet || left.targetId.localeCompare(right.targetId))
    .slice(0, 3);

  mutuals.forEach((target, index) => {
    landmarks.push({
      id: `mutual-${target.targetId}`,
      kind: 'mutual',
      title: index === 0 ? 'Closest mutual route' : 'Active mutual route',
      detail: 'A verified mutual already visible in the field.',
      position: layoutByTarget.get(target.targetId) ?? positionForSpatialTarget(target),
      confidence: 1,
      salience: clamp01(0.86 + (1 - Math.min(target.distanceFeet, 40) / 40) * 0.14),
      targetId: target.targetId,
      evidenceLabel: 'Verified mutual',
    });
  });

  const declaredFits = input.visibleTargets
    .filter((target) => !target.mutual && (target.declaredFitStrength ?? 0) > 0)
    .sort((left, right) => {
      if (Boolean(left.declaredFitTwoWay) !== Boolean(right.declaredFitTwoWay)) {
        return left.declaredFitTwoWay ? -1 : 1;
      }
      const strengthDelta = (right.declaredFitStrength ?? 0) - (left.declaredFitStrength ?? 0);
      if (strengthDelta !== 0) return strengthDelta;
      if (left.distanceFeet !== right.distanceFeet) return left.distanceFeet - right.distanceFeet;
      return left.targetId.localeCompare(right.targetId);
    })
    .slice(0, 3);

  declaredFits.forEach((target) => {
    const strength = clamp01(target.declaredFitStrength ?? 0);
    const near = 1 - Math.min(40, Math.max(0, target.distanceFeet)) / 40;
    landmarks.push({
      id: `declared-fit-${target.targetId}`,
      kind: 'declared-fit',
      title: target.declaredFitTwoWay ? 'Two-way declared fit nearby' : 'Declared fit nearby',
      detail: declaredFitDetail(target),
      position: layoutByTarget.get(target.targetId) ?? positionForSpatialTarget(target),
      confidence: 1,
      salience: clamp01(0.72 + strength * 0.16 + (target.declaredFitTwoWay ? 0.07 : 0) + near * 0.05),
      targetId: target.targetId,
      evidenceLabel: target.declaredFitTwoWay
        ? 'Explicit two-way event selections'
        : 'Explicit event selections',
    });
  });

  input.intelligence.clusters.slice(0, 4).forEach((cluster) => {
    if (cluster.sector === 'unknown') return;
    landmarks.push({
      id: `cluster-${cluster.id}`,
      kind: 'cluster',
      title: `${cluster.memberCount}-person activity zone`,
      detail: `${cluster.sector} side · ${Math.round(cluster.momentum * 100)}% aggregate momentum`,
      position: SECTOR_POSITION[cluster.sector],
      confidence: cluster.confidence,
      salience: clamp01(cluster.momentum * 0.62 + cluster.confidence * 0.38),
    });
  });

  const forecast = input.intelligence.forecast;
  if (forecast && forecast.sector !== 'unknown') {
    landmarks.push({
      id: `forecast-${forecast.sector}`,
      kind: 'forecast',
      title: `Momentum forming on the ${forecast.directionLabel}`,
      detail: `${Math.round(forecast.confidence * 100)}% aggregate confidence · next ${forecast.horizonMinutes}m`,
      position: SECTOR_POSITION[forecast.sector],
      confidence: forecast.confidence,
      salience: clamp01(forecast.confidence * (0.72 + input.orchestration.routeEnergy * 0.28)),
    });
  }

  if (input.visibleTargets.length > 0) {
    landmarks.push({
      id: 'field-center',
      kind: 'field-center',
      title: 'Center of live activity',
      detail: `${input.visibleTargets.length} visible attendee${input.visibleTargets.length === 1 ? '' : 's'} remain represented.`,
      position: [0, -0.8, 0],
      confidence: input.orchestration.worldCoherence,
      salience: clamp01(0.4 + input.orchestration.worldCoherence * 0.35),
    });
  }

  landmarks.sort((left, right) => right.salience - left.salience || left.id.localeCompare(right.id));
  const requestedIndex = landmarks.findIndex((item) => item.id === input.activeLandmarkId);
  const activeIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const active = landmarks.length > 0 ? landmarks[activeIndex] : null;

  return {
    landmarks,
    active,
    activeIndex: active ? activeIndex : -1,
    canCycle: landmarks.length > 1,
  };
}

export function cycleSpatialLandmark(
  state: SpatialLandmarkState,
  direction: 1 | -1,
): string | null {
  if (state.landmarks.length === 0) return null;
  const nextIndex = (Math.max(0, state.activeIndex) + direction + state.landmarks.length) % state.landmarks.length;
  return state.landmarks[nextIndex].id;
}
