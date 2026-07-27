import type { RuntimeHealth } from '../reliability/RuntimeReliabilityEngine';
import type { SpatialCameraMode } from './SpatialNavigationEngine';
import type { SpatialQualityTier } from './SpatialQualityGovernor';
import type { SpatialTourStatus } from './SpatialTourEngine';
import type { TemporalPhase } from './TemporalArchitectureEngine';

export type SpatialHudPanel =
  | 'director'
  | 'world-intelligence'
  | 'narrative'
  | 'landmark'
  | 'navigation'
  | 'contract'
  | 'progress'
  | 'tour';

export interface SpatialAttentionInput {
  cameraMode: SpatialCameraMode;
  temporalPhase: TemporalPhase;
  runtimeHealth: RuntimeHealth;
  qualityTier: SpatialQualityTier;
  tourStatus: SpatialTourStatus;
  landmarkCount: number;
  unseenLandmarkCount: number;
  hasForecast: boolean;
  hasAlmostDiscovered: boolean;
  hasSelectedTarget: boolean;
}

export interface SpatialAttentionPlan {
  visible: Record<SpatialHudPanel, boolean>;
  primary: SpatialHudPanel;
  secondary: SpatialHudPanel | null;
  density: 'minimal' | 'balanced' | 'expanded';
  reason: string;
}

function emptyVisibility(): Record<SpatialHudPanel, boolean> {
  return {
    director: false,
    'world-intelligence': false,
    narrative: false,
    landmark: false,
    navigation: false,
    contract: false,
    progress: false,
    tour: false,
  };
}

function plan(
  primary: SpatialHudPanel,
  secondary: SpatialHudPanel | null,
  panels: SpatialHudPanel[],
  density: SpatialAttentionPlan['density'],
  reason: string,
): SpatialAttentionPlan {
  const visible = emptyVisibility();
  for (const panel of panels) visible[panel] = true;
  return { visible, primary, secondary, density, reason };
}

/**
 * Explicit attention policy for the live world.
 *
 * Beacon has many legitimate systems, but rendering every explanation at once
 * makes a premium spatial product feel like a debug dashboard. This engine keeps
 * the same capabilities available while showing only the panels that matter for
 * the user's current camera mode, event phase and runtime state.
 */
export function buildSpatialAttentionPlan(input: SpatialAttentionInput): SpatialAttentionPlan {
  const tourActive = input.tourStatus === 'running' || input.tourStatus === 'paused';

  if (tourActive) {
    return plan(
      'tour',
      null,
      ['tour'],
      'minimal',
      'The user explicitly started Field Scout, so the tour owns the attention surface until paused or exited.',
    );
  }

  if (input.tourStatus === 'complete') {
    return plan(
      'tour',
      'navigation',
      ['tour', 'navigation'],
      'minimal',
      'The tour summary remains primary while navigation stays available for a deliberate return to the field.',
    );
  }

  if (input.runtimeHealth !== 'healthy' || input.qualityTier === 'recovery') {
    return plan(
      'director',
      'narrative',
      ['director', 'narrative', 'navigation'],
      'minimal',
      'Live systems are recovering, so Beacon prioritizes truthful status and suppresses secondary analysis.',
    );
  }

  if (input.cameraMode === 'focus' || input.hasSelectedTarget) {
    return plan(
      'navigation',
      input.hasAlmostDiscovered ? 'narrative' : null,
      input.hasAlmostDiscovered ? ['navigation', 'narrative'] : ['navigation'],
      'minimal',
      'A person was explicitly selected, so the world clears explanatory clutter around the focused interaction.',
    );
  }

  if (input.cameraMode === 'landmark') {
    return plan(
      'landmark',
      input.hasForecast ? 'world-intelligence' : 'navigation',
      input.hasForecast
        ? ['landmark', 'world-intelligence', 'navigation']
        : ['landmark', 'navigation'],
      'balanced',
      'Landmark framing needs evidence, context and an immediate route back to direct camera control.',
    );
  }

  if (input.temporalPhase === 'reflection') {
    return plan(
      'narrative',
      'progress',
      ['narrative', 'progress', 'navigation'],
      'balanced',
      'Reflection shifts attention from live discovery toward what the event produced and what still deserves follow-through.',
    );
  }

  if (input.temporalPhase === 'closing' || input.temporalPhase === 'commitment') {
    return plan(
      'narrative',
      'contract',
      ['narrative', 'contract', 'navigation'],
      'balanced',
      'Late-event phases prioritize one concrete commitment rather than broad world analysis.',
    );
  }

  if (input.cameraMode === 'convergence' || input.temporalPhase === 'peak') {
    return plan(
      'world-intelligence',
      'director',
      ['world-intelligence', 'director', 'navigation'],
      'expanded',
      'Peak activity makes aggregate room intelligence and scene direction more valuable than progression detail.',
    );
  }

  if (input.unseenLandmarkCount > 0) {
    return plan(
      'tour',
      'director',
      ['tour', 'director', 'navigation'],
      'balanced',
      'New explainable world changes are available, so Beacon offers an optional guided scan without forcing it.',
    );
  }

  if (input.landmarkCount > 0) {
    return plan(
      'director',
      'landmark',
      ['director', 'landmark', 'navigation'],
      'balanced',
      'The field is stable enough to show current direction and one navigable landmark without covering the world.',
    );
  }

  return plan(
    'director',
    'progress',
    ['director', 'progress', 'navigation'],
    'balanced',
    'The room is still forming, so Beacon keeps orientation, progress and camera control visible.',
  );
}
