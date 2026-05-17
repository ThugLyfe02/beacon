import React, { useEffect, useState, useCallback } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { getUserEvents } from '../services/event.service';
import { listMatchesWithProfiles, type MatchWithProfile } from '../services/match.service';
import {
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PremiumBadge,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';
import type { EventRow } from '../types/database';

interface MatchesScreenProps {
  userId: string;
}

export function MatchesScreen({ userId }: Readonly<MatchesScreenProps>) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [matches, setMatches] = useState<MatchWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const events = await getUserEvents(userId);
      if (events.length > 0) {
        const firstEvent = events[0];
        setEvent(firstEvent);
        setMatches(await listMatchesWithProfiles(firstEvent.id, userId));
      }
    } catch (error) {
      console.error('Failed to load matches:', error);
      Alert.alert('Signal lost', 'Could not load matches.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={56} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading matches
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
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>No connections yet.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Join an event to start making matches.
          </NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.5} />
      <View style={styles.header}>
        <Pill label={`${matches.length} mutual`} tone="success" dot />
        <NeonText variant="h1" glow style={{ marginTop: spacing.sm }}>
          Connections
        </NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>
          {event.name}
        </NeonText>
      </View>

      {matches.length === 0 ? (
        <View style={styles.centered}>
          <NeonText variant="h2" tone="muted">No matches yet.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            Send a few signals from Discover — mutuals show up here.
          </NeonText>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Surface elevated padded style={styles.card}>
              <View style={{ gap: spacing.xs }}>
                <View style={styles.headerRow}>
                  <Pill label="Synced" tone="success" dot />
                  {item.other_is_premium ? <PremiumBadge size="sm" /> : null}
                </View>
                <NeonText variant="h2" style={{ marginTop: spacing.xs }}>
                  {item.other_name || `${item.other_user_id.slice(0, 8)}…`}
                </NeonText>
                {item.other_role ? (
                  <NeonText variant="label" tone="accent">{item.other_role}</NeonText>
                ) : null}
                {item.other_one_liner ? (
                  <NeonText variant="bodyMuted">{item.other_one_liner}</NeonText>
                ) : null}
                <NeonText variant="label" tone="dim" style={{ marginTop: spacing.xs }}>
                  {new Date(item.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </NeonText>
              </View>
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
  card: { borderRadius: radii.lg, marginBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  emptyCard: { width: '100%', borderRadius: radii.xl, gap: spacing.xs },
});
