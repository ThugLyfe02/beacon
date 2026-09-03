import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import {
  EVENT_INTENT_LABELS,
  type EventIntentKey,
} from '../services/event-intent.service';
import { getMyEventPlaybook } from '../services/participant-event-playbook.service';
import {
  buildParticipantEventPlaybook,
  type ParticipantPlaybookMode,
  type ParticipantPlaybookSuggestion,
  type ParticipantPlaybookTier,
} from '../intents/ParticipantEventPlaybook';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  seeking: EventIntentKey[];
  offering: EventIntentKey[];
  onApply: (intentKey: EventIntentKey, mode: ParticipantPlaybookMode) => void;
}

type PillTone = 'success' | 'premium' | 'neutral';

function tierTone(tier: ParticipantPlaybookTier): PillTone {
  if (tier === 'established') return 'success';
  if (tier === 'supported') return 'premium';
  return 'neutral';
}

function tierLabel(tier: ParticipantPlaybookTier): string {
  if (tier === 'established') return 'REPEATED';
  if (tier === 'supported') return 'SUPPORTED';
  return 'BUILDING';
}

function modeLabel(mode: ParticipantPlaybookMode): string {
  if (mode === 'seeking') return 'LOOKING FOR';
  if (mode === 'offering') return 'CAN HELP';
  return 'BOTH SIDES';
}

function applicationState(input: {
  suggestion: ParticipantPlaybookSuggestion;
  seeking: EventIntentKey[];
  offering: EventIntentKey[];
}): { disabled: boolean; label: string; explanation: string | null } {
  const { suggestion, seeking, offering } = input;
  const hasSeeking = seeking.includes(suggestion.intentKey);
  const hasOffering = offering.includes(suggestion.intentKey);
  const needsSeeking = suggestion.mode !== 'offering' && !hasSeeking;
  const needsOffering = suggestion.mode !== 'seeking' && !hasOffering;

  if (!needsSeeking && !needsOffering) {
    return { disabled: true, label: 'ALREADY IN DRAFT', explanation: null };
  }
  if (!suggestion.mayApplyToDraft) {
    return {
      disabled: true,
      label: 'MORE HISTORY NEEDED',
      explanation: 'Beacon can show the evidence, but it will not carry a domain forward from declaration history alone.',
    };
  }
  if ((needsSeeking && seeking.length >= 6) || (needsOffering && offering.length >= 6)) {
    return {
      disabled: true,
      label: 'CURRENT SIDE IS FULL',
      explanation: 'Remove another selection first. Beacon will not silently displace something you chose for this event.',
    };
  }

  return {
    disabled: false,
    label: `ADD TO ${modeLabel(suggestion.mode)}`,
    explanation: null,
  };
}

/**
 * Private longitudinal evidence for the participant preparing a new event.
 * Suggestions are transparent draft aids derived only from the caller's own
 * explicit ended-event declarations and captured outcomes. The user still has
 * to apply a suggestion and save the current event focus themselves.
 */
