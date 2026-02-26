// =============================================================================
// DiscoverScreen.tsx
// Discover and network with other participants at your events
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getUserEvents } from '../services/event.service';
import { getApprovedParticipants } from '../services/participant.service';
import { sendConnectionRequest as sendRequest } from '../services/match.service';
import type { DiscoverableParticipant, EventRow } from '../types/database';

interface DiscoverScreenProps {
  userId: string;
}

export function DiscoverScreen({ userId }: DiscoverScreenProps) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [participants, setParticipants] = useState<DiscoverableParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingRequestTo, setSendingRequestTo] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [userId]);

  const loadData = async () => {
    try {
      setLoading(true);
      // Get user's first event
      const events = await getUserEvents(userId);
      if (events.length > 0) {
        const firstEvent = events[0];
        setEvent(firstEvent);

        // Load participants for that event
        const approvedParticipants = await getApprovedParticipants(
          firstEvent.id,
          userId
        );
        setParticipants(approvedParticipants);
      }
    } catch (error) {
      console.error('Failed to load discover data:', error);
      Alert.alert('Error', 'Failed to load participants');
    } finally {
      setLoading(false);
    }
  };

  const handleSendRequest = async (participant: DiscoverableParticipant) => {
    if (!event) return;

    setSendingRequestTo(participant.user_id);

    try {
      const match = await sendRequest(event.id, userId, participant.user_id);

      if (match) {
        Alert.alert('Match!', `You matched with ${participant.name || 'this person'}!`);
      } else {
        Alert.alert('Sent', 'Connection request sent');
      }
    } catch (error) {
      console.error('Failed to send request:', error);
      Alert.alert('Error', 'Failed to send connection request');
    } finally {
      setSendingRequestTo(null);
    }
  };

  const renderParticipant = ({ item }: { item: DiscoverableParticipant }) => (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        <Text style={styles.name}>{item.name || 'Anonymous'}</Text>
        {item.role && <Text style={styles.role}>{item.role}</Text>}
        {item.one_liner && <Text style={styles.oneLiner}>{item.one_liner}</Text>}
      </View>

      <TouchableOpacity
        style={[
          styles.connectButton,
          sendingRequestTo === item.user_id && styles.connectButtonDisabled,
        ]}
        onPress={() => handleSendRequest(item)}
        disabled={sendingRequestTo === item.user_id}
      >
        {sendingRequestTo === item.user_id ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.connectButtonText}>Connect</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No events found</Text>
        <Text style={styles.emptySubtext}>Join an event to discover people</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eventName}>{event.name}</Text>
        <Text style={styles.subtitle}>Network with other participants</Text>
      </View>

      {participants.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No participants yet.{'\n'}
            Check back soon!
          </Text>
        </View>
      ) : (
        <FlatList
          data={participants}
          keyExtractor={(item) => item.participant_id}
          renderItem={renderParticipant}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  header: {
    backgroundColor: '#1A1A1A',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  eventName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
  },
  emptyText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  cardContent: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  role: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 4,
  },
  oneLiner: {
    fontSize: 14,
    color: '#999',
  },
  connectButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  connectButtonDisabled: {
    opacity: 0.5,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
