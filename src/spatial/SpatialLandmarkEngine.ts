import type { ProximitySignal } from '../presence/PresenceEngine';
import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';
import type { SpatialWorldOrchestrationState } from './SpatialWorldOrchestrator';
import type { SpatialLayoutNode } from './SpatialLayoutEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

export type SpatialLandmarkKind = 'mutual' | 'cluster' | 'forecast' | 'field-center';

export interface SpatialLandmark {
  id: string;
  kind: SpatialLandmarkKind;
  title: string;
  detail: string;
  position: [number, number, number];
  confidence: number;
  salience: number;
  targetId?: string;
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
  orchestration: SpatialWorldOrchestrationState;
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

/**
 * Builds camera-addressable landmarks from only already-visible people and
 * aggregate world state. Landmarks are explainable scene anchors, never hidden
 * recommendations or inferred personal intent.
 */
export function buildSpatialLandmarks(input: SpatialLandmarkInput): SpatialLandmarkState {
  const landmarks: SpatialLandmark[] = [];
  const layoutByTarget = new Map(
    (input.layout ?? []).map((node) => [node.target.targetId, node.position] as const),
  );

  const mutuals = input.visibleTargets
    .filter((target) => target.mutual)
    .sort((left, right) => left.distanceFeet - right.distanceFeet)
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
