import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

/**
 * Subscribes to the device's true compass heading (0=N, 90=E).
 * Returns null until the first reading arrives.
 */
export function useHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      sub = await Location.watchHeadingAsync((h) => {
        // Prefer the true heading when calibrated; fall back to magnetic.
        const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
        setHeading(v);
      });
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return heading;
}
