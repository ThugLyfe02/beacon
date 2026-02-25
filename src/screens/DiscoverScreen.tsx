// =============================================================================
// Beacon MVP — Discover Screen
// =============================================================================
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useEvent } from '../hooks/useEvent';
import { useParticipants } from '../hooks/useParticipants';
import { useMatches } from '../hooks/useMatches';
import { DiscoverableParticipant } from '../types/database';

export function DiscoverScreen() {
  const { user } = useAuth();
  const { activeEvent } = useEvent();
  const {
    participants,
    loading,
    isDiscoverable,
    loadDiscoverableParticipants,
    toggleDiscoverable,
  } = useParticipants();
  const { sendConnectionRequest } = useMatches();

  const [sendingRequestTo, setSendingRequestTo] = useState<string | null>(null);

  useEffect(() => {
    if (activeEvent && user) {
      loadDiscoverableParticipants(activeEvent.event.id, user.id);
    }
  }, [activeEvent, user, loadDiscoverableParticipants]);

  const handleToggleDiscoverable = async (value: boolean) => {
    if (!activeEvent || !user) return;

    const { error } = await toggleDiscoverable(
      activeEvent.event.id,
      user.id,
      value
    );

    if (error) {
      Alert.alert('Error', error.message || 'Failed to update visibility');
    }
  };

  const handleSendRequest = async (participant: DiscoverableParticipant) => {
    if (!activeEvent || !user) return;

    setSendingRequestTo(participant.user_id);

    const { match, error } = await sendConnectionRequest(
      activeEvent.event.id,
      user.id,
      participant.user_id
    );

    setSendingRequestTo(null);

    if (error) {
      const errorMsg =
        typeof error === 'object' && 'message' in error
          ? error.message
          : 'Failed to send request';
      Alert.alert('Error', errorMsg);
      return;
    }

    if (match) {
      Alert.alert('Match!', `You matched with ${participant.name || 'this person'}!`);
    } else {
      Alert.alert('Sent', 'Connection request sent');
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

  if (!activeEvent) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No active event</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eventName}>{activeEvent.event.name}</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Make me discoverable</Text>
          <Switch
            value={isDiscoverable}
            onValueChange={handleToggleDiscoverable}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : participants.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No discoverable participants yet.{'\n'}
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
    backgroundColor: '#f9f9f9',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  eventName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardContent: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  role: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  oneLiner: {
    fontSize: 14,
    color: '#333',
  },
  connectButton: {
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  connectButtonDisabled: {
    backgroundColor: '#999',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
