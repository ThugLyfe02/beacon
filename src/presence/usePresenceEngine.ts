import { useEffect, useMemo, useState } from 'react';
import {
  ProximitySignal,
  calculateBucket,
  computeOpportunityDensity,
  computeTensionScore,
  computeMomentum
} from './ProximityEngine';

export function usePresenceEngine({
  rawSignals,
  premiumNearby,
  eventEnd,
  signalsSent,
  mutualMatches,
  officeHoursActive
}: {
  rawSignals: ProximitySignal[];
  premiumNearby: number;
  eventEnd: string;
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}) {
  const [signals, setSignals] = useState<any[]>([]);

  useEffect(() => {
    const enriched = rawSignals.map(s => ({
      ...s,
      bucket: calculateBucket(s.distanceFeet)
    }));
    setSignals(enriched);
  }, [rawSignals]);

  const density = useMemo(
    () => computeOpportunityDensity(signals),
    [signals]
  );

  const timeRemaining = useMemo(() => {
    const diff =
      new Date(eventEnd).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 60000));
  }, [eventEnd]);

  const tensionScore = useMemo(
    () =>
      computeTensionScore(
        density,
        premiumNearby,
        timeRemaining
      ),
    [density, premiumNearby, timeRemaining]
  );

  const momentumScore = useMemo(
    () =>
      computeMomentum(
        signalsSent,
        mutualMatches,
        officeHoursActive
      ),
    [signalsSent, mutualMatches, officeHoursActive]
  );

  const visibleAvatars = useMemo(
    () => signals.filter(s => s.bucket > 0),
    [signals]
  );

  return {
    signals,
    visibleAvatars,
    density,
    tensionScore,
    momentumScore,
    timeRemaining
  };
}
