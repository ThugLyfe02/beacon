import type { SpatialLandmark, SpatialLandmarkKind } from './SpatialLandmarkEngine';

export type SpatialTourStatus = 'idle' | 'running' | 'paused' | 'complete';

export interface SpatialTourStep {
  id: string;
  landmarkId: string;
  kind: SpatialLandmarkKind;
  title: string;
  detail: string;
  confidence: number;
  durationMs: number;
}

export interface SpatialTourPlan {
  id: string;
  steps: SpatialTourStep[];
  totalDurationMs: number;
  createdAt: number;
}

const KIND_PRIORITY: Record<SpatialLandmarkKind, number> = {
  'field-center': 0,
  cluster: 1,
  forecast: 2,
  'declared-fit': 3,
  mutual: 4,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function dwellTimeForLandmark(landmark: SpatialLandmark): number {
  switch (landmark.kind) {
    case 'mutual':
      return 6_200;
    case 'declared-fit':
      return 5_800;
    case 'forecast':
      return 5_400;
    case 'cluster':
      return 5_000;
    default:
      return 4_200;
  }
}

function tourBudget(totalLandmarks: number): number {
  if (totalLandmarks <= 4) return totalLandmarks;
  return clamp(Math.ceil(Math.sqrt(totalLandmarks) * 2.4), 5, 10);
}

function stableTourId(landmarks: SpatialLandmark[]): string {
  const seed = landmarks
    .map((landmark) => landmark.id)
    .join('|')
    .split('')
    .reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
  return `field-scout-${Math.abs(seed).toString(36)}`;
}

function diversifyLandmarks(
  landmarks: SpatialLandmark[],
  seenLandmarkIds: ReadonlySet<string>,
): SpatialLandmark[] {
  const fieldCenter = landmarks.find((landmark) => landmark.kind === 'field-center');
  const remainder = landmarks.filter((landmark) => landmark.id !== fieldCenter?.id);

  remainder.sort((left, right) => {
    const leftSeen = seenLandmarkIds.has(left.id) ? 1 : 0;
    const rightSeen = seenLandmarkIds.has(right.id) ? 1 : 0;
    if (leftSeen !== rightSeen) return leftSeen - rightSeen;
    const kindDelta = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
    if (kindDelta !== 0) return kindDelta;
    if (left.salience !== right.salience) return right.salience - left.salience;
    return left.id.localeCompare(right.id);
  });

  const diverse: SpatialLandmark[] = fieldCenter ? [fieldCenter] : [];
  const usedKinds = new Set<SpatialLandmarkKind>(fieldCenter ? ['field-center'] : []);

  for (const landmark of remainder) {
    if (!usedKinds.has(landmark.kind)) {
      diverse.push(landmark);
      usedKinds.add(landmark.kind);
    }
  }

  for (const landmark of remainder) {
    if (!diverse.some((candidate) => candidate.id === landmark.id)) diverse.push(landmark);
  }

  return diverse;
}

/**
 * Builds a user-initiated cinematic tour through explainable field landmarks.
 *
 * The step budget controls tour length, not world visibility. Every attendee and
 * landmark remains in the live world. The tour simply creates a concise sequence
 * that helps a user understand what changed without forcing a recommendation or
 * automatically selecting a person. Explicit declared-fit landmarks can enter
 * the tour because the participant already opted into that pairwise relevance
 * surface; they do not grant the tour authority to hide or auto-contact anyone.
 */
export function buildSpatialTourPlan(
  landmarks: SpatialLandmark[],
  seenLandmarkIds: Iterable<string> = [],
  now = Date.now(),
): SpatialTourPlan {
  const seen = new Set(seenLandmarkIds);
  const ordered = diversifyLandmarks(landmarks, seen).slice(0, tourBudget(landmarks.length));
  const steps = ordered.map<SpatialTourStep>((landmark, index) => ({
    id: `tour-step-${index}-${landmark.id}`,
    landmarkId: landmark.id,
    kind: landmark.kind,
    title: landmark.title,
    detail: landmark.detail,
    confidence: landmark.confidence,
    durationMs: dwellTimeForLandmark(landmark),
  }));

  return {
    id: stableTourId(ordered),
    steps,
    totalDurationMs: steps.reduce((total, step) => total + step.durationMs, 0),
    createdAt: now,
  };
}

export function spatialTourProgress(plan: SpatialTourPlan | null, stepIndex: number): number {
  if (!plan || plan.steps.length === 0) return 0;
  return clamp((stepIndex + 1) / plan.steps.length, 0, 1);
}
