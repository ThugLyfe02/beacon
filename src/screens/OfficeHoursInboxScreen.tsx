import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  declineOfficeHoursRequest,
  listMyOfficeHoursRequests,
  type OfficeHoursRequestWithPeer,
} from '../services/officeHours.service';

export default function OfficeHoursInboxScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const userId = user?.id ?? '';
  const [items, setItems] = useState<OfficeHoursRequestWithPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const data = await listMyOfficeHoursRequests(userId);
    setItems(data);
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
      keyExtractor={(i) => i.id}
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
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 48 },
});