export default function ParticipantEventPlaybookCard({
  eventId,
  seeking,
  offering,
  onApply,
}: Readonly<Props>) {
  const [suggestions, setSuggestions] = useState<ParticipantPlaybookSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getMyEventPlaybook(eventId);
    if (result.error) {
      setSuggestions([]);
      setError('Your private event history could not be read right now.');
    } else {
      setSuggestions(buildParticipantEventPlaybook({ history: result.data, limit: 4 }));
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const result = await getMyEventPlaybook(eventId);
      if (!active) return;
      if (result.error) {
        setSuggestions([]);
        setError('Your private event history could not be read right now.');
      } else {
        setSuggestions(buildParticipantEventPlaybook({ history: result.data, limit: 4 }));
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  const establishedCount = useMemo(
    () => suggestions.filter((suggestion) => suggestion.tier === 'established').length,
    [suggestions],
  );

  if (!loading && !error && suggestions.length === 0) return null;

  return (
    <Surface elevated padded style={styles.shell}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="premium">PRIVATE EVENT PLAYBOOK</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>
            Carry forward what your own events have actually supported.
          </NeonText>
        </View>
        <Pill
          label={establishedCount > 0 ? `${establishedCount} REPEATED` : 'PRIVATE'}
          tone={establishedCount > 0 ? 'success' : 'neutral'}
        />
      </View>

      <NeonText variant="bodyMuted" style={styles.intro}>
        Beacon compares only your explicit declarations from ended events with captured mutual and outcome evidence. Hosts cannot read this view, and movement, clicks, profile views, messages, and reply speed are not inputs.
      </NeonText>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.premium} />
          <NeonText variant="bodyMuted">Reading your ended-event evidence…</NeonText>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBlock}>
          <NeonText variant="bodyMuted">{error}</NeonText>
          <Pressable accessibilityRole="button" onPress={load} style={styles.retryButton}>
            <NeonText variant="label" tone="premium">TRY AGAIN</NeonText>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error ? (
        <View style={styles.suggestionList}>
          {suggestions.map((suggestion) => {
            const state = applicationState({ suggestion, seeking, offering });
            return (
              <View key={suggestion.intentKey} style={styles.suggestionCard}>
                <View style={styles.headerRow}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="label" tone="muted">
                      {EVENT_INTENT_LABELS[suggestion.intentKey].toUpperCase()} · {modeLabel(suggestion.mode)}
                    </NeonText>
                    <NeonText variant="h2" style={styles.smallTop}>{suggestion.title}</NeonText>
                  </View>
                  <Pill label={tierLabel(suggestion.tier)} tone={tierTone(suggestion.tier)} />
                </View>

                <NeonText variant="bodyMuted" style={styles.rationale}>
                  {suggestion.rationale}
                </NeonText>

                <View style={styles.metricRow}>
                  <View style={styles.metric}>
                    <NeonText variant="h2">{suggestion.history.declaredEventCount}</NeonText>
                    <NeonText variant="label" tone="dim">ENDED EVENTS</NeonText>
                  </View>
                  <View style={styles.metric}>
                    <NeonText variant="h2">{suggestion.history.observedMutualCount}</NeonText>
                    <NeonText variant="label" tone="dim">MUTUALS</NeonText>
                  </View>
                  <View style={styles.metric}>
                    <NeonText variant="h2">{suggestion.history.alignedOutcomeCount}</NeonText>
                    <NeonText variant="label" tone="dim">ALIGNED</NeonText>
                  </View>
                  <View style={styles.metric}>
                    <NeonText variant="h2">{suggestion.history.completedOutcomeCount}</NeonText>
                    <NeonText variant="label" tone="dim">COMPLETE</NeonText>
                  </View>
                </View>

                <View style={styles.evidenceList}>
                  {suggestion.evidence.slice(0, 4).map((item) => (
                    <View key={item} style={styles.evidenceRow}>
                      <View style={styles.evidenceDot} />
                      <NeonText variant="bodyMuted" style={styles.evidenceCopy}>{item}</NeonText>
                    </View>
                  ))}
                </View>

                <View style={styles.actionRow}>
                  <NeonText variant="label" tone="dim" style={{ flex: 1 }}>
                    EVIDENCE COVERAGE {Math.round(suggestion.evidenceWeight * 100)} / 100 · NOT A SUCCESS PROBABILITY
                  </NeonText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: state.disabled }}
                    disabled={state.disabled}
                    onPress={() => onApply(suggestion.intentKey, suggestion.mode)}
                    style={({ pressed }) => [
                      styles.applyButton,
                      state.disabled && styles.disabled,
                      pressed && !state.disabled && styles.pressed,
                    ]}
                  >
                    <NeonText variant="label" tone={state.disabled ? 'dim' : 'premium'}>
                      {state.label}
                    </NeonText>
                  </Pressable>
                </View>

                {state.explanation ? (
                  <NeonText variant="bodyMuted" style={styles.stateExplanation}>
                    {state.explanation}
                  </NeonText>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <NeonText variant="bodyMuted" style={styles.boundary}>
        Applying a playbook item changes only this unsaved draft. You remain responsible for the final selections, and historical evidence never receives authority to edit a live event automatically.
      </NeonText>
    </Surface>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    borderRadius: radii.xl,
    borderColor: palette.premiumSoft,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  smallTop: { marginTop: 4 },
  intro: { marginTop: spacing.sm, lineHeight: 20 },
  loadingRow: {
    marginTop: spacing.lg,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  errorBlock: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.warning,
    backgroundColor: palette.warningSoft,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.premium,
  },
  suggestionList: { marginTop: spacing.lg, gap: spacing.md },
  suggestionCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  rationale: { marginTop: spacing.sm, lineHeight: 19 },
  metricRow: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.xs },
  metric: {
    flex: 1,
    minHeight: 64,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.space,
  },
  evidenceList: { marginTop: spacing.md, gap: spacing.xs },
  evidenceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  evidenceDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: palette.premium,
  },
  evidenceCopy: { flex: 1, fontSize: 12, lineHeight: 17 },
  actionRow: { marginTop: spacing.md, alignItems: 'flex-start', gap: spacing.sm },
  applyButton: {
    minHeight: 40,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: palette.premiumSoft,
  },
  disabled: { opacity: 0.42, borderColor: palette.hairlineStrong, backgroundColor: palette.space },
  pressed: { opacity: 0.78 },
  stateExplanation: { marginTop: spacing.sm, fontSize: 11, lineHeight: 16 },
  boundary: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
    fontSize: 11,
    lineHeight: 17,
  },
});
