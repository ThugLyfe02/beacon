import type { ProximitySignal } from '../presence/PresenceEngine';
import { positionForSpatialTarget } from './SpatialExperienceEngine';

export interface SpatialLayoutNode {
  target: ProximitySignal & { bucket?: number };
  position: [number, number, number];
  displacement: [number, number, number];
  lane: number;
}

const MIN_ARC_SPACING = 0.72;
const LANE_STEP = 1.15;

function stableSeed(id: string): number {
  return id.split('').reduce((total, character) => total + character.codePointAt(0)!, 0);
}

function normalizeAngle(value: number): number {
  const full = Math.PI * 2;
  return ((value % full) + full) % full;
}

/**
 * Stable, collision-aware placement for crowded event fields.
 *
 * Everyone remains represented. The engine only separates overlapping avatars
 * into nearby radial lanes so faces and tap targets do not collapse into each
 * other. It is deterministic across refreshes and never infers movement,
 * popularity or hidden intent.
 */
export function buildSpatialLayout(
  targets: Array<ProximitySignal & { bucket?: number }>,
): SpatialLayoutNode[] {
  const ordered = [...targets].sort((left, right) => {
    if (left.distanceFeet !== right.distanceFeet) return left.distanceFeet - right.distanceFeet;
    return left.targetId.localeCompare(right.targetId);
  });

  const occupiedByLane: number[][] = [];

  return ordered.map((target) => {
    const original = positionForSpatialTarget(target);
    const baseRadius = Math.max(1, Math.hypot(original[0], original[2]));
    const angle = normalizeAngle(Math.atan2(original[2], original[0]));
    let lane = 0;

    while (true) {
      const laneRadius = baseRadius + lane * LANE_STEP;
      const minimumAngle = Math.min(Math.PI / 2, MIN_ARC_SPACING / Math.max(1, laneRadius));
      const occupied = occupiedByLane[lane] ?? [];
      const collision = occupied.some((otherAngle) => {
        const direct = Math.abs(otherAngle - angle);
        const wrapped = Math.min(direct, Math.PI * 2 - direct);
        return wrapped < minimumAngle;
      });
      if (!collision) break;
      lane += 1;
    }

    occupiedByLane[lane] = [...(occupiedByLane[lane] ?? []), angle];
    const radius = baseRadius + lane * LANE_STEP;
    const seededLift = ((stableSeed(target.targetId) % 7) - 3) * 0.04;
    const position: [number, number, number] = [
      Math.cos(angle) * radius,
      original[1] + seededLift,
      Math.sin(angle) * radius,
    ];

    return {
      target,
      position,
      displacement: [
        position[0] - original[0],
        position[1] - original[1],
        position[2] - original[2],
      ],
      lane,
    };
  });
}
