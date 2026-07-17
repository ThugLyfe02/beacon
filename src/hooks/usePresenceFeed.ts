import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { getEventProximitySignals } from '../services/proximity.service';
import { pushMyLocation } from '../services/premium.service';
import { countSentConnectionRequests, listMatches } from '../services/match.service';
import { requestLocationPermission } from '../services/location.service';
import type { ProximitySignal } from '../presence/PresenceEngine';
import {
  classifyRuntimeReliability,
  computeRetryDelayMs,
  shouldDiscardPresence,
  type RuntimeReliabilitySnapshot,
} from '../reliability/RuntimeReliabilityEngine';

export interface PresenceFeed {
  rawSignals: ProximitySignal[];
  signalsSent: number;
  mutualMatches: number;
  lastError: string | null;
  hasLocation: boolean;
  lastUpdatedAt: number | null;
  runtime: RuntimeReliabilitySnapshot;
  refreshNow: () => void;
}

interface FeedState {
  rawSignals: ProximitySignal[];
  signalsSent: number;
  mutualMatches: number;
  lastError: string | null;
  hasLocation: boolean;
  lastUpdatedAt: number | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  consecutiveFailures: number;
  permissionGranted: boolean | null;
}

const HEALTHY_POLL_INTERVAL_MS = 5_000;

function initialFeedState(): FeedState {
  return {
    rawSignals: [],
    signalsSent: 0,
    mutualMatches: 0,
    lastError: null,
    hasLocation: false,
    lastUpdatedAt: null,
    lastAttemptAt: null,
    nextRetryAt: null,
    consecutiveFailures: 0,
    permissionGranted: null,
  };
}

/**
 * Lifecycle-aware foreground presence feed.
 *
 * Key properties:
 * - never overlaps polling requests;
 * - pauses cleanly when the app backgrounds;
 * - refreshes immediately when the app returns;
 * - preserves the last verified snapshot during short outages;
 * - expires stale proximity data rather than presenting it as live;
 * - uses bounded exponential backoff with jitter after failures.
 */
export function usePresenceFeed(eventId: string, observerId: string): PresenceFeed {
  const [feed, setFeed] = useState<FeedState>(initialFeedState);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permissionRef = useRef<boolean | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (nextState === 'active') setRefreshEpoch((value) => value + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    if (!eventId || !observerId) {
      setFeed(initialFeedState());
      return;
    }

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    if (appState !== 'active') {
      clearTimer();
      return () => {
        cancelledRef.current = true;
        clearTimer();
      };
    }

    const schedule = (delayMs: number) => {
      clearTimer();
      if (!cancelledRef.current) timerRef.current = setTimeout(tick, delayMs);
    };

    async function ensurePermission(): Promise<boolean> {
      if (permissionRef.current != null) return permissionRef.current;
      const granted = await requestLocationPermission();
      permissionRef.current = granted;
      setFeed((current) => ({ ...current, permissionGranted: granted }));
      return granted;
    }

    async function tick() {
      if (cancelledRef.current || inFlightRef.current || appState !== 'active') return;
      inFlightRef.current = true;
      const attemptedAt = Date.now();
      setFeed((current) => ({ ...current, lastAttemptAt: attemptedAt }));

      try {
        const granted = await ensurePermission();
        if (!granted) {
          setFeed((current) => ({
            ...current,
            lastError: 'Location permission denied',
            hasLocation: false,
            nextRetryAt: null,
            permissionGranted: false,
          }));
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        });
        const latitude = location.coords.latitude;
        const longitude = location.coords.longitude;

        await pushMyLocation(observerId, latitude, longitude);

        const [signals, signalsSent, matches] = await Promise.all([
          getEventProximitySignals(eventId, observerId, latitude, longitude),
          countSentConnectionRequests(eventId, observerId),
          listMatches(eventId, observerId),
        ]);

        if (cancelledRef.current) return;
        const completedAt = Date.now();
        setFeed({
          rawSignals: signals,
          signalsSent,
          mutualMatches: matches.data.length,
          lastError: null,
          hasLocation: true,
          lastUpdatedAt: completedAt,
          lastAttemptAt: attemptedAt,
          nextRetryAt: completedAt + HEALTHY_POLL_INTERVAL_MS,
          consecutiveFailures: 0,
          permissionGranted: true,
        });
        schedule(HEALTHY_POLL_INTERVAL_MS);
      } catch (error) {
        if (cancelledRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setFeed((current) => {
          const failures = current.consecutiveFailures + 1;
          const delay = computeRetryDelayMs(failures);
          const discard = shouldDiscardPresence(current.lastUpdatedAt);
          return {
            ...current,
            rawSignals: discard ? [] : current.rawSignals,
            lastError: message,
            hasLocation: discard ? false : current.hasLocation,
            consecutiveFailures: failures,
            nextRetryAt: Date.now() + delay,
          };
        });
        const nextFailureCount = feed.consecutiveFailures + 1;
        schedule(computeRetryDelayMs(nextFailureCount));
      } finally {
        inFlightRef.current = false;
      }
    }

    tick();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [appState, eventId, observerId, refreshEpoch]);

  const runtime = useMemo(
    () => classifyRuntimeReliability({
      appActive: appState === 'active',
      permissionGranted: feed.permissionGranted,
      consecutiveFailures: feed.consecutiveFailures,
      lastSuccessAt: feed.lastUpdatedAt,
      lastAttemptAt: feed.lastAttemptAt,
      nextRetryAt: feed.nextRetryAt,
      lastError: feed.lastError,
    }),
    [appState, feed],
  );

  return {
    rawSignals: feed.rawSignals,
    signalsSent: feed.signalsSent,
    mutualMatches: feed.mutualMatches,
    lastError: feed.lastError,
    hasLocation: feed.hasLocation,
    lastUpdatedAt: feed.lastUpdatedAt,
    runtime,
    refreshNow: () => setRefreshEpoch((value) => value + 1),
  };
}
