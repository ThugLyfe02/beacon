import type { SpatialLandmark, SpatialLandmarkKind } from './SpatialLandmarkEngine';
import {
  buildSpatialContinuityState,
  spatialLandmarkFingerprint,
  type SpatialContinuityMode,
  type SpatialLandmarkAcknowledgements,
} from './SpatialContinuityEngine';

export type SpatialTourStatus = 'idle' | 'running' | 'paused' | 'complete';
export type SpatialTourStepNovelty = 'changed' | 'context';

export interface SpatialTourStep {
  id: string;
  landmarkId: string;
  kind: SpatialLandmarkKind;
  title: string;
  detail: string;
  confidence: number;
  durationMs: number;
  novelty: SpatialTourStepNovelty;
  changeWeight: number;
}

export interface SpatialTourPlan {
  id: string;
  steps: SpatialTourStep[];
  totalDurationMs: number;
  createdAt: number;
  continuityMode: SpatialContinuityMode;
  meaningfulChangeCount: number;
}

const KIND_PRIORITY: Record<SpatialLandmarkKind, number> = {
  mutual: 0,
  forecast: 1,
  cluster: 2,
  'field-center': 3,
};

const KIND_CHANGE_WEIGHT: Record<SpatialLandmarkKind, number> = {
  mutual: 1,
  forecast: 0.9,
  cluster: 0.72,
  'field-center': 0.42,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function dwellTimeForLandmark(landmark: SpatialLandmark, materiallyChanged: boolean): number {
  const baseline = landmark.kind === 'mutual'
    ? 6_200
    : landmark.kind === 'forecast'
      ? 5_400
      : landmark.kind === 'cluster'
        ? 5_000
        : 4_200;
  return baseline + (materiallyChanged ? 700 : 0);
}

function tourBudget(totalLandmarks: number): number {
  if (totalLandmarks <= 4) return totalLandmarks;
  return clamp(Math.ceil(Math.sqrt(totalLandmarks) * 2.4), 5, 10);
}

function stableTourId(landmarks: SpatialLandmark[]): string {
  const seed = landmarks
    .map((landmark) => spatialLandmarkFingerprint(landmark))
    .join('|')
    .split('')
    .reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
  return `field-scout-${Math.abs(seed).toString(36)}`;
}

function sortForScout(
  left: SpatialLandmark,
  right: SpatialLandmark,
  changedIds: ReadonlySet<string>,
): number {
  const leftChanged = changedIds.has(left.id) ? 0 : 1;
  const rightChanged = changedIds.has(right.id) ? 0 : 1;
  if (leftChanged !== rightChanged) return leftChanged - rightChanged;

  const kindDelta = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
  if (kindDelta !== 0) return kindDelta;
  if (left.salience !== right.salience) return right.salience - left.salience;
  if (left.confidence !== right.confidence) return right.confidence - left.confidence;
  return left.id.localeCompare(right.id);
}

function diversifyLandmarks(
  landmarks: SpatialLandmark[],
  changedIds: ReadonlySet<string>,
): SpatialLandmark[] {
  const ordered = [...landmarks].sort((left, right) => sortForScout(left, right, changedIds));
  const diverse: SpatialLandmark[] = [];
  const usedKinds = new Set<SpatialLandmarkKind>();

  // A materially changed landmark gets the opening frame. This never starts a
  // tour automatically; it only changes sequencing after the user opts in.
  const firstChanged = ordered.find((landmark) => changedIds.has(landmark.id));
  if (firstChanged) {
    diverse.push(firstChanged);
    usedKinds.add(firstChanged.kind);
  }

  // Preserve one orienting field-center frame when available, but do not let it
  // displace a meaningful delta from the opening position.
  const fieldCenter = ordered.find((landmark) => landmark.kind === 'field-center');
  if (fieldCenter && !diverse.some((candidate) => candidate.id === fieldCenter.id)) {
    diverse.push(fieldCenter);
    usedKinds.add(fieldCenter.kind);
  }

  for (const landmark of ordered) {
    if (!usedKinds.has(landmark.kind)) {
      diverse.push(landmark);
      usedKinds.add(landmark.kind);
    }
  }

  for (const landmark of ordered) {
    if (!diverse.some((candidate) => candidate.id === landmark.id)) diverse.push(landmark);
  }

  return diverse;
}

/**
 * Builds a user-initiated cinematic tour through explainable field landmarks.
 *
 * The step budget controls tour length, not world visibility. Every attendee and
 * landmark remains in the live world. The tour creates a concise sequence that
 * helps a user understand what materially changed without forcing a
 * recommendation or automatically selecting a person.
 */
export function buildSpatialTourPlan(
  landmarks: SpatialLandmark[],
  acknowledgements: SpatialLandmarkAcknowledgements = {},
  now = Date.now(),
): SpatialTourPlan {
  const continuity = buildSpatialContinuityState(landmarks, acknowledgements);
  const changedIds = new Set(continuity.changedLandmarkIds);
  const ordered = diversifyLandmarks(landmarks, changedIds).slice(0, tourBudget(landmarks.length));
  const steps = ordered.map<SpatialTourStep>((landmark, index) => {
    const materiallyChanged = changedIds.has(landmark.id);
    return {
      id: `tour-step-${index}-${landmark.id}`,
      landmarkId: landmark.id,
      kind: landmark.kind,
      title: landmark.title,
      detail: landmark.detail,
      confidence: landmark.confidence,
      durationMs: dwellTimeForLandmark(landmark, materiallyChanged),
      novelty: materiallyChanged ? 'changed' : 'context',
      changeWeight: materiallyChanged
        ? KIND_CHANGE_WEIGHT[landmark.kind] * (0.55 + clamp(landmark.salience, 0, 1) * 0.45)
        : 0,
    };
  });

  return {
    id: stableTourId(ordered),
    steps,
    totalDurationMs: steps.reduce((total, step) => total + step.durationMs, 0),
    createdAt: now,
    continuityMode: continuity.mode,
    meaningfulChangeCount: continuity.meaningfulChangeCount,
  };
}

export function spatialTourProgress(plan: SpatialTourPlan | null, stepIndex: number): number {
  if (!plan || plan.steps.length === 0) return 0;
  return clamp((stepIndex + 1) / plan.steps.length, 0, 1);
}
