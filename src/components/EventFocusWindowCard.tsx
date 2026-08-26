import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';
import {
  EVENT_FOCUS_WINDOW_FORMAT_LABELS,
  getMyEventFocusWindows,
  setMyEventFocusWindowOptIn,
  type ParticipantEventFocusWindow,
} from '../services/event-focus-window.service';

interface Props {
  eventId: string;
}

const REFRESH_INTERVAL_MS = 30_000;

function relativeTime(value: string, now: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  const deltaMinutes = Math.round((timestamp - now) / 60_000);
  if (Math.abs(deltaMinutes) < 1) return 'now';
  if (deltaMinutes > 0) return `in ${deltaMinutes}m`;
  return `${Math.abs(deltaMinutes)}m ago`;
}

function relevanceCopy(window: ParticipantEventFocusWindow): string {
  const domain = EVENT_INTENT_LABELS[window.intent_key];
  if (window.relevance === 'both') {
    return `${domain} is in both sides of your event focus.`;
  }
  if (window.relevance === 'seeking') {
    return `You explicitly said you are looking for help with ${domain}.`;
  }
  return `You explicitly said you can help with ${domain}.`;
}

function phaseLabel(window: ParticipantEventFocusWindow): string {
  return window.phase === 'live' ? 'LIVE NOW' : 'UPCOMING';
}

/**
 * Participant-facing bridge from declared intent to a real place and time.
 *
 * The server returns only windows relevant to the caller's own explicit event
 * focus. Joining is a separate participant-owned action; a declaration alone
 * never enrolls someone or exposes them to the host as an individual.
 */
