import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import {
  assignRoom,
  createVenueRoom,
  listEscortQueue,
  listVenueRooms,
  type EscortRequest,
  type VenueRoom,
} from '../services/escort.service';

type ScreenParams = { EscortPanel: { eventId: string } };

export default function EscortPanelScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'EscortPanel'>>();
  const { eventId } = route.params;

  const [queue, setQueue] = useState<EscortRequest[]>([]);
  const [rooms, setRooms] = useState<VenueRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<EscortRequest | null>(null);
  const [newRoomLabel, setNewRoomLabel] = useState('');

  const load = useCallback(async () => {
    const [q, r] = await Promise.all([listEscortQueue(eventId), listVenueRooms(eventId)]);
    setQueue(q);
    setRooms(r);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAssign = async (roomId: string) => {
    if (!assignFor) return;
    try {
      await assignRoom(assignFor.id, roomId);
      setAssignFor(null);
      load();
    } catch (e) {
      Alert.alert('Could not assign', e instanceof Error ? e.message : 'Try again');
    }
  };

  const handleAddRoom = async () => {
    if (!newRoomLabel.trim()) return;
    try {
      await createVenueRoom(eventId, newRoomLabel.trim(), 2);
      setNewRoomLabel('');
      load();
    } catch (e) {
      Alert.alert('Could not add room', e instanceof Error ? e.message : 'Try again');
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
    <View style={styles.container}>
      <View style={styles.roomsBar}>
        <Text style={styles.sectionLabel}>Rooms</Text>
        <View style={styles.roomsRow}>
          {rooms.map((r) => (
            <View key={r.id} style={styles.roomChip}>
              <Text style={styles.roomChipText}>{r.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.addRoomRow}>
          <TextInput
            value={newRoomLabel}
            onChangeText={setNewRoomLabel}
            placeholder="Add room…"
            placeholderTextColor="#6b7280"
            style={styles.input}
          />
          <Pressable style={styles.addBtn} onPress={handleAddRoom}>
            <Text style={styles.addBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { marginHorizontal: 16, marginTop: 16 }]}>
        Escort queue
      </Text>
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={queue}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={
          <Text style={styles.empty}>No accepted office-hours requests yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.peer}>
              {item.requester_name ?? '—'} ↔ {item.recipient_name ?? '—'}
            </Text>
            <Text style={styles.when}>
              {new Date(item.proposed_start).toLocaleTimeString()} · {item.status.toUpperCase()}
            </Text>
            {item.room_label && (
              <Text style={styles.assigned}>Assigned to {item.room_label}</Text>
            )}
            <Pressable style={styles.assignBtn} onPress={() => setAssignFor(item)}>
              <Text style={styles.btnText}>
                {item.room_id ? 'Reassign Room' : 'Assign Room'}
              </Text>
            </Pressable>
          </View>
        )}
      />

      <Modal
        visible={assignFor !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setAssignFor(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Pick a room</Text>
            {rooms.length === 0 ? (
              <Text style={styles.empty}>Add a room first.</Text>
            ) : (
              rooms.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.roomOption}
                  onPress={() => handleAssign(r.id)}
                >
                  <Text style={styles.roomOptionText}>{r.label}</Text>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  roomsBar: { padding: 16, borderBottomWidth: 1, borderColor: '#1f2937' },
  sectionLabel: { color: '#f59e0b', fontSize: 12, letterSpacing: 1 },
  roomsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  roomChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
  },
  roomChipText: { color: '#d1d5db' },
  addRoomRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
    color: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
  },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f59e0b',
    borderRadius: 8,
  },
  addBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 16 },
  row: { backgroundColor: '#111827', borderRadius: 12, padding: 16, gap: 4 },
  peer: { color: '#f5f5f5', fontWeight: '700', fontSize: 15 },
  when: { color: '#f59e0b', fontSize: 12, letterSpacing: 1 },
  assigned: { color: '#22c55e', fontSize: 12 },
  assignBtn: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#2563eb',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#f5f5f5', fontWeight: '700' },
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 32 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#0a0a0a',
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  roomOption: {
    padding: 16,
    backgroundColor: '#111827',
    borderRadius: 8,
    marginTop: 8,
  },
  roomOptionText: { color: '#f5f5f5', fontWeight: '600' },
});
