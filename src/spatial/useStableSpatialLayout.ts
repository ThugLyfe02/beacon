import { useMemo, useRef } from 'react';
import type { ProximitySignal } from '../presence/PresenceEngine';
import { stabilizeSpatialLayout, type SpatialContinuityResult } from './SpatialContinuityEngine';
import { buildSpatialLayout, type SpatialLayoutNode } from './SpatialLayoutEngine';

interface CacheState {
  signature: string;
  layout: SpatialLayoutNode[];
  result: SpatialContinuityResult;
}

function signatureFor(targets: Array<ProximitySignal & { bucket?: number }>): string {
  return [...targets]
    .sort((left, right) => left.targetId.localeCompare(right.targetId))
    .map((target) => [
      target.targetId,
      target.timestamp ?? 'none',
      Number.isFinite(target.distanceFeet) ? target.distanceFeet.toFixed(2) : 'distance?',
      target.bearingFromObserverDeg == null || !Number.isFinite(target.bearingFromObserverDeg)
        ? 'bearing?'
        : target.bearingFromObserverDeg.toFixed(2),
    ].join(':'))
    .join('|');
}

/**
 * Session-local adapter around the pure continuity engine. The cache keeps only
 * the most recent resolved layout for the mounted screen. A stable input
 * signature makes render retries idempotent: React can render the same snapshot
 * more than once without repeatedly applying the damping function.
 */
export function useStableSpatialLayout(
  targets: Array<ProximitySignal & { bucket?: number }>,
): SpatialContinuityResult {
  const rawLayout = useMemo(() => buildSpatialLayout(targets), [targets]);
  const signature = signatureFor(targets);
  const cacheRef = useRef<CacheState | null>(null);

  if (!cacheRef.current || cacheRef.current.signature !== signature) {
    const result = stabilizeSpatialLayout(rawLayout, cacheRef.current?.layout ?? []);
    cacheRef.current = { signature, layout: result.layout, result };
  }

  return cacheRef.current.result;
}
