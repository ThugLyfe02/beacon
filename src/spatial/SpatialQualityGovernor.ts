import type { RuntimeReliabilitySnapshot } from '../reliability/RuntimeReliabilityEngine';
import type { SpatialWorldOrchestration } from './SpatialWorldOrchestrator';

export type SpatialQualityTier = 'cinematic' | 'balanced' | 'efficient' | 'recovery';

export interface SpatialQualityState {
  tier: SpatialQualityTier;
  pixelRatioCap: number;
  avatarMotionMultiplier: number;
  environmentDetailMultiplier: number;
  routeDetailMultiplier: number;
  cameraDampingMultiplier: number;
  explanation: string;
}

export interface SpatialQualityInput {
  visibleCount: number;
  runtime: RuntimeReliabilitySnapshot;
  orchestration: SpatialWorldOrchestration;
  reducedMotion?: boolean;
}

/**
 * Deterministic quality policy for the spatial world. It protects frame pacing
 * before visual failure occurs, but never removes attendees or changes product
 * truth. Only representation cost and motion intensity are adjusted.
 */
export function buildSpatialQualityState(input: SpatialQualityInput): SpatialQualityState {
  const reducedMotion = input.reducedMotion ?? false;
  const runtimeHealthy = input.runtime.health === 'healthy';
  const crowded = input.visibleCount >= 24;
  const veryCrowded = input.visibleCount >= 48;
  const lowCoherence = input.orchestration.worldCoherence < 0.48;

  if (!runtimeHealthy || lowCoherence) {
    return {
      tier: 'recovery',
      pixelRatioCap: 1,
      avatarMotionMultiplier: reducedMotion ? 0 : 0.35,
      environmentDetailMultiplier: 0.45,
      routeDetailMultiplier: 0.5,
      cameraDampingMultiplier: 1.35,
      explanation: 'Beacon is preserving a stable, truthful field while live systems recover.',
    };
  }

  if (veryCrowded) {
    return {
      tier: 'efficient',
      pixelRatioCap: 1.15,
      avatarMotionMultiplier: reducedMotion ? 0 : 0.55,
      environmentDetailMultiplier: 0.62,
      routeDetailMultiplier: 0.68,
      cameraDampingMultiplier: 1.16,
      explanation: 'Crowd-aware rendering keeps every attendee visible while reducing expensive scene detail.',
    };
  }

  if (crowded || reducedMotion) {
    return {
      tier: 'balanced',
      pixelRatioCap: 1.5,
      avatarMotionMultiplier: reducedMotion ? 0 : 0.78,
      environmentDetailMultiplier: 0.82,
      routeDetailMultiplier: 0.86,
      cameraDampingMultiplier: reducedMotion ? 1.8 : 1.05,
      explanation: reducedMotion
        ? 'Motion is restrained while preserving the same navigation and opportunity information.'
        : 'Beacon is balancing cinematic detail with stable frame pacing for the current room.',
    };
  }

  return {
    tier: 'cinematic',
    pixelRatioCap: 2,
    avatarMotionMultiplier: 1,
    environmentDetailMultiplier: 1,
    routeDetailMultiplier: 1,
    cameraDampingMultiplier: 1,
    explanation: 'The field has enough headroom for full cinematic composition and environmental detail.',
  };
}