export default function EventFocusWindowCard({ eventId }: Readonly<Props>) {
  const [windows, setWindows] = useState<ParticipantEventFocusWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingWindowId, setWorkingWindowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const result = await getMyEventFocusWindows(eventId);
    if (result.error) {
      setError('Live sessions could not refresh. Beacon will retry automatically.');
      if (!quiet) setWindows([]);
    } else {
      setError(null);
      setWindows(result.data);
    }
    if (!quiet) setLoading(false);
  }, [eventId]);

  useEffect(() => {
    refresh(false);
    const timer = setInterval(() => {
      setClock(Date.now());
      refresh(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const ordered = useMemo(
    () => [...windows].sort((left, right) => {
      if (left.phase !== right.phase) return left.phase === 'live' ? -1 : 1;
      if (left.is_joined !== right.is_joined) return left.is_joined ? -1 : 1;
      return Date.parse(left.starts_at) - Date.parse(right.starts_at)
        || left.window_id.localeCompare(right.window_id);
    }),
    [windows],
  );

  const setJoined = useCallback(async (window: ParticipantEventFocusWindow, join: boolean) => {
    setWorkingWindowId(window.window_id);
    setError(null);
    const result = await setMyEventFocusWindowOptIn(window.window_id, join);
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'Could not update this session.');
      setWorkingWindowId(null);
      return;
    }

    setWindows((current) => current.map((item) => (
      item.window_id === window.window_id
        ? {
            ...item,
            joined_count: result.data!.joined_count,
            spots_remaining: result.data!.spots_remaining,
            is_joined: result.data!.is_joined,
          }
        : item
    )));
    setWorkingWindowId(null);
  }, []);

  if (loading && windows.length === 0) {
    return (
      <View style={styles.loadingCard}>
        <ActivityIndicator color="#22D3EE" />
        <Text style={styles.loadingText}>Checking live sessions tied to your event focus…</Text>
      </View>
    );
  }

  if (windows.length === 0 && !error) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>EVENT FOCUS WINDOWS</Text>
          <Text style={styles.title}>A real place for the conversation.</Text>
        </View>
        <Text style={styles.count}>{windows.length}</Text>
      </View>

      <Text style={styles.intro}>
        These sessions appear because they intersect with selections you explicitly made for this event. You are never enrolled until you choose to join.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.windowList}>
        {ordered.slice(0, 4).map((window) => {
          const full = window.spots_remaining <= 0 && !window.is_joined;
          const working = workingWindowId === window.window_id;
          const startCopy = window.phase === 'live'
            ? `ends ${relativeTime(window.ends_at, clock)}`
            : `starts ${relativeTime(window.starts_at, clock)}`;
          return (
            <View key={window.window_id} style={[styles.window, window.is_joined && styles.windowJoined]}>
              <View style={styles.windowTopRow}>
                <View style={styles.windowTopCopy}>
                  <View style={styles.badgeRow}>
                    <Text style={[styles.phase, window.phase === 'live' && styles.phaseLive]}>
                      {phaseLabel(window)}
                    </Text>
                    <Text style={styles.format}>
                      {EVENT_FOCUS_WINDOW_FORMAT_LABELS[window.format].toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.windowTitle}>{window.title}</Text>
                </View>
                {window.is_joined ? <Text style={styles.joined}>JOINED</Text> : null}
              </View>

              <Text style={styles.meta}>
                {EVENT_INTENT_LABELS[window.intent_key]} · {window.location_label} · {startCopy}
              </Text>
              <Text style={styles.relevance}>{relevanceCopy(window)}</Text>

              <View style={styles.actionRow}>
                <View style={styles.capacityCopy}>
                  <Text style={styles.capacityValue}>{window.joined_count}/{window.capacity}</Text>
                  <Text style={styles.capacityLabel}>
                    {window.spots_remaining > 0
                      ? `${window.spots_remaining} real ${window.spots_remaining === 1 ? 'place' : 'places'} remain`
                      : 'at capacity'}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: working || full, selected: window.is_joined }}
                  disabled={working || full}
                  onPress={() => setJoined(window, !window.is_joined)}
                  style={({ pressed }) => [
                    styles.button,
                    window.is_joined && styles.buttonLeave,
                    (working || full) && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={[styles.buttonText, window.is_joined && styles.buttonTextLeave]}>
                    {working ? 'UPDATING…' : window.is_joined ? 'LEAVE' : full ? 'FULL' : 'JOIN WINDOW'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.boundary}>
        Capacity is the host’s actual configured limit, not artificial scarcity. The host receives aggregate participation and cohort-gated outcomes—not a list of everyone whose declared focus matched this domain.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    marginTop: 16,
    minHeight: 74,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.16)',
    backgroundColor: '#0D1520',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  loadingText: { flex: 1, color: '#94A3B8', fontSize: 12, lineHeight: 17 },
  card: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: '#0B1721',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.22)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#67E8F9', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 5, color: '#F8FAFC', fontSize: 18, lineHeight: 23, fontWeight: '800' },
  count: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: '#CFFAFE',
    backgroundColor: 'rgba(8,145,178,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 28,
  },
  intro: { marginTop: 9, color: '#94A3B8', fontSize: 11, lineHeight: 17 },
  error: { marginTop: 10, color: '#FCA5A5', fontSize: 11, lineHeight: 16 },
  windowList: { marginTop: 12, gap: 10 },
  window: {
    borderRadius: 17,
    padding: 14,
    backgroundColor: 'rgba(15,23,42,0.74)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
  },
  windowJoined: { borderColor: 'rgba(34,211,238,0.38)', backgroundColor: 'rgba(8,47,73,0.34)' },
  windowTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  windowTopCopy: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  phase: { color: '#A5B4FC', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  phaseLive: { color: '#86EFAC' },
  format: { color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  windowTitle: { marginTop: 6, color: '#F8FAFC', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  joined: { color: '#67E8F9', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  meta: { marginTop: 7, color: '#CBD5E1', fontSize: 10, lineHeight: 15 },
  relevance: { marginTop: 5, color: '#7DD3FC', fontSize: 10, lineHeight: 15 },
  actionRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  capacityCopy: { flex: 1 },
  capacityValue: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  capacityLabel: { marginTop: 2, color: '#64748B', fontSize: 9, lineHeight: 13 },
  button: {
    minHeight: 36,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(8,145,178,0.22)',
    borderWidth: 1,
    borderColor: '#22D3EE',
  },
  buttonLeave: { backgroundColor: 'transparent', borderColor: 'rgba(148,163,184,0.34)' },
  buttonDisabled: { opacity: 0.38 },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: '#CFFAFE', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  buttonTextLeave: { color: '#CBD5E1' },
  boundary: { marginTop: 12, color: '#64748B', fontSize: 9, lineHeight: 14 },
});
