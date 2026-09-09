import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getEventById } from '../services/event.service';
import type { EventRow } from '../types/database';

type ScreenParams = { EscortPanel: { eventId: string } };

function isLiveEvent(event: EventRow | null, now = Date.now()): boolean {
  if (!event || event.finalized_at) return false;
  const startsAt = event.starts_at ? Date.parse(event.starts_at) : Number.NaN;
  const endsAt = event.ends_at ? Date.parse(event.ends_at) : Number.NaN;
  const started = !Number.isFinite(startsAt) || startsAt <= now;
  const open = !Number.isFinite(endsAt) || endsAt > now;
  return started && open;
}

function timeWindowsOverlap(left: EscortRequest, right: EscortRequest): boolean {
  const leftStart = Date.parse(left.proposed_start);
  const leftEnd = Date.parse(left.proposed_end);
  const rightStart = Date.parse(right.proposed_start);
  const rightEnd = Date.parse(right.proposed_end);
  return leftStart < rightEnd && leftEnd > rightStart;
}

export default function EscortPanelScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'EscortPanel'>>();
  const { eventId } = route.params;

  const [queue, setQueue] = useState<EscortRequest[]>([]);
  const [rooms, setRooms] = useState<VenueRoom[]>([]);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<EscortRequest | null>(null);
  const [newRoomLabel, setNewRoomLabel] = useState('');

  const load = useCallback(async () => {
    const [nextQueue, nextRooms, nextEvent] = await Promise.all([
      listEscortQueue(eventId),
      listVenueRooms(eventId),
      getEventById(eventId),
    ]);
    setQueue(nextQueue);
    setRooms(nextRooms);
    setEvent(nextEvent);
    setClock(Date.now());
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (active) await load();
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const sealed = !isLiveEvent(event, clock);

  useEffect(() => {
    if (sealed) setAssignFor(null);
  }, [sealed]);

  const activeRoomIds = useMemo(() => {
    const active = new Set<string>();
    for (const request of queue) {
      if (!request.room_id || request.status !== 'awaiting_escort') continue;
      const start = Date.parse(request.proposed_start);
      const end = Date.parse(request.proposed_end);
      if (start <= clock && end > clock) active.add(request.room_id);
    }
    return active;
  }, [queue, clock]);

  const roomConflicts = useMemo(() => {
    const conflicts = new Set<string>();
    if (!assignFor) return conflicts;
    for (const request of queue) {
      if (!request.room_id || request.id === assignFor.id || request.status !== 'awaiting_escort') continue;
      if (timeWindowsOverlap(assignFor, request)) conflicts.add(request.room_id);
    }
    return conflicts;
  }, [assignFor, queue]);

  const handleAssign = async (roomId: string) => {
    if (!assignFor || sealed || roomConflicts.has(roomId)) return;
    try {
      await assignRoom(assignFor.id, roomId);
      setAssignFor(null);
      await load();
    } catch (error) {
      Alert.alert('Could not assign', error instanceof Error ? error.message : 'Try again');
      await load();
    }
  };

  const handleAddRoom = async () => {
    if (!newRoomLabel.trim() || sealed) return;
    try {
      await createVenueRoom(eventId, newRoomLabel.trim(), 2);
      setNewRoomLabel('');
      await load();
    } catch (error) {
      Alert.alert('Could not add room', error instanceof Error ? error.message : 'Try again');
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
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Rooms</Text>
          <Text style={sealed ? styles.sealedLabel : styles.liveLabel}>
            {sealed ? '○ ESCORT SEALED' : '● LIVE ORCHESTRATION'}
          </Text>
        </View>

        {sealed ? (
          <View style={styles.sealedCard}>
            <Text style={styles.sealedTitle}>Physical routing is now read-only.</Text>
            <Text style={styles.sealedCopy}>
              The live event window closed. Existing room assignments remain visible as evidence, but new rooms and reassignment are blocked by the database.
            </Text>
          </View>
        ) : null}

        <View style={styles.roomsRow}>
          {rooms.map((room) => {
            const busy = activeRoomIds.has(room.id);
            return (
              <View key={room.id} style={[styles.roomChip, busy && styles.roomChipBusy]}>
                <Text style={styles.roomChipText}>{room.label}</Text>
                <Text style={busy ? styles.busyText : styles.availableText}>
                  {busy ? 'BUSY' : 'OPEN'}
                </Text>
              </View>
            );
          })}
        </View>

        {!sealed ? (
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
        ) : null}
      </View>

      <Text style={[styles.sectionLabel, { marginHorizontal: 16, marginTop: 16 }]}>
        Escort queue
      </Text>
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={queue}
        keyExtractor={(item) => item.id}
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
            {item.room_label ? (
              <Text style={styles.assigned}>Assigned to {item.room_label}</Text>
            ) : null}
            {!sealed ? (
              <Pressable style={styles.assignBtn} onPress={() => setAssignFor(item)}>
                <Text style={styles.btnText}>
                  {item.room_id ? 'Reassign Room' : 'Assign Room'}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.readOnlyLabel}>SEALED · READ ONLY</Text>
            )}
          </View>
        )}
      />

      <Modal
        visible={assignFor !== null && !sealed}
        animationType="slide"
        transparent
        onRequestClose={() => setAssignFor(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAssignFor(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>Pick a room</Text>
            <Text style={styles.modalCopy}>
              Rooms already committed to an overlapping Office Hours window are locked.
            </Text>
            {rooms.length === 0 ? (
              <Text style={styles.empty}>Add a room first.</Text>
            ) : (
              rooms.map((room) => {
                const conflict = roomConflicts.has(room.id);
                return (
                  <Pressable
                    key={room.id}
                    disabled={conflict}
                    style={[styles.roomOption, conflict && styles.roomOptionDisabled]}
                    onPress={() => handleAssign(room.id)}
                  >
                    <Text style={styles.roomOptionText}>{room.label}</Text>
                    <Text style={conflict ? styles.conflictText : styles.availableText}>
                      {conflict ? 'TIME CONFLICT' : 'AVAILABLE'}
                    </Text>
                  </Pressable>
                );
              })
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
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: '#f59e0b', fontSize: 12, letterSpacing: 1 },
  liveLabel: { color: '#22c55e', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  sealedLabel: { color: '#9ca3af', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  sealedCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
  },
  sealedTitle: { color: '#e5e7eb', fontSize: 13, fontWeight: '700' },
  sealedCopy: { marginTop: 5, color: '#9ca3af', fontSize: 11, lineHeight: 16 },
  roomsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  roomChip: {
    minWidth: 88,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0f172a',
  },
  roomChipBusy: { borderColor: '#f59e0b' },
  roomChipText: { color: '#d1d5db', fontWeight: '700' },
  busyText: { marginTop: 2, color: '#f59e0b', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  availableText: { marginTop: 2, color: '#22c55e', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
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
  readOnlyLabel: { marginTop: 10, color: '#6b7280', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
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
  modalTitle: { color: '#f5f5f5', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  modalCopy: { color: '#9ca3af', fontSize: 11, lineHeight: 16, marginBottom: 8 },
  roomOption: {
    padding: 16,
    backgroundColor: '#111827',
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  roomOptionDisabled: { opacity: 0.42 },
  roomOptionText: { color: '#f5f5f5', fontWeight: '600' },
  conflictText: { marginTop: 2, color: '#ef4444', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
});
