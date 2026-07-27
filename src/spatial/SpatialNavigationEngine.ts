import type { ProximitySignal } from '../presence/PresenceEngine';
import type { SpatialWorldOrchestrationState } from './SpatialWorldOrchestrator';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';
import type { SpatialLandmark } from './SpatialLandmarkEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

export type SpatialCameraMode = 'overview' | 'explore' | 'focus' | 'landmark' | 'convergence' | 'reflection';

export interface SpatialCameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  transitionSeconds: number;
}

export interface SpatialNavigationState {
  mode: SpatialCameraMode;
  pose: SpatialCameraPose;
  title: string;
  detail: string;
  canFocus: boolean;
  canFrameLandmark: boolean;
  cinematicIntensity: number;
  reducedMotionSafe: boolean;
}

export interface SpatialNavigationInput {
  requestedMode: SpatialCameraMode;
  selectedTarget?: ProximitySignal | null;
  activeLandmark?: SpatialLandmark | null;
  visibleCount: number;
  temporal: TemporalArchitectureState;
  orchestration: SpatialWorldOrchestrationState;
  reducedMotion?: boolean;
  dampingMultiplier?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function overviewPose(visibleCount: number, transitionSeconds: number): SpatialCameraPose {
  const distance = clamp(12 + Math.sqrt(Math.max(0, visibleCount)) * 1.4, 12, 24);
  return {
    position: [0, 4.2 + Math.min(4, visibleCount * 0.08), distance],
    lookAt: [0, -0.6, 0],
    fov: clamp(58 + visibleCount * 0.18, 58, 68),
    transitionSeconds,
  };
}

function poseForPoint(
  point: [number, number, number],
  transitionSeconds: number,
  pullback: number,
  fov: number,
): SpatialCameraPose {
  const [x, y, z] = point;
  const horizontalLength = Math.max(1, Math.hypot(x, z));
  const normalX = x / horizontalLength;
  const normalZ = z / horizontalLength;
  return {
    position: [x - normalX * pullback, y + 2.1, z - normalZ * pullback],
    lookAt: [x, y - 0.2, z],
    fov,
    transitionSeconds,
  };
}

function poseForTarget(target: ProximitySignal, transitionSeconds: number): SpatialCameraPose {
  const pullback = clamp(4.8 + target.distanceFeet * 0.035, 4.8, 7.2);
  return poseForPoint(positionForSpatialTarget(target), transitionSeconds, pullback, 48);
}

/**
 * Camera policy for Beacon's live world.
 *
 * The camera never teleports randomly, never chases private movement, and never
 * overrides the user's explicit mode. It frames only visible people or
 * explainable aggregate landmarks and constrains acceleration to reduce motion
 * sickness.
 */
export function buildSpatialNavigation(input: SpatialNavigationInput): SpatialNavigationState {
  const reducedMotion = input.reducedMotion ?? false;
  const coherence = clamp(input.orchestration.worldCoherence, 0, 1);
  const cinematicIntensity = reducedMotion ? 0.15 : clamp(0.28 + coherence * 0.72, 0, 1);
  const baseTransition = reducedMotion ? 0.05 : clamp(1.15 - coherence * 0.35, 0.55, 1.15);
  const transitionSeconds = baseTransition * clamp(input.dampingMultiplier ?? 1, 0.8, 2);
  const canFocus = Boolean(input.selectedTarget);
  const canFrameLandmark = Boolean(input.activeLandmark);

  let mode = input.requestedMode;
  if (mode === 'focus' && !input.selectedTarget) mode = 'overview';
  if (mode === 'landmark' && !input.activeLandmark) mode = 'overview';
  if (input.temporal.phase === 'reflection' && mode === 'convergence') mode = 'reflection';

  if (mode === 'focus' && input.selectedTarget) {
    return {
      mode,
      pose: poseForTarget(input.selectedTarget, transitionSeconds),
      title: 'Focus lock',
      detail: 'Beacon is framing one visible path while keeping the wider field alive around it.',
      canFocus,
      canFrameLandmark,
      cinematicIntensity,
      reducedMotionSafe: true,
    };
  }

  if (mode === 'landmark' && input.activeLandmark) {
    return {
      mode,
      pose: poseForPoint(input.activeLandmark.position, transitionSeconds, 6.4, 50),
      title: input.activeLandmark.title,
      detail: `Camera framing is anchored to an explainable ${input.activeLandmark.kind.replace('-', ' ')} derived from visible or aggregate field state.`,
      canFocus,
      canFrameLandmark,
      cinematicIntensity,
      reducedMotionSafe: true,
    };
  }

  if (mode === 'convergence') {
    return {
      mode,
      pose: {
        position: [0, 2.6, 9.4],
        lookAt: [0, -0.8, -1.5],
        fov: 52,
        transitionSeconds,
      },
      title: 'Convergence view',
      detail: 'The camera compresses toward the live center so routes, clusters and mutual energy read as one system.',
      canFocus,
      canFrameLandmark,
      cinematicIntensity,
      reducedMotionSafe: true,
    };
  }

  if (mode === 'reflection') {
    return {
      mode,
      pose: {
        position: [0, 7.5, 18.5],
        lookAt: [0, -1.2, 0],
        fov: 62,
        transitionSeconds: reducedMotion ? 0.05 : 1.4 * clamp(input.dampingMultiplier ?? 1, 0.8, 2),
      },
      title: 'Reflection view',
      detail: 'The world pulls back to reveal the shape of the event before unfinished value transfers into the Vault.',
      canFocus,
      canFrameLandmark,
      cinematicIntensity: reducedMotion ? 0.1 : cinematicIntensity * 0.72,
      reducedMotionSafe: true,
    };
  }

  if (mode === 'explore') {
    const phaseLift = input.temporal.phase === 'peak' ? 0.8 : 0;
    return {
      mode,
      pose: {
        position: [5.8, 2.8 + phaseLift, 10.8],
        lookAt: [0, -0.5, 0],
        fov: 57,
        transitionSeconds,
      },
      title: 'Explore view',
      detail: 'An angled composition reveals depth between avatars, routes and the evolving district.',
      canFocus,
      canFrameLandmark,
      cinematicIntensity,
      reducedMotionSafe: true,
    };
  }

  return {
    mode: 'overview',
    pose: overviewPose(input.visibleCount, transitionSeconds),
    title: 'Field overview',
    detail: 'Beacon frames the complete visible room without hiding attendees or forcing a single recommended path.',
    canFocus,
    canFrameLandmark,
    cinematicIntensity,
    reducedMotionSafe: true,
  };
}
