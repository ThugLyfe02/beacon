import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  OUTCOME_INTENT_OPTIONS,
  evaluateOutcomeHandshake,
  getActivationLabel,
  type OutcomeHandshakeState,
  type OutcomeIntent,
} from '../outcomes/OutcomeHandshakeEngine';
import {
  completeOutcomeHandshake,
  getOutcomeHandshakeState,
  proposeOutcomeHandshake,
} from '../services/outcome-handshake.service';

interface Props {
  matchId: string;
  userId: string;
  counterpartyName: string;
}

const FEATURED_INTENTS: OutcomeIntent[] = [
  'follow_up',
  'collaborate',
  'partnership',
  'raise_capital',
  'invest',
  'hire',
  'explore_role',
  'mentor',
  'seek_mentorship',
  'make_intro',
  'request_intro',
];

function emptyState(matchId: string): OutcomeHandshakeState {
  return {
    id: null,
    matchId,
    status: 'idle',
    ownIntent: null,
    counterpartIntent: null,
    activationType: null,
    expiresAt: null,
  };
}

export default function OutcomeHandshakeCard({
  matchId,
  userId,
  counterpartyName,
}: Props) {
  const [state, setState] = useState<OutcomeHandshakeState>(() => emptyState(matchId));
  const [loading, setLoading] = useState(true);
  const [submittingIntent, setSubmittingIntent] = useState<OutcomeIntent | null>(null);
  const [completing, setCompleting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOutcomeHandshakeState(matchId, userId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, userId]);

  const evaluation = useMemo(() => evaluateOutcomeHandshake(state), [state]);
  const options = OUTCOME_INTENT_OPTIONS.filter((option) => FEATURED_INTENTS.includes(option.intent));

  async function selectIntent(intent: OutcomeIntent) {
    try {
      setSubmittingIntent(intent);
      const next = await proposeOutcomeHandshake({ matchId, intent });
      setState(next);
      setExpanded(false);
      if (next.status === 'aligned') {
        Alert.alert(
          getActivationLabel(next.activationType),
          `You and ${counterpartyName} independently selected compatible next steps.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to protect this outcome intent.';
      Alert.alert('Outcome unavailable', message);
    } finally {
      setSubmittingIntent(null);
    }
  }

  async function markComplete() {
    if (!state.id) return;
    setCompleting(true);
    const completed = await completeOutcomeHandshake(state.id);
    setCompleting(false);
    if (completed) {
      setState((current) => ({ ...current, status: 'completed' }));
    } else {
      Alert.alert('Could not close alignment', 'Please try again after refreshing this mutual.');
    }
  }

  return (
    <View style={styles.shell}>
      <View style={styles.topRow}>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>PRIVATE ALIGNMENT</Text>
        </View>
        {evaluation.remainingMinutes != null && evaluation.remainingMinutes > 0 ? (
          <Text style={styles.timer}>{evaluation.remainingMinutes}m</Text>
        ) : null}
      </View>

      <Text style={styles.headline}>{evaluation.headline}</Text>
      <Text style={styles.explanation}>{evaluation.explanation}</Text>

      {loading ? (
        <ActivityIndicator color="#F59E0B" style={styles.loader} />
      ) : null}

      {!loading && evaluation.primaryAction === 'choose_intent' ? (
        <>
          <Pressable
            onPress={() => setExpanded((current) => !current)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>
              {expanded ? 'Close choices' : 'Choose the outcome you would accept'}
            </Text>
          </Pressable>

          {expanded ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.optionRail}
            >
              {options.map((option) => {
                const busy = submittingIntent === option.intent;
                return (
                  <Pressable
                    key={option.intent}
                    disabled={submittingIntent != null}
                    onPress={() => selectIntent(option.intent)}
                    style={({ pressed }) => [
                      styles.optionCard,
                      pressed && styles.pressed,
                      busy && styles.optionBusy,
                    ]}
                  >
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                    <Text style={styles.optionValue}>{option.strategicValue}</Text>
                    {busy ? <ActivityIndicator color="#F59E0B" style={styles.optionLoader} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {!loading && evaluation.primaryAction === 'wait' ? (
        <View style={styles.waitingPanel}>
          <Text style={styles.waitingTitle}>Your choice is concealed</Text>
          <Text style={styles.waitingText}>
            {state.ownIntent
              ? `Beacon stored “${state.ownIntent.replaceAll('_', ' ')}” without revealing it to ${counterpartyName}.`
              : 'Beacon is waiting for your protected intent.'}
          </Text>
        </View>
      ) : null}

      {!loading && evaluation.primaryAction === 'confirm_next_step' ? (
        <View style={styles.alignedPanel}>
          <Text style={styles.alignedLabel}>{getActivationLabel(state.activationType)}</Text>
          <Text style={styles.alignedText}>
            This is private next-step alignment: both participants independently selected compatible intent. It is not evidence that the real-world outcome already occurred.
          </Text>
          <Pressable
            disabled={completing}
            onPress={markComplete}
            style={({ pressed }) => [styles.completeButton, pressed && styles.pressed]}
          >
            {completing ? (
              <ActivityIndicator color="#071018" />
            ) : (
              <Text style={styles.completeButtonText}>MARK ALIGNMENT HANDLED</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {state.status === 'completed' ? (
        <View style={styles.completedPanel}>
          <Text style={styles.completedTitle}>Next-step alignment closed</Text>
          <Text style={styles.completedText}>
            This closes Beacon's private intent-alignment task. It does not prove what happened afterward. Use the Participant-Owned Outcome Receipt below to record the bounded fact you deliberately attest actually happened.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 14,
    borderRadius: 18,
    padding: 15,
    backgroundColor: '#0E1726',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  privateBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(56, 189, 248, 0.10)',
  },
  privateBadgeText: {
    color: '#7DD3FC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  timer: {
    color: '#94A3B8',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  headline: {
    marginTop: 12,
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
  },
  explanation: {
    marginTop: 6,
    color: '#A8B3C5',
    fontSize: 13,
    lineHeight: 19,
  },
  loader: { marginTop: 14 },
  primaryButton: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#111827',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
  },
  optionRail: {
    gap: 10,
    paddingTop: 12,
    paddingBottom: 2,
  },
  optionCard: {
    width: 230,
    minHeight: 172,
    borderRadius: 14,
    padding: 13,
    backgroundColor: '#111D2E',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.16)',
  },
  optionBusy: { borderColor: '#F59E0B' },
  optionLabel: { color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  optionDescription: { marginTop: 7, color: '#CBD5E1', fontSize: 12, lineHeight: 17 },
  optionValue: { marginTop: 10, color: '#7DD3FC', fontSize: 11, lineHeight: 16 },
  optionLoader: { marginTop: 10, alignSelf: 'flex-start' },
  waitingPanel: {
    marginTop: 14,
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
  },
  waitingTitle: { color: '#BFDBFE', fontSize: 13, fontWeight: '800' },
  waitingText: { marginTop: 5, color: '#93A4BA', fontSize: 12, lineHeight: 17 },
  alignedPanel: {
    marginTop: 14,
    borderRadius: 14,
    padding: 13,
    backgroundColor: 'rgba(16, 185, 129, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.22)',
  },
  alignedLabel: { color: '#6EE7B7', fontSize: 13, fontWeight: '900' },
  alignedText: { marginTop: 6, color: '#B8C5D7', fontSize: 12, lineHeight: 17 },
  completeButton: {
    marginTop: 12,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#34D399',
  },
  completeButtonText: { color: '#071018', textAlign: 'center', fontSize: 12, fontWeight: '900' },
  completedPanel: {
    marginTop: 14,
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  completedTitle: { color: '#6EE7B7', fontSize: 13, fontWeight: '900' },
  completedText: { marginTop: 5, color: '#A8B3C5', fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.82 },
});
