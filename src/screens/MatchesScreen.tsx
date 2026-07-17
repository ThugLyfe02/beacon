import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { getUserEvents } from '../services/event.service';
import { listMatchesWithProfiles, type MatchWithProfile } from '../services/match.service';
import { listVaultEntries, updateVaultEntryStatus } from '../services/vault.service';
import { buildVaultSummary, type VaultEntry } from '../vault/VaultEngine';
import OutcomeHandshakeCard from '../components/OutcomeHandshakeCard';
import { FEATURE_FLAGS } from '../config/featureFlags';
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
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [matches, setMatches] = useState<MatchWithProfile[]>([]);
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingVaultId, setCompletingVaultId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const events = await getUserEvents(userId);
      if (events.length === 0) {
        setEvent(null);
        setMatches([]);
        setVaultEntries([]);
        return;
      }

      const activeEvent = events[0];
      setEvent(activeEvent);
      const [nextMatches, nextVault] = await Promise.all([
        listMatchesWithProfiles(activeEvent.id, userId),
        FEATURE_FLAGS.vault ? listVaultEntries(activeEvent.id, userId) : Promise.resolve([]),
      ]);
      setMatches(nextMatches);
      setVaultEntries(nextVault);
    } catch (error) {
      console.error('Failed to load matches:', error);
      Alert.alert('Signal lost', 'Could not load your opportunity state.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const vaultSummary = useMemo(() => buildVaultSummary(vaultEntries), [vaultEntries]);
  const priorityVaultEntries = useMemo(
    () => vaultEntries.filter((entry) => entry.status === 'open' && entry.nextAction).slice(0, 3),
    [vaultEntries],
  );

  async function completeVaultEntry(entry: VaultEntry) {
    setCompletingVaultId(entry.id);
    const success = await updateVaultEntryStatus(entry.id, userId, 'completed');
    setCompletingVaultId(null);
    if (!success) {
      Alert.alert('Vault update failed', 'The next action was not changed.');
      return;
    }
    setVaultEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'completed' } : item));
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={56} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading opportunity memory
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
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={loadData}
        ListHeaderComponent={(
          <View style={styles.header}>
            <Pill label={`${matches.length} mutual`} tone="success" dot />
            <NeonText variant="h1" glow style={{ marginTop: spacing.sm }}>Connections</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>{event.name}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
              A mutual is only the beginning. Beacon protects one-sided intent and converts compatible demand into concrete next steps.
            </NeonText>

            <View style={styles.actionRow}>
              <Pressable style={styles.headerButton} onPress={() => navigation.navigate('OfficeHoursInbox')}>
                <NeonText variant="label" tone="accent">OFFICE HOURS</NeonText>
              </Pressable>
            </View>

            {FEATURE_FLAGS.vault ? (
              <Surface elevated padded glow style={styles.vaultCard}>
                <View style={styles.vaultHeaderRow}>
                  <View>
                    <NeonText variant="label" tone="accent">PRIVATE VAULT</NeonText>
                    <NeonText variant="h2" style={{ marginTop: spacing.xs }}>{vaultSummary.headline}</NeonText>
                  </View>
                  <Pill label={`${vaultSummary.completionRate}% closed`} tone="success" dot />
                </View>

                <View style={styles.metricRow}>
                  <View style={styles.metric}><NeonText variant="h2">{vaultSummary.openActions}</NeonText><NeonText variant="label" tone="dim">OPEN</NeonText></View>
                  <View style={styles.metric}><NeonText variant="h2">{vaultSummary.completedActions}</NeonText><NeonText variant="label" tone="dim">DONE</NeonText></View>
                  <View style={styles.metric}><NeonText variant="h2">{vaultSummary.expiringSoon}</NeonText><NeonText variant="label" tone="dim">EXPIRING</NeonText></View>
                </View>

                {vaultSummary.insights[0] ? (
                  <View style={styles.insightBox}>
                    <NeonText variant="label" tone="accent">NEXT BEST MOVE</NeonText>
                    <NeonText variant="body" style={{ marginTop: spacing.xs }}>{vaultSummary.insights[0].title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs }}>{vaultSummary.insights[0].explanation}</NeonText>
                  </View>
                ) : null}

                {priorityVaultEntries.map((entry) => (
                  <View key={entry.id} style={styles.vaultActionRow}>
                    <View style={styles.vaultActionCopy}>
                      <NeonText variant="label" tone="dim">{entry.kind.replaceAll('_', ' ').toUpperCase()}</NeonText>
                      <NeonText variant="body" style={{ marginTop: 3 }}>{entry.title}</NeonText>
                      {entry.nextAction ? <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{entry.nextAction}</NeonText> : null}
                    </View>
                    <Pressable
                      disabled={completingVaultId === entry.id}
                      onPress={() => completeVaultEntry(entry)}
                      style={({ pressed }) => [styles.completeButton, pressed && styles.pressed]}
                    >
                      <NeonText variant="label">{completingVaultId === entry.id ? 'SAVING' : 'DONE'}</NeonText>
                    </Pressable>
                  </View>
                ))}
              </Surface>
            ) : null}
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.centeredList}>
            <NeonText variant="h2" tone="muted">No matches yet.</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
              Spend scarce signals carefully. Mutuals and their outcomes will appear here.
            </NeonText>
          </View>
        )}
        renderItem={({ item }) => {
          const displayName = item.other_name || `${item.other_user_id.slice(0, 8)}…`;
          return (
            <Surface elevated padded style={styles.card}>
              <View style={{ gap: spacing.xs }}>
                <View style={styles.cardHeaderRow}>
                  <Pill label="Synced" tone="success" dot />
                  {item.other_is_premium ? <PremiumBadge size="sm" /> : null}
                </View>
                <NeonText variant="h2" style={{ marginTop: spacing.xs }}>{displayName}</NeonText>
                {item.other_role ? <NeonText variant="label" tone="accent">{item.other_role}</NeonText> : null}
                {item.other_one_liner ? <NeonText variant="bodyMuted">{item.other_one_liner}</NeonText> : null}
                <NeonText variant="label" tone="dim" style={{ marginTop: spacing.xs }}>
                  {new Date(item.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </NeonText>
              </View>

              {FEATURE_FLAGS.outcomeHandshakeProtocol ? (
                <OutcomeHandshakeCard matchId={item.id} userId={userId} counterpartyName={displayName} />
              ) : null}
            </Surface>
          );
        }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void, paddingHorizontal: spacing.xl },
  centeredList: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  header: { paddingBottom: spacing.md, gap: 2 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: { borderRadius: radii.lg, marginBottom: spacing.md },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  headerButton: { alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: palette.accent, borderRadius: radii.md },
  vaultCard: { marginTop: spacing.lg, borderRadius: radii.xl },
  vaultHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  metricRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metric: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: 'rgba(255,255,255,0.03)' },
  insightBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: 'rgba(56,189,248,0.08)' },
  vaultActionRow: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vaultActionCopy: { flex: 1 },
  completeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: palette.accent },
  pressed: { opacity: 0.8 },
  emptyCard: { width: '100%', borderRadius: radii.xl, gap: spacing.xs },
});
