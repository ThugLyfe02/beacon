import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

const SMOOTHING = 0.22;

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Subscribes to the device compass heading (0=N, 90=E).
 *
 * Heading is smoothed in vector space so 359° -> 0° does not create a visual
 * jump. The subscription can be disabled when no directional surface is active,
 * which avoids keeping the compass hot merely because the spatial screen exists.
 * This signal is local-only and is not persisted or sent to Beacon services.
 */
export function useHeading(enabled = true): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const vectorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      vectorRef.current = null;
      setHeading(null);
      return;
    }

    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      sub = await Location.watchHeadingAsync((sample) => {
        const raw = sample.trueHeading >= 0 ? sample.trueHeading : sample.magHeading;
        if (!Number.isFinite(raw)) return;
        const radians = normalizeDegrees(raw) * Math.PI / 180;
        const next = { x: Math.cos(radians), y: Math.sin(radians) };
        const previous = vectorRef.current;
        const smoothed = previous
          ? {
              x: previous.x * (1 - SMOOTHING) + next.x * SMOOTHING,
              y: previous.y * (1 - SMOOTHING) + next.y * SMOOTHING,
            }
          : next;
        const length = Math.hypot(smoothed.x, smoothed.y) || 1;
        vectorRef.current = { x: smoothed.x / length, y: smoothed.y / length };
        const degrees = normalizeDegrees(Math.atan2(vectorRef.current.y, vectorRef.current.x) * 180 / Math.PI);
        setHeading(degrees);
      });
    })();

    return () => {
      cancelled = true;
      vectorRef.current = null;
      sub?.remove();
    };
  }, [enabled]);

  return heading;
}
