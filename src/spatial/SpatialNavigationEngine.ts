import type { ProximitySignal } from '../presence/PresenceEngine';
import type { SpatialWorldOrchestrationState } from './SpatialWorldOrchestrator';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

export type SpatialCameraMode = 'overview' | 'explore' | 'focus' | 'convergence' | 'reflection';

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
  cinematicIntensity: number;
  reducedMotionSafe: boolean;
}

export interface SpatialNavigationInput {
  requestedMode: SpatialCameraMode;
  selectedTarget?: ProximitySignal | null;
  visibleCount: number;
  temporal: TemporalArchitectureState;
  orchestration: SpatialWorldOrchestrationState;
  reducedMotion?: boolean;
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

function poseForTarget(target: ProximitySignal, transitionSeconds: number): SpatialCameraPose {
  const [x, y, z] = positionForSpatialTarget(target);
  const horizontalLength = Math.max(1, Math.hypot(x, z));
  const pullback = clamp(4.8 + target.distanceFeet * 0.035, 4.8, 7.2);
  const normalX = x / horizontalLength;
  const normalZ = z / horizontalLength;
  return {
    position: [x - normalX * pullback, y + 2.1, z - normalZ * pullback],
    lookAt: [x, y - 0.2, z],
    fov: 48,
    transitionSeconds,
  };
}

/**
 * Camera policy for Beacon's live world.
 *
 * The camera never teleports randomly, never chases private movement, and never
 * overrides the user's explicit mode. It frames only visible, policy-approved
 * scene state and constrains acceleration to reduce motion sickness.
 */
export function buildSpatialNavigation(input: SpatialNavigationInput): SpatialNavigationState {
  const reducedMotion = input.reducedMotion ?? false;
  const coherence = clamp(input.orchestration.worldCoherence, 0, 1);
  const cinematicIntensity = reducedMotion ? 0.15 : clamp(0.28 + coherence * 0.72, 0, 1);
  const transitionSeconds = reducedMotion ? 0.05 : clamp(1.15 - coherence * 0.35, 0.55, 1.15);
  const canFocus = Boolean(input.selectedTarget);

  let mode = input.requestedMode;
  if (mode === 'focus' && !input.selectedTarget) mode = 'overview';
  if (input.temporal.phase === 'reflection' && mode === 'convergence') mode = 'reflection';

  if (mode === 'focus' && input.selectedTarget) {
    return {
      mode,
      pose: poseForTarget(input.selectedTarget, transitionSeconds),
      title: 'Focus lock',
      detail: 'Beacon is framing one visible path while keeping the wider field alive around it.',
      canFocus,
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
        transitionSeconds: reducedMotion ? 0.05 : 1.4,
      },
      title: 'Reflection view',
      detail: 'The world pulls back to reveal the shape of the event before unfinished value transfers into the Vault.',
      canFocus,
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
    cinematicIntensity,
    reducedMotionSafe: true,
  };
}
