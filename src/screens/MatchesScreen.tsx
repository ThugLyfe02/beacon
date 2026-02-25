// =============================================================================
// Beacon MVP — Matches Screen
// =============================================================================
import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useEvent } from '../hooks/useEvent';
import { useMatches } from '../hooks/useMatches';
import { MatchRow } from '../types/database';

export function MatchesScreen() {
  const { user } = useAuth();
  const { activeEvent } = useEvent();
  const { matches, loading, loadMatches } = useMatches();

  useEffect(() => {
    if (activeEvent && user) {
      loadMatches(activeEvent.event.id, user.id);
    }
  }, [activeEvent, user, loadMatches]);

  const renderMatch = ({ item }: { item: MatchRow }) => {
    // Determine which user ID is the "other" person
    const otherUserId =
      item.user_a_id === user?.id ? item.user_b_id : item.user_a_id;

    return (
      <View style={styles.card}>
        <View style={styles.cardContent}>
          <Text style={styles.matchLabel}>Match</Text>
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
        <Text style={styles.title}>Your Matches</Text>
        <Text style={styles.subtitle}>{activeEvent.event.name}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : matches.length === 0 ? (
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
    backgroundColor: '#f9f9f9',
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
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
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardContent: {
    flex: 1,
  },
  matchLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4CAF50',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  userId: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
});
