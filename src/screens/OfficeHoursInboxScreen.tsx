import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import {
  acceptOfficeHoursRequest,
  cancelOfficeHoursRequest,
  confirmOfficeHoursCompletion,
  declineOfficeHoursRequest,
  getOfficeHoursCompletionState,
  listMyOfficeHoursRequests,
  type OfficeHoursCompletionState,
  type OfficeHoursRequestWithPeer,
} from '../services/officeHours.service';

export default function OfficeHoursInboxScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const userId = user?.id ?? '';
  const [items, setItems] = useState<OfficeHoursRequestWithPeer[]>([]);
  const [completionById, setCompletionById] = useState<Record<string, OfficeHoursCompletionState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const data = await listMyOfficeHoursRequests(userId);
    setItems(data);

    const evidenceCandidates = data.filter((item) =>
      item.status === 'accepted'
      || item.status === 'awaiting_escort'
      || item.status === 'completed'
    );
    const evidenceEntries = await Promise.all(
      evidenceCandidates.map(async (item) => [
        item.id,
        await getOfficeHoursCompletionState(item.id),
      ] as const),
    );
    setCompletionById(Object.fromEntries(
      evidenceEntries.filter((entry): entry is readonly [string, OfficeHoursCompletionState] => Boolean(entry[1])),
    ));

    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const onAccept = async (id: string) => {
    await acceptOfficeHoursRequest(id);
    load();
  };
  const onDecline = async (id: string) => {
    await declineOfficeHoursRequest(id);
    load();
  };
  const onCancel = async (id: string) => {
    await cancelOfficeHoursRequest(id);
    load();
  };

  const onConfirm = async (id: string) => {
    if (confirmingId) return;
    setConfirmingId(id);
    try {
      const evidence = await confirmOfficeHoursCompletion(id);
      setCompletionById((current) => ({ ...current, [id]: evidence }));
      if (evidence.status === 'completed') {
        Alert.alert(
          'Two-party session confirmed',
          'Both participants independently confirmed this Office Hours session. Beacon can now treat it as verified completion evidence.',
        );
      }
      await load();
    } catch (error) {
      Alert.alert(
        'Confirmation unavailable',
        error instanceof Error ? error.message : 'Could not confirm this session.',
      );
    } finally {
      setConfirmingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor="#f59e0b"
        />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>No office-hours requests yet.</Text>
      }
      renderItem={({ item }) => {
        const start = new Date(item.proposed_start);
        const evidence = completionById[item.id];
        const sessionStarted = start.getTime() <= Date.now();
        const canConfirm = sessionStarted
          && (item.status === 'accepted' || item.status === 'awaiting_escort')
          && !evidence?.ownConfirmed;

        return (
          <View style={styles.row}>
            <Text style={styles.peer}>
              {item.direction === 'incoming' ? 'From' : 'To'}: {item.peer_name ?? 'Unknown'}
            </Text>
            {item.peer_role && <Text style={styles.role}>{item.peer_role}</Text>}
            <Text style={styles.when}>
              {start.toLocaleString()} · {item.status.toUpperCase()}
            </Text>

            {item.status === 'pending' && item.direction === 'incoming' && (
              <View style={styles.actions}>
                <Pressable style={styles.btn} onPress={() => onAccept(item.id)}>
                  <Text style={styles.btnText}>Accept</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnAlt]}
                  onPress={() => onDecline(item.id)}
                >
                  <Text style={styles.btnText}>Decline</Text>
                </Pressable>
              </View>
            )}

            {item.status === 'pending' && item.direction === 'outgoing' && (
              <Pressable
                style={[styles.btn, styles.btnAlt, styles.singleBtn]}
                onPress={() => onCancel(item.id)}
              >
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
            )}

            {(item.status === 'accepted' || item.status === 'awaiting_escort') && (
              <Pressable
                style={[styles.btn, styles.singleBtn]}
                onPress={() =>
                  navigation.navigate('OfficeHoursCall', { officeHoursRequestId: item.id })
                }
              >
                <Text style={styles.btnText}>Join Call</Text>
              </Pressable>
            )}

            {evidence?.status === 'completed' || item.status === 'completed' ? (
              <View style={styles.verifiedPanel}>
                <Text style={styles.verifiedTitle}>TWO-PARTY COMPLETION SEALED</Text>
                <Text style={styles.verifiedText}>
                  Both participants independently confirmed this session. It can count toward verified outcomes and venue learning.
                </Text>
              </View>
            ) : evidence?.ownConfirmed ? (
              <View style={styles.waitingPanel}>
                <Text style={styles.waitingTitle}>Your confirmation is sealed</Text>
                <Text style={styles.waitingText}>
                  {evidence.counterpartConfirmed
                    ? 'The counterpart also confirmed; refresh to reconcile the completed state.'
                    : 'Beacon is waiting for the other participant. One-sided confirmation does not count as completion.'}
                </Text>
              </View>
            ) : canConfirm ? (
              <View style={styles.confirmPanel}>
                <Text style={styles.confirmTitle}>
                  {evidence?.counterpartConfirmed ? 'The other participant confirmed' : 'Did this session actually happen?'}
                </Text>
                <Text style={styles.confirmText}>
                  Confirm only if you personally participated. Beacon records your side independently.
                </Text>
                <Pressable
                  disabled={confirmingId === item.id}
                  style={[styles.confirmBtn, confirmingId === item.id && styles.disabled]}
                  onPress={() => onConfirm(item.id)}
                >
                  {confirmingId === item.id ? (
                    <ActivityIndicator color="#071018" />
                  ) : (
                    <Text style={styles.confirmBtnText}>Confirm my side</Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  list: { padding: 16, gap: 12 },
  row: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  peer: { color: '#f5f5f5', fontWeight: '700', fontSize: 16 },
  role: { color: '#9ca3af', fontSize: 13 },
  when: { color: '#f59e0b', marginTop: 6, fontSize: 12, letterSpacing: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    flex: 1,
    backgroundColor: '#f59e0b',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: '#374151' },
  singleBtn: { flex: 0, marginTop: 12 },
  btnText: { color: '#0a0a0a', fontWeight: '700' },
  confirmPanel: {
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(56,189,248,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.18)',
  },
  confirmTitle: { color: '#BAE6FD', fontSize: 12, fontWeight: '800' },
  confirmText: { color: '#94A3B8', marginTop: 5, fontSize: 11, lineHeight: 16 },
  confirmBtn: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: '#34D399',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { color: '#071018', fontWeight: '800', fontSize: 12 },
  waitingPanel: {
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  waitingTitle: { color: '#FCD34D', fontSize: 12, fontWeight: '800' },
  waitingText: { color: '#94A3B8', marginTop: 5, fontSize: 11, lineHeight: 16 },
  verifiedPanel: {
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
    backgroundColor: 'rgba(16,185,129,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.2)',
  },
  verifiedTitle: { color: '#6EE7B7', fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  verifiedText: { color: '#A7F3D0', marginTop: 5, fontSize: 11, lineHeight: 16 },
  disabled: { opacity: 0.55 },
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 48 },
});
