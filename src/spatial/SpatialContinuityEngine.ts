import type { SpatialLandmark, SpatialLandmarkKind } from './SpatialLandmarkEngine';

export type SpatialContinuityMode = 'quiet' | 'forming' | 'shifting' | 'high-change';

export interface SpatialLandmarkAcknowledgement {
  fingerprint: string;
  acknowledgedAt: number;
}

export type SpatialLandmarkAcknowledgements = Readonly<Record<string, SpatialLandmarkAcknowledgement>>;

export interface SpatialContinuityState {
  meaningfulChangeCount: number;
  changedLandmarkIds: string[];
  unseenByKind: Record<SpatialLandmarkKind, number>;
  changeRatio: number;
  intensity: number;
  mode: SpatialContinuityMode;
  headline: string;
  reason: string;
  currentFingerprints: Readonly<Record<string, string>>;
}

const KIND_WEIGHT: Record<SpatialLandmarkKind, number> = {
  mutual: 1,
  forecast: 0.9,
  cluster: 0.72,
  'field-center': 0.42,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function quantize(value: number, buckets = 8): number {
  return Math.round(clamp01(value) * buckets);
}

/**
 * Produces a semantic landmark version rather than a render-frame checksum.
 *
 * Position is intentionally excluded: collision resolution, camera damping and
 * small sensor movement must not make Beacon claim that the world materially
 * changed. A landmark becomes new again only when its evidence confidence or
 * salience crosses a meaningful band, or when its explainable identity changes.
 */
export function spatialLandmarkFingerprint(landmark: SpatialLandmark): string {
  return [
    landmark.id,
    landmark.kind,
    quantize(landmark.confidence),
    quantize(landmark.salience),
    landmark.targetId ?? '-',
  ].join('|');
}

function emptyKindCounts(): Record<SpatialLandmarkKind, number> {
  return {
    mutual: 0,
    cluster: 0,
    forecast: 0,
    'field-center': 0,
  };
}

function buildHeadline(counts: Record<SpatialLandmarkKind, number>, total: number): string {
  if (total <= 0) return 'The field is stable';
  if (counts.mutual > 0) {
    return counts.mutual === 1
      ? 'A mutual route materially changed'
      : `${counts.mutual} mutual routes materially changed`;
  }
  if (counts.forecast > 0) return 'Aggregate momentum shifted';
  if (counts.cluster > 0) {
    return counts.cluster === 1
      ? 'An activity zone materially changed'
      : `${counts.cluster} activity zones materially changed`;
  }
  return total === 1 ? 'The live field materially changed' : `${total} meaningful world changes`;
}

/**
 * Session-local continuity model for the spatial world.
 *
 * This is deliberately not a recommender, behavioral profile or hidden-person
 * model. It compares only explainable landmarks the user can already access and
 * remembers only which semantic versions were explicitly framed during the
 * current event session. Jitter inside the same confidence/salience band is
 * ignored so Field Scout reacts to world meaning, not polling noise.
 */
export function buildSpatialContinuityState(
  landmarks: SpatialLandmark[],
  acknowledgements: SpatialLandmarkAcknowledgements = {},
): SpatialContinuityState {
  const currentFingerprints: Record<string, string> = {};
  const unseenByKind = emptyKindCounts();
  const changedLandmarkIds: string[] = [];
  let weightedChange = 0;

  for (const landmark of landmarks) {
    const fingerprint = spatialLandmarkFingerprint(landmark);
    currentFingerprints[landmark.id] = fingerprint;
    if (acknowledgements[landmark.id]?.fingerprint === fingerprint) continue;

    changedLandmarkIds.push(landmark.id);
    unseenByKind[landmark.kind] += 1;
    weightedChange += KIND_WEIGHT[landmark.kind] * (0.55 + clamp01(landmark.salience) * 0.45);
  }

  changedLandmarkIds.sort((leftId, rightId) => {
    const left = landmarks.find((landmark) => landmark.id === leftId);
    const right = landmarks.find((landmark) => landmark.id === rightId);
    if (!left || !right) return leftId.localeCompare(rightId);
    const weightDelta = KIND_WEIGHT[right.kind] - KIND_WEIGHT[left.kind];
    if (weightDelta !== 0) return weightDelta;
    if (right.salience !== left.salience) return right.salience - left.salience;
    return left.id.localeCompare(right.id);
  });

  const denominator = Math.max(1, landmarks.length);
  const changeRatio = clamp01(changedLandmarkIds.length / denominator);
  const intensity = clamp01(weightedChange / Math.max(1, Math.min(landmarks.length, 5)));
  const mode: SpatialContinuityMode = changedLandmarkIds.length === 0
    ? 'quiet'
    : changedLandmarkIds.length === landmarks.length && Object.keys(acknowledgements).length === 0
      ? 'forming'
      : changeRatio >= 0.6 || intensity >= 0.72
        ? 'high-change'
        : 'shifting';

  const reason = mode === 'quiet'
    ? 'No explainable landmark has crossed a new confidence or salience band since it was framed.'
    : mode === 'forming'
      ? 'This is the first semantic pass over the current explainable world.'
      : mode === 'high-change'
        ? 'Several explainable landmarks crossed material evidence or salience bands at once.'
        : 'At least one explainable landmark crossed a material evidence or salience band.';

  return {
    meaningfulChangeCount: changedLandmarkIds.length,
    changedLandmarkIds,
    unseenByKind,
    changeRatio,
    intensity,
    mode,
    headline: buildHeadline(unseenByKind, changedLandmarkIds.length),
    reason,
    currentFingerprints,
  };
}
