import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { usePremiumStatus } from '../premium/usePremium';
import { supabase } from '../lib/supabase';
import { createOfficeHoursRequest } from '../services/officeHours.service';

type ScreenParams = {
  OfficeHoursRequest: { eventId: string; recipientId: string };
};

const DURATIONS_MIN = [15, 30, 45, 60];

export default function OfficeHoursRequestScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'OfficeHoursRequest'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId, recipientId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const isPremium = usePremiumStatus();

  const [duration, setDuration] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [recipientName, setRecipientName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('name')
        .eq('id', recipientId)
        .single();
      if (!cancelled) setRecipientName((data as { name: string | null } | null)?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientId]);

  const proposedStart = useMemo(() => new Date(Date.now() + 5 * 60 * 1000), []);
  const proposedEnd = useMemo(
    () => new Date(proposedStart.getTime() + duration * 60 * 1000),
    [proposedStart, duration]
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await createOfficeHoursRequest({
        eventId,
        requesterId: userId,
        recipientId,
        proposedStart,
        proposedEnd,
      });
      Alert.alert(
        'Request sent',
        `${recipientName ?? 'They'} will see your office-hours request.`
      );
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not send',
        err instanceof Error ? err.message : 'Try again later.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isPremium) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Office Hours is premium-only</Text>
        <Text style={styles.body}>
          Premium attendees can schedule 1-on-1s with anyone at the event. Upgrade in Profile.
        </Text>
        <Pressable style={styles.btnGhost} onPress={() => navigation.goBack()}>
          <Text style={styles.btnGhostText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Request Office Hours</Text>
      <Text style={styles.body}>
        With {recipientName ?? 'this attendee'} · starting in 5 min.
      </Text>

      <Text style={styles.label}>Duration</Text>
      <View style={styles.row}>
        {DURATIONS_MIN.map((m) => (
          <Pressable
            key={m}
            style={[styles.pill, duration === m && styles.pillActive]}
            onPress={() => setDuration(m)}
          >
            <Text style={[styles.pillText, duration === m && styles.pillTextActive]}>
              {m} min
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.btn, submitting && styles.btnDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#0a0a0a" />
        ) : (
          <Text style={styles.btnText}>Send Request</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 24 },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  body: { color: '#9ca3af', marginTop: 8, fontSize: 14 },
  label: { color: '#f59e0b', marginTop: 24, fontSize: 12, letterSpacing: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  pill: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pillActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  pillText: { color: '#d1d5db', fontWeight: '600' },
  pillTextActive: { color: '#0a0a0a' },
  btn: {
    marginTop: 32,
    backgroundColor: '#f59e0b',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#0a0a0a', fontWeight: '700' },
  btnGhost: {
    marginTop: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnGhostText: { color: '#d1d5db', fontWeight: '600' },
});
