import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';
import {
  EVENT_FOCUS_WINDOW_FORMATS,
  EVENT_FOCUS_WINDOW_FORMAT_LABELS,
  createEventFocusWindow,
  getHostEventFocusWindowOutcomes,
  getHostEventFocusWindows,
  getMyFocusWindowPlaybook,
  setHostEventFocusWindowState,
  type EventFocusWindowFormat,
  type EventFocusWindowOutcome,
  type EventFocusWindowPlaybookRow,
  type HostEventFocusWindow,
} from '../services/event-focus-window.service';
import type { EventIntentProgrammingAction } from '../spatial/EventIntentProgramming';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  programming: EventIntentProgrammingAction[];
}

const START_DELAY_OPTIONS = [5, 15, 30] as const;
const DURATION_OPTIONS = [20, 30, 45] as const;
const REFRESH_INTERVAL_MS = 30_000;

type Tone = 'success' | 'warning' | 'premium' | 'neutral' | 'danger';

function formatTone(format: EventFocusWindowFormat): Tone {
  if (format === 'mentor-desk') return 'premium';
  if (format === 'office-hours') return 'warning';
  if (format === 'roundtable') return 'accent' as Tone;
  return 'neutral';
}

function phaseTone(phase: HostEventFocusWindow['phase']): Tone {
  if (phase === 'live') return 'success';
  if (phase === 'cancelled') return 'danger';
  if (phase === 'closed' || phase === 'ended') return 'neutral';
  return 'warning';
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function defaultWindowTitle(action: EventIntentProgrammingAction, format: EventFocusWindowFormat): string {
  const domain = EVENT_INTENT_LABELS[action.intentKey];
  if (format === 'mentor-desk') return `${domain} mentor desk`;
  if (format === 'office-hours') return `${domain} office hours`;
  if (format === 'roundtable') return `${domain} roundtable`;
  return `${domain} open circle`;
}

function timeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Host control surface for turning a released aggregate programming need into a
 * real opt-in event session. It never receives a participant roster. Publishing,
 * participant enrollment, outcome measurement, and historical learning remain
 * separate server decisions.
 */
export default function HostFocusWindowPanel({ eventId, programming }: Readonly<Props>) {
  const eligibleActions = useMemo(
    () => programming.filter((action) => action.canOpenWindow && action.recommendedWindowFormat != null),
    [programming],
  );
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [format, setFormat] = useState<EventFocusWindowFormat>('roundtable');
  const [title, setTitle] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [capacityText, setCapacityText] = useState('12');
  const [startDelayMinutes, setStartDelayMinutes] = useState<(typeof START_DELAY_OPTIONS)[number]>(15);
  const [durationMinutes, setDurationMinutes] = useState<(typeof DURATION_OPTIONS)[number]>(30);
  const [windows, setWindows] = useState<HostEventFocusWindow[]>([]);
  const [outcomes, setOutcomes] = useState<EventFocusWindowOutcome[]>([]);
  const [playbook, setPlaybook] = useState<EventFocusWindowPlaybookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAction = useMemo(
    () => eligibleActions.find((action) => action.id === selectedActionId) ?? eligibleActions[0] ?? null,
    [eligibleActions, selectedActionId],
  );

  const outcomeByWindow = useMemo(
    () => new Map(outcomes.map((outcome) => [outcome.window_id, outcome] as const)),
    [outcomes],
  );

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [windowResult, outcomeResult, playbookResult] = await Promise.all([
      getHostEventFocusWindows(eventId),
      getHostEventFocusWindowOutcomes(eventId),
      getMyFocusWindowPlaybook(),
    ]);

    const firstError = windowResult.error ?? outcomeResult.error ?? playbookResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setError(null);
    }
    if (!windowResult.error) setWindows(windowResult.data);
    if (!outcomeResult.error) setOutcomes(outcomeResult.data);
    if (!playbookResult.error) setPlaybook(playbookResult.data);
    if (!quiet) setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (eligibleActions.length === 0) {
      setSelectedActionId(null);
      return;
    }
    if (!selectedActionId || !eligibleActions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId(eligibleActions[0].id);
    }
  }, [eligibleActions, selectedActionId]);

  useEffect(() => {
    if (!selectedAction) return;
    const nextFormat = selectedAction.recommendedWindowFormat ?? 'roundtable';
    setFormat(nextFormat);
    setTitle(defaultWindowTitle(selectedAction, nextFormat));
  }, [selectedAction?.id]);

  const publish = useCallback(async () => {
    if (!selectedAction) return;
    const capacity = Number.parseInt(capacityText, 10);
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the session a clear participant-facing title.');
      return;
    }
    if (!locationLabel.trim()) {
      Alert.alert('Location required', 'Use a physical location label such as West Lounge or Table 8.');
      return;
    }
    if (!Number.isFinite(capacity) || capacity < 4 || capacity > 80) {
      Alert.alert('Capacity required', 'Use a real capacity between 4 and 80. Beacon does not invent scarcity.');
      return;
    }

    const startsAt = new Date(Date.now() + startDelayMinutes * 60_000);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    setWorking(true);
    setError(null);
    const result = await createEventFocusWindow({
      eventId,
      intentKey: selectedAction.intentKey,
      format,
      title: title.trim(),
      locationLabel: locationLabel.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity,
    });
    if (result.error || !result.data) {
      setError(result.error?.message ?? 'The focus window was not published.');
      setWorking(false);
      return;
    }

    await load(true);
    setWorking(false);
    Alert.alert(
      'Focus window published',
      'Only participants whose own explicit event focus intersects with this domain can see it. Nobody is enrolled automatically.',
    );
  }, [
    capacityText,
    durationMinutes,
    eventId,
    format,
    load,
    locationLabel,
    selectedAction,
    startDelayMinutes,
    title,
  ]);

  const changeState = useCallback((window: HostEventFocusWindow, state: 'closed' | 'cancelled') => {
    const verb = state === 'closed' ? 'Close' : 'Cancel';
    Alert.alert(
      `${verb} focus window?`,
      state === 'closed'
        ? 'The session stops accepting opt-ins. Aggregate outcome observation remains available after the measurement window.'
        : 'The session disappears from participant guidance and is excluded from outcome learning.',
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: verb,
          style: state === 'cancelled' ? 'destructive' : 'default',
          onPress: async () => {
            setWorking(true);
            const result = await setHostEventFocusWindowState(window.window_id, state);
            if (result.error || !result.changed) {
              setError(result.error?.message ?? `Could not ${state} this focus window.`);
            } else {
              await load(true);
            }
            setWorking(false);
          },
        },
      ],
    );
  }, [load]);

  const openWindows = windows.filter((window) => window.state === 'published' && (window.phase === 'upcoming' || window.phase === 'live'));
  const historicalWindows = windows.filter((window) => !openWindows.some((open) => open.window_id === window.window_id));

  return (
    <View style={styles.wrap}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="accent">FOCUS WINDOWS</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Turn a released aggregate need into a real, time-bounded place—without targeting individual participants.
          </NeonText>
        </View>
        <Pill label={`${openWindows.length} OPEN`} tone={openWindows.length > 0 ? 'success' : 'neutral'} />
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">FOCUS WINDOW CONTROL DEGRADED</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      {eligibleActions.length > 0 ? (
        <Surface elevated padded style={styles.publisherCard}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <NeonText variant="label" tone="premium">PUBLISH FROM RELEASED EVIDENCE</NeonText>
              <NeonText variant="h2" style={styles.smallTop}>Create a participant-owned opt-in window</NeonText>
            </View>
            {selectedAction ? (
              <Pill label={EVENT_INTENT_LABELS[selectedAction.intentKey].toUpperCase()} tone="premium" />
            ) : null}
          </View>

          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Beacon enables this control only when the cohort-gated programming read shows real declared supply. A recommendation alone is not enough.
          </NeonText>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>EVIDENCE-BACKED DOMAIN</NeonText>
          <View style={styles.chipRow}>
            {eligibleActions.slice(0, 6).map((action) => (
              <Pressable
                key={action.id}
                disabled={working}
                onPress={() => setSelectedActionId(action.id)}
                style={[styles.chip, selectedAction?.id === action.id && styles.chipActive]}
              >
                <NeonText variant="label" tone={selectedAction?.id === action.id ? 'accent' : 'muted'}>
                  {EVENT_INTENT_LABELS[action.intentKey]}
                </NeonText>
              </Pressable>
            ))}
          </View>

          {selectedAction ? (
            <Surface padded style={styles.evidenceCard}>
              <NeonText variant="label" tone="accent">WHY THIS CONTROL IS AVAILABLE</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>{selectedAction.windowReason}</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                Evidence weight {Math.round(selectedAction.priority * 100)} / 100 · human publication required
              </NeonText>
            </Surface>
          ) : null}

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>FORMAT</NeonText>
          <View style={styles.chipRow}>
            {EVENT_FOCUS_WINDOW_FORMATS.map((value) => (
              <Pressable
                key={value}
                disabled={working}
                onPress={() => {
                  setFormat(value);
                  if (selectedAction) setTitle(defaultWindowTitle(selectedAction, value));
                }}
                style={[styles.chip, format === value && styles.chipActive]}
              >
                <NeonText variant="label" tone={format === value ? formatTone(value) : 'muted'}>
                  {EVENT_FOCUS_WINDOW_FORMAT_LABELS[value]}
                </NeonText>
              </Pressable>
            ))}
          </View>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>PARTICIPANT-FACING TITLE</NeonText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            editable={!working}
            maxLength={120}
            placeholder="Capital office hours"
            placeholderTextColor={palette.textDim}
            style={styles.input}
          />

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>PHYSICAL LOCATION</NeonText>
          <TextInput
            value={locationLabel}
            onChangeText={setLocationLabel}
            editable={!working}
            maxLength={120}
            placeholder="West Lounge · Table 8"
            placeholderTextColor={palette.textDim}
            style={styles.input}
          />

          <View style={styles.twoColumn}>
            <View style={styles.column}>
              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>START</NeonText>
              <View style={styles.chipRow}>
                {START_DELAY_OPTIONS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    disabled={working}
                    onPress={() => setStartDelayMinutes(minutes)}
                    style={[styles.smallChip, startDelayMinutes === minutes && styles.chipActive]}
                  >
                    <NeonText variant="label" tone={startDelayMinutes === minutes ? 'accent' : 'muted'}>+{minutes}M</NeonText>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.column}>
              <NeonText variant="label" tone="muted" style={styles.fieldLabel}>DURATION</NeonText>
              <View style={styles.chipRow}>
                {DURATION_OPTIONS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    disabled={working}
                    onPress={() => setDurationMinutes(minutes)}
                    style={[styles.smallChip, durationMinutes === minutes && styles.chipActive]}
                  >
                    <NeonText variant="label" tone={durationMinutes === minutes ? 'accent' : 'muted'}>{minutes}M</NeonText>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <NeonText variant="label" tone="muted" style={styles.fieldLabel}>REAL CAPACITY</NeonText>
          <TextInput
            value={capacityText}
            onChangeText={setCapacityText}
            editable={!working}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="12"
            placeholderTextColor={palette.textDim}
            style={styles.input}
          />

          <Pressable
            accessibilityRole="button"
            disabled={working || !selectedAction}
            onPress={publish}
            style={[styles.publishButton, (working || !selectedAction) && styles.disabled]}
          >
            <NeonText variant="label" tone="accent">
              {working ? 'VALIDATING…' : 'PUBLISH FOCUS WINDOW'}
            </NeonText>
          </Pressable>

          <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
            Publication does not enroll or identify anyone. Participants see the window only when it intersects with their own explicit event focus, and joining remains their separate action.
          </NeonText>
        </Surface>
      ) : (
        <Surface padded style={styles.noActionCard}>
          <NeonText variant="h2">No new focus window is justified right now.</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Beacon will not turn a balanced cohort, an observation-only read, or unsupported demand into artificial programming. Existing windows and historical evidence remain visible below.
          </NeonText>
        </Surface>
      )}

      {loading && windows.length === 0 ? (
        <Surface padded style={styles.noActionCard}>
          <NeonText variant="bodyMuted">Loading published focus windows…</NeonText>
        </Surface>
      ) : null}

      {openWindows.length > 0 ? (
        <View style={styles.listSection}>
          <NeonText variant="label" tone="accent">OPEN WINDOWS</NeonText>
          {openWindows.map((window) => (
            <Surface key={window.window_id} elevated padded style={styles.windowCard}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="h2">{window.title}</NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>
                    {EVENT_INTENT_LABELS[window.intent_key]} · {EVENT_FOCUS_WINDOW_FORMAT_LABELS[window.format]} · {window.location_label}
                  </NeonText>
                </View>
                <Pill label={window.phase.toUpperCase()} tone={phaseTone(window.phase)} />
              </View>
              <View style={styles.windowMetrics}>
                <View>
                  <NeonText variant="label" tone="muted">TIME</NeonText>
                  <NeonText variant="h2">{timeLabel(window.starts_at)}–{timeLabel(window.ends_at)}</NeonText>
                </View>
                <View>
                  <NeonText variant="label" tone="muted">OPTED IN</NeonText>
                  <NeonText variant="h2">{window.joined_count}/{window.capacity}</NeonText>
                </View>
              </View>
              <View style={styles.windowActions}>
                <Pressable disabled={working} onPress={() => changeState(window, 'closed')} style={styles.secondaryButton}>
                  <NeonText variant="label" tone="accent">CLOSE & OBSERVE</NeonText>
                </Pressable>
                <Pressable disabled={working} onPress={() => changeState(window, 'cancelled')} style={styles.cancelButton}>
                  <NeonText variant="label" tone="danger">CANCEL</NeonText>
                </Pressable>
              </View>
            </Surface>
          ))}
        </View>
      ) : null}

      {historicalWindows.length > 0 ? (
        <View style={styles.listSection}>
          <NeonText variant="label" tone="accent">RECENT WINDOW EVIDENCE</NeonText>
          {historicalWindows.slice(0, 5).map((window) => {
            const outcome = outcomeByWindow.get(window.window_id);
            return (
              <Surface key={window.window_id} padded style={styles.windowCard}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{window.title}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      {EVENT_INTENT_LABELS[window.intent_key]} · {window.joined_count}/{window.capacity} opted in
                    </NeonText>
                  </View>
                  <Pill label={window.phase.toUpperCase()} tone={phaseTone(window.phase)} />
                </View>
                {outcome?.supported ? (
                  <View style={styles.outcomeRow}>
                    <View style={styles.outcomeMetric}>
                      <NeonText variant="label" tone="muted">NEW MUTUALS</NeonText>
                      <NeonText variant="h1">{outcome.new_mutual_count ?? 0}</NeonText>
                    </View>
                    <View style={styles.outcomeMetric}>
                      <NeonText variant="label" tone="muted">PARTICIPANTS WITH OUTCOME</NeonText>
                      <NeonText variant="h1" tone="accent">{percent(outcome.participant_outcome_share)}</NeonText>
                    </View>
                  </View>
                ) : (
                  <NeonText variant="bodyMuted" style={styles.smallTop}>
                    Outcome counts stay suppressed until at least five participants explicitly opt in. This window cannot become host learning from a small cohort.
                  </NeonText>
                )}
              </Surface>
            );
          })}
          <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
            These are observational outcomes within a bounded session window—not causal proof that the session created a mutual connection.
          </NeonText>
        </View>
      ) : null}

      {playbook.length > 0 ? (
        <Surface elevated padded style={styles.playbookCard}>
          <NeonText variant="label" tone="premium">REPEAT-EVENT PLAYBOOK</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>Patterns earned across real ended events</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            A pattern appears only after at least three supported windows across at least two events. It can influence what the host considers—not auto-publish future programming.
          </NeonText>
          <View style={styles.playbookList}>
            {playbook.slice(0, 4).map((row) => (
              <View key={`${row.intent_key}:${row.format}`} style={styles.playbookRow}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="h2">
                    {EVENT_INTENT_LABELS[row.intent_key]} · {EVENT_FOCUS_WINDOW_FORMAT_LABELS[row.format]}
                  </NeonText>
                  <NeonText variant="bodyMuted" style={styles.smallTop}>
                    {row.supported_window_count} supported windows across {row.event_count} events · {row.opt_in_count} aggregate opt-ins
                  </NeonText>
                </View>
                <View style={styles.playbookScore}>
                  <NeonText variant="label" tone="muted">OUTCOME SHARE</NeonText>
                  <NeonText variant="h1" tone="premium">{percent(row.participant_outcome_share)}</NeonText>
                </View>
              </View>
            ))}
          </View>
        </Surface>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  errorCard: { borderRadius: radii.lg, borderColor: palette.danger },
  publisherCard: { borderRadius: radii.xl, borderColor: palette.accentDim },
  noActionCard: { borderRadius: radii.lg },
  fieldLabel: { marginTop: spacing.lg },
  chipRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  smallChip: {
    minHeight: 34,
    minWidth: 50,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  evidenceCard: { marginTop: spacing.md, borderRadius: radii.md, borderColor: palette.accentDim },
  input: {
    marginTop: spacing.sm,
    minHeight: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    color: palette.text,
    fontSize: 14,
  },
  twoColumn: { flexDirection: 'row', gap: spacing.md },
  column: { flex: 1 },
  publishButton: {
    minHeight: 50,
    marginTop: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  disabled: { opacity: 0.4 },
  boundaryCopy: { marginTop: spacing.sm, fontSize: 10, lineHeight: 15 },
  listSection: { gap: spacing.sm },
  windowCard: { borderRadius: radii.lg },
  windowMetrics: { marginTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  windowActions: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  secondaryButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  cancelButton: {
    minWidth: 88,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.danger,
    backgroundColor: palette.dangerSoft,
  },
  outcomeRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  outcomeMetric: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  playbookCard: { borderRadius: radii.xl, borderColor: palette.premiumSoft },
  playbookList: { marginTop: spacing.md, gap: spacing.sm },
  playbookRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  playbookScore: { alignItems: 'flex-end' },
});
