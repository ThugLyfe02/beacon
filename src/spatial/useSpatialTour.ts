import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpatialLandmark } from './SpatialLandmarkEngine';
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
 * It remembers which explainable landmarks have been framed during this event,
 * prioritizes newly appeared landmarks on the next tour, pauses cleanly, and
 * never starts or advances unless the user explicitly begins the experience.
 */
export function useSpatialTour(
  landmarks: SpatialLandmark[],
  scopeKey: string,
): SpatialTourController {
  const [status, setStatus] = useState<SpatialTourStatus>('idle');
  const [plan, setPlan] = useState<SpatialTourPlan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [seenLandmarkIds, setSeenLandmarkIds] = useState<string[]>([]);

  useEffect(() => {
    setStatus('idle');
    setPlan(null);
    setStepIndex(0);
    setSeenLandmarkIds([]);
  }, [scopeKey]);

  const seenSet = useMemo(() => new Set(seenLandmarkIds), [seenLandmarkIds]);
  const unseenCount = useMemo(
    () => landmarks.filter((landmark) => !seenSet.has(landmark.id)).length,
    [landmarks, seenSet],
  );

  const currentStep = plan?.steps[stepIndex] ?? null;

  const markSeen = useCallback((landmarkId: string) => {
    setSeenLandmarkIds((current) => (
      current.includes(landmarkId) ? current : [...current, landmarkId]
    ));
  }, []);

  const start = useCallback(() => {
    const nextPlan = buildSpatialTourPlan(landmarks, seenLandmarkIds);
    if (nextPlan.steps.length === 0) return;
    setPlan(nextPlan);
    setStepIndex(0);
    setStatus('running');
    markSeen(nextPlan.steps[0].landmarkId);
  }, [landmarks, seenLandmarkIds, markSeen]);

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
