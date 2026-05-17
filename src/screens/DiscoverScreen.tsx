import React, { useEffect, useState, useCallback } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { getUserEvents } from '../services/event.service';
import { getApprovedParticipants } from '../services/participant.service';
import { sendConnectionRequest as sendRequest } from '../services/match.service';
import {
  GlowButton,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PremiumBadge,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';
import type { DiscoverableParticipant, EventRow } from '../types/database';

interface DiscoverScreenProps {
  userId: string;
}

export function DiscoverScreen({ userId }: Readonly<DiscoverScreenProps>) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [participants, setParticipants] = useState<DiscoverableParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingRequestTo, setSendingRequestTo] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const events = await getUserEvents(userId);
      if (events.length > 0) {
        const firstEvent = events[0];
        setEvent(firstEvent);
        const approved = await getApprovedParticipants(firstEvent.id, userId);
        setParticipants(approved);
      }
    } catch (error) {
      console.error('Failed to load discover data:', error);
      Alert.alert('Signal lost', 'Could not load participants.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSendRequest = async (participant: DiscoverableParticipant) => {
    if (!event) return;
    setSendingRequestTo(participant.user_id);
    try {
      const match = await sendRequest(event.id, userId, participant.user_id);
      if (match) {
        Alert.alert('Connection live', `You synced with ${participant.name || 'this signal'}.`);
      } else {
        Alert.alert('Signal sent', 'Connection request transmitted.');
      }
    } catch (error) {
      console.error('Failed to send request:', error);
      Alert.alert('Transmit failed', 'Could not send connection request.');
    } finally {
      setSendingRequestTo(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={56} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Scanning room
        </NeonText>
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded glow style={styles.emptyCard}>
          <Pill label="No event" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>
            Nothing to scan.
          </NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Join an event to start discovering people in the room.
          </NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.5} />
      <View style={styles.header}>
        <Pill label="Discover" tone="accent" dot />
        <NeonText variant="h1" glow style={{ marginTop: spacing.sm }}>
          {event.name}
        </NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
          {participants.length} signal{participants.length === 1 ? '' : 's'} in range
        </NeonText>
      </View>

      {participants.length === 0 ? (
        <View style={styles.centered}>
          <NeonText variant="h2" tone="muted">The room is forming.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            New participants will surface here as they join.
          </NeonText>
        </View>
      ) : (
        <FlatList
          data={participants}
          keyExtractor={(item) => item.participant_id}
          renderItem={({ item }) => (
            <Surface elevated padded style={styles.card}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <View style={styles.nameRow}>
                  <NeonText variant="h2">{item.name || 'Anonymous'}</NeonText>
                  {item.is_premium ? <PremiumBadge size="sm" /> : null}
                </View>
                {item.role ? (
                  <NeonText variant="label" tone="accent">{item.role}</NeonText>
                ) : null}
                {item.one_liner ? (
                  <NeonText variant="bodyMuted">{item.one_liner}</NeonText>
                ) : null}
              </View>
              <GlowButton
                label="Connect"
                onPress={() => handleSendRequest(item)}
                loading={sendingRequestTo === item.user_id}
                size="sm"
                variant="secondary"
              />
            </Surface>
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.void,
    paddingHorizontal: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  emptyCard: { width: '100%', borderRadius: radii.xl, gap: spacing.xs },
});
