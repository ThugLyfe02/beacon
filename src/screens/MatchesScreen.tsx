// =============================================================================
// MatchesScreen.tsx
// View mutual matches from your events
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getUserEvents } from '../services/event.service';
import { listMatches } from '../services/match.service';
import type { MatchRow, EventRow } from '../types/database';

interface MatchesScreenProps {
  userId: string;
}

export function MatchesScreen({ userId }: MatchesScreenProps) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

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

        // Load matches for that event
        const eventMatches = await listMatches(firstEvent.id, userId);
        setMatches(eventMatches);
      }
    } catch (error) {
      console.error('Failed to load matches:', error);
      Alert.alert('Error', 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  };

  const renderMatch = ({ item }: { item: MatchRow }) => {
    // Determine which user ID is the "other" person
    const otherUserId =
      item.user_a_id === userId ? item.user_b_id : item.user_a_id;

    return (
      <View style={styles.card}>
        <View style={styles.cardContent}>
          <Text style={styles.matchLabel}>🤝 Match</Text>
          <Text style={styles.userId}>User ID: {otherUserId.slice(0, 8)}...</Text>
          <Text style={styles.timestamp}>
            {new Date(item.created_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
    );
  };

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
        <Text style={styles.emptySubtext}>Join an event to make matches</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Matches</Text>
        <Text style={styles.subtitle}>{event.name}</Text>
      </View>

      {matches.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            No matches yet.{'\n'}
            Start connecting with people on the Discover tab!
          </Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={renderMatch}
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
  title: {
    fontSize: 24,
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
    borderWidth: 1,
    borderColor: '#333',
  },
  cardContent: {
    flex: 1,
  },
  matchLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00CC00',
    marginBottom: 8,
  },
  userId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
});
