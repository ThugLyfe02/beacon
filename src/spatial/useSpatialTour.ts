import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpatialLandmark } from './SpatialLandmarkEngine';
import {
  buildSpatialContinuityState,
  spatialLandmarkFingerprint,
  type SpatialContinuityState,
  type SpatialLandmarkAcknowledgement,
} from './SpatialContinuityEngine';
import {
  buildSpatialTourPlan,
  spatialTourProgress,
  type SpatialTourPlan,
  type SpatialTourStatus,
  type SpatialTourStep,
} from './SpatialTourEngine';

export interface SpatialTourController {
  status: SpatialTourStatus;
  plan: SpatialTourPlan | null;
  currentStep: SpatialTourStep | null;
  stepIndex: number;
  progress: number;
  unseenCount: number;
  seenLandmarkIds: string[];
  continuity: SpatialContinuityState;
  markSeen: (landmarkId: string) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  previous: () => void;
  stop: () => void;
  replay: () => void;
}

/**
 * Session-scoped controller for Beacon's user-initiated field tour.
 *
 * It remembers which semantic landmark versions have actually been framed
 * during this event. Confidence/salience jitter inside the same material band
 * stays acknowledged; a landmark becomes unseen again only after a meaningful
 * world change. The controller never starts or advances unless the user explicitly begins the experience.
 */
export function useSpatialTour(
  landmarks: SpatialLandmark[],
  scopeKey: string,
): SpatialTourController {
  const [status, setStatus] = useState<SpatialTourStatus>('idle');
  const [plan, setPlan] = useState<SpatialTourPlan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [acknowledgements, setAcknowledgements] = useState<Record<string, SpatialLandmarkAcknowledgement>>({});

  useEffect(() => {
    setStatus('idle');
    setPlan(null);
    setStepIndex(0);
    setAcknowledgements({});
  }, [scopeKey]);

  const landmarkById = useMemo(
    () => new Map(landmarks.map((landmark) => [landmark.id, landmark] as const)),
    [landmarks],
  );

  const continuity = useMemo(
    () => buildSpatialContinuityState(landmarks, acknowledgements),
    [landmarks, acknowledgements],
  );

  const seenLandmarkIds = useMemo(
    () => landmarks
      .filter((landmark) => acknowledgements[landmark.id]?.fingerprint === spatialLandmarkFingerprint(landmark))
      .map((landmark) => landmark.id),
    [landmarks, acknowledgements],
  );

  const unseenCount = continuity.meaningfulChangeCount;
  const currentStep = plan?.steps[stepIndex] ?? null;

  const markSeen = useCallback((landmarkId: string) => {
    const landmark = landmarkById.get(landmarkId);
    if (!landmark) return;
    const fingerprint = spatialLandmarkFingerprint(landmark);
    setAcknowledgements((current) => {
      if (current[landmarkId]?.fingerprint === fingerprint) return current;
      return {
        ...current,
        [landmarkId]: {
          fingerprint,
          acknowledgedAt: Date.now(),
        },
      };
    });
  }, [landmarkById]);

  const start = useCallback(() => {
    const nextPlan = buildSpatialTourPlan(landmarks, acknowledgements);
    if (nextPlan.steps.length === 0) return;
    setPlan(nextPlan);
    setStepIndex(0);
    setStatus('running');
    markSeen(nextPlan.steps[0].landmarkId);
  }, [landmarks, acknowledgements, markSeen]);

  const moveTo = useCallback((nextIndex: number) => {
    if (!plan || plan.steps.length === 0) return;
    const bounded = Math.max(0, Math.min(plan.steps.length - 1, nextIndex));
    setStepIndex(bounded);
    markSeen(plan.steps[bounded].landmarkId);
  }, [plan, markSeen]);

  const next = useCallback(() => {
    if (!plan) return;
    if (stepIndex >= plan.steps.length - 1) {
      setStatus('complete');
      return;
    }
    moveTo(stepIndex + 1);
  }, [plan, stepIndex, moveTo]);

  const previous = useCallback(() => {
    if (!plan) return;
    moveTo(stepIndex - 1);
  }, [plan, stepIndex, moveTo]);

  const pause = useCallback(() => {
    setStatus((current) => (current === 'running' ? 'paused' : current));
  }, []);

  const resume = useCallback(() => {
    setStatus((current) => (current === 'paused' ? 'running' : current));
  }, []);

  const stop = useCallback(() => {
    setStatus('idle');
    setPlan(null);
    setStepIndex(0);
  }, []);

  const replay = useCallback(() => {
    if (!plan || plan.steps.length === 0) {
      start();
      return;
    }
    setStepIndex(0);
    setStatus('running');
    markSeen(plan.steps[0].landmarkId);
  }, [plan, start, markSeen]);

  useEffect(() => {
    if (status !== 'running' || !currentStep) return;
    const timer = setTimeout(next, currentStep.durationMs);
    return () => clearTimeout(timer);
  }, [status, currentStep, next]);

  useEffect(() => {
    if ((status !== 'running' && status !== 'paused') || !currentStep) return;
    if (!landmarks.some((landmark) => landmark.id === currentStep.landmarkId)) next();
  }, [landmarks, currentStep, status, next]);

  return {
    status,
    plan,
    currentStep,
    stepIndex,
    progress: spatialTourProgress(plan, stepIndex),
    unseenCount,
    seenLandmarkIds,
    continuity,
    markSeen,
    start,
    pause,
    resume,
    next,
    previous,
    stop,
    replay,
  };
}
