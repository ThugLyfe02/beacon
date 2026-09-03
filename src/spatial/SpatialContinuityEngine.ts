import { positionForSpatialTarget } from './SpatialExperienceEngine';
import type { SpatialLayoutNode } from './SpatialLayoutEngine';

export type SpatialContinuityDecision = 'new' | 'deadband' | 'damped' | 'snap';

export interface SpatialContinuityResult {
  layout: SpatialLayoutNode[];
  decisions: Array<{
    targetId: string;
    decision: SpatialContinuityDecision;
    displacementSceneUnits: number;
  }>;
  deadbandCount: number;
  dampedCount: number;
  snapCount: number;
}

const DEADBAND_SCENE_UNITS = 0.18;
const MAX_DAMPED_STEP_SCENE_UNITS = 1.2;
const DAMPING_ALPHA = 0.42;
const MAX_AGE_FOR_DAMPING_MS = 45_000;

function distance3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function interpolate(
  previous: [number, number, number],
  current: [number, number, number],
  alpha: number,
): [number, number, number] {
  return [
    previous[0] + (current[0] - previous[0]) * alpha,
    previous[1] + (current[1] - previous[1]) * alpha,
    previous[2] + (current[2] - previous[2]) * alpha,
  ];
}

/**
 * Suppresses tiny GPS/layout jitter without inventing motion between samples.
 * The engine remembers only one prior resolved position supplied by its caller,
 * never estimates velocity, and snaps immediately when movement is materially
 * large. Old signals are never damped because smoothing stale evidence would make
 * an old coordinate look more live than the source warrants.
 *
 * This state is intended to live only in the mounted spatial screen. It is not persisted, transmitted, or accumulated into an attendee movement dossier.
 */
export function stabilizeSpatialLayout(
  current: SpatialLayoutNode[],
  previous: SpatialLayoutNode[],
  now = Date.now(),
): SpatialContinuityResult {
  const previousByTarget = new Map(previous.map((node) => [node.target.targetId, node] as const));
  const decisions: SpatialContinuityResult['decisions'] = [];

  const layout = current.map<SpatialLayoutNode>((node) => {
    const prior = previousByTarget.get(node.target.targetId);
    if (!prior) {
      decisions.push({ targetId: node.target.targetId, decision: 'new', displacementSceneUnits: 0 });
      return node;
    }

    const delta = distance3(prior.position, node.position);
    const ageMs = node.target.timestamp == null || !Number.isFinite(node.target.timestamp)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, now - node.target.timestamp);

    let decision: SpatialContinuityDecision = 'snap';
    let position = node.position;

    if (ageMs <= MAX_AGE_FOR_DAMPING_MS && delta <= DEADBAND_SCENE_UNITS) {
      decision = 'deadband';
      position = prior.position;
    } else if (ageMs <= MAX_AGE_FOR_DAMPING_MS && delta <= MAX_DAMPED_STEP_SCENE_UNITS) {
      decision = 'damped';
      position = interpolate(prior.position, node.position, DAMPING_ALPHA);
    }

    const rawBase = positionForSpatialTarget(node.target);
    decisions.push({ targetId: node.target.targetId, decision, displacementSceneUnits: delta });
    return {
      ...node,
      position,
      displacement: [
        position[0] - rawBase[0],
        position[1] - rawBase[1],
        position[2] - rawBase[2],
      ],
    };
  });

  return {
    layout,
    decisions,
    deadbandCount: decisions.filter((item) => item.decision === 'deadband').length,
    dampedCount: decisions.filter((item) => item.decision === 'damped').length,
    snapCount: decisions.filter((item) => item.decision === 'snap').length,
  };
}
