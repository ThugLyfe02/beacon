import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { isHandshakePersistenceDurable, listPendingHandshakes } from '../handshake/OfflineHandshakeLocalStore';
import {
  getUsableHandshakeCapability,
  prepareHandshakeContinuity,
  reconcilePendingHandshakes,
} from '../services/offline-handshake.service';

interface Props {
  eventId: string;
}

export default function MeetInBeaconPreview({ eventId }: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const [ready, setReady] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [durable, setDurable] = useState(true);
  const [networkDegraded, setNetworkDegraded] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [persistence] = await Promise.all([isHandshakePersistenceDurable()]);
    setDurable(persistence);

    const prepared = await prepareHandshakeContinuity({ eventId, userId });
    const reconciliation = await reconcilePendingHandshakes({ eventId, userId });
    const [capability, pending] = await Promise.all([
      getUsableHandshakeCapability(eventId, userId),
      listPendingHandshakes(eventId, userId),
    ]);
    setReady(capability != null);
    setPendingCount(pending.filter((item) => ['pending-reconciliation', 'needs-attention'].includes(item.state)).length);
    setNetworkDegraded(Boolean(prepared.error) || reconciliation.networkUnavailable);
  }, [eventId, userId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  if (!userId) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Meet in Beacon. Open explicit physical meeting handshake."
      onPress={() => navigation.navigate('MeetInBeacon', { eventId })}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>MEET IN BEACON</Text>
          <Text style={styles.title}>The room can lose signal. Your meeting does not have to.</Text>
        </View>
        <View style={[styles.status, ready ? styles.statusReady : styles.statusPreparing]}>
          <Text style={[styles.statusText, ready && styles.statusTextReady]}>
            {ready ? 'OFFLINE READY' : 'PREPARING'}
          </Text>
        </View>
      </View>

      <Text style={styles.copy}>
        Explicitly confirm a real meeting by QR or one-time code. Both phones keep a minimal pending receipt and Beacon verifies it when connectivity returns.
      </Text>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? 'meeting' : 'meetings'} awaiting reconciliation`
            : networkDegraded && ready
              ? 'Using prepared one-time capabilities'
              : 'No passive encounter tracking'}
        </Text>
        <Text style={styles.arrow}>→</Text>
      </View>

      {!durable ? (
        <Text style={styles.warning}>
          Durable secure offline storage is unavailable on this platform; keep this screen open or reconnect before leaving.
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: '#071A16',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.28)',
  },
  pressed: { opacity: 0.78 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#6EE7B7', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 5, color: '#ECFDF5', fontSize: 17, lineHeight: 23, fontWeight: '800' },
  status: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  statusReady: { borderColor: 'rgba(52,211,153,0.42)', backgroundColor: 'rgba(16,185,129,0.14)' },
  statusPreparing: { borderColor: 'rgba(148,163,184,0.22)', backgroundColor: 'rgba(71,85,105,0.16)' },
  statusText: { color: '#94A3B8', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  statusTextReady: { color: '#6EE7B7' },
  copy: { marginTop: 9, color: '#A7C7BC', fontSize: 11, lineHeight: 17 },
  footer: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  meta: { flex: 1, color: '#6EE7B7', fontSize: 9, fontWeight: '800', letterSpacing: 0.45 },
  arrow: { color: '#6EE7B7', fontSize: 22 },
  warning: { marginTop: 9, color: '#FCD34D', fontSize: 9, lineHeight: 14 },
});
