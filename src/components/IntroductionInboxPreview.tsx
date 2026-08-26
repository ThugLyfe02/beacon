import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  listMyWarmIntroductions,
  type WarmIntroductionInboxItem,
} from '../services/warm-introduction.service';

interface Props {
  eventId: string;
}

const REFRESH_MS = 30_000;

/**
 * Compact event-lobby entry point. It renders only when the caller actually has
 * an introduction request or accepted bridge; it never exposes an event-wide
 * introduction feed or any other participant's graph.
 */
export default function IntroductionInboxPreview({ eventId }: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [items, setItems] = useState<WarmIntroductionInboxItem[]>([]);

  const refresh = useCallback(async () => {
    const result = await listMyWarmIntroductions(eventId);
    if (!result.error) setItems(result.data);
  }, [eventId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const state = useMemo(() => {
    const decisions = items.filter((item) => item.can_accept).length;
    const ready = items.filter((item) => item.request_status === 'accepted').length;
    const waiting = items.filter((item) => (
      item.request_status === 'connector-pending'
      || item.request_status === 'target-pending'
    )).length;
    const matched = items.filter((item) => item.request_status === 'matched').length;
    return { decisions, ready, waiting, matched };
  }, [items]);

  if (items.length === 0) return null;

  const headline = state.decisions > 0
    ? `${state.decisions} introduction ${state.decisions === 1 ? 'decision needs' : 'decisions need'} you`
    : state.ready > 0
      ? `${state.ready} warm introduction ${state.ready === 1 ? 'is' : 'are'} open`
      : state.waiting > 0
        ? `${state.waiting} introduction ${state.waiting === 1 ? 'is' : 'are'} moving through consent`
        : `${state.matched} introduction ${state.matched === 1 ? 'became' : 'became'} a mutual`;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => navigation.navigate('IntroductionInbox', { eventId })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>INTRODUCTION INBOX</Text>
          <Text style={styles.title}>{headline}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{state.decisions}</Text>
          <Text style={styles.metricLabel}>DECIDE</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{state.ready}</Text>
          <Text style={styles.metricLabel}>OPEN</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{state.waiting}</Text>
          <Text style={styles.metricLabel}>WAITING</Text>
        </View>
      </View>

      <Text style={styles.boundary}>
        Every warm introduction requires a verified mutual connector, connector approval, and target approval. Nothing opens automatically.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: 'rgba(45,27,8,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
  },
  pressed: { opacity: 0.78 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#FBBF24', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 5, color: '#FFFBEB', fontSize: 17, lineHeight: 22, fontWeight: '800' },
  arrow: { color: '#FBBF24', fontSize: 24, lineHeight: 26 },
  metricRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  metric: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.46)',
  },
  metricValue: { color: '#FDE68A', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  metricLabel: { marginTop: 2, color: '#A3A3A3', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  boundary: { marginTop: 10, color: '#9A8968', fontSize: 9, lineHeight: 14 },
});
