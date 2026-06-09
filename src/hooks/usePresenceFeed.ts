import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { getEventProximitySignals } from '../services/proximity.service';
import { pushMyLocation } from '../services/premium.service';
import { countSentConnectionRequests, listMatches } from '../services/match.service';
import { requestLocationPermission } from '../services/location.service';
import type { ProximitySignal } from '../presence/PresenceEngine';

export interface PresenceFeed {
  rawSignals: ProximitySignal[];
  signalsSent: number;
  mutualMatches: number;
  lastError: string | null;
  hasLocation: boolean;
}

const POLL_INTERVAL_MS = 5000;

/**
 * Foreground polling feed for an event's PresenceEngine.
 * Pushes the observer's own location each tick and pulls peer positions.
 * Stops polling on unmount.
 */
export function usePresenceFeed(eventId: string, observerId: string): PresenceFeed {
  const [feed, setFeed] = useState<PresenceFeed>({
    rawSignals: [],
    signalsSent: 0,
    mutualMatches: 0,
    lastError: null,
    hasLocation: false,
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!eventId || !observerId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelledRef.current) return;
      try {
        const granted = await requestLocationPermission();
        if (!granted) {
          setFeed((f) => ({ ...f, lastError: 'Location permission denied', hasLocation: false }));
        } else {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;

          await pushMyLocation(observerId, lat, lng);

          const [signals, signalsSent, matches] = await Promise.all([
            getEventProximitySignals(eventId, observerId, lat, lng),
            countSentConnectionRequests(eventId, observerId),
            listMatches(eventId, observerId),
          ]);

          if (cancelledRef.current) return;
          setFeed({
            rawSignals: signals,
            signalsSent,
            mutualMatches: matches.data.length,
            lastError: null,
            hasLocation: true,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (cancelledRef.current) return;
        setFeed((f) => ({ ...f, lastError: message }));
      } finally {
        if (!cancelledRef.current) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      }
    }

    tick();

    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [eventId, observerId]);

  return feed;
}
