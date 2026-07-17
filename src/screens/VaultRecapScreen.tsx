import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { buildVaultSummary, type VaultEntry } from '../vault/VaultEngine';
import { listVaultEntries, updateVaultEntryStatus } from '../services/vault.service';

type VaultRoute = RouteProp<{ VaultRecap: { eventId: string; userId: string; eventName?: string } }, 'VaultRecap'>;

function kindLabel(kind: VaultEntry['kind']): string {
  switch (kind) {
    case 'mutual': return 'MUTUAL';
    case 'missed_category': return 'MISSED PATTERN';
    case 'office_hours': return 'OFFICE HOURS';
    case 'next_action': return 'NEXT ACTION';
    case 'note': return 'NOTE';
  }
}

export default function VaultRecapScreen() {
  const route = useRoute<VaultRoute>();
  const { eventId, userId, eventName } = route.params;
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listVaultEntries(eventId, userId));
    } finally {
      setLoading(false);
    }
  }, [eventId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => buildVaultSummary(entries), [entries]);

  async function complete(entry: VaultEntry) {
    setUpdatingId(entry.id);
    const success = await updateVaultEntryStatus(entry.id, userId, 'completed');
    setUpdatingId(null);
    if (!success) {
      Alert.alert('Vault update failed', 'The action was not changed. Please retry.');
      return;
    }
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'completed' } : item));
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#F59E0B" size="large" />
        <Text style={styles.loadingText}>Building your opportunity memory…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.id}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={(
          <View style={styles.header}>
            <Text style={styles.eyebrow}>PRIVATE EVENT MEMORY</Text>
            <Text style={styles.title}>{summary.headline}</Text>
            <Text style={styles.subtitle}>{eventName ?? 'Event recap'}</Text>

            <View style={styles.metricGrid}>
              <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.capturedMutuals}</Text><Text style={styles.metricLabel}>Captured</Text></View>
              <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.openActions}</Text><Text style={styles.metricLabel}>Open</Text></View>
              <View style={styles.metricCard}><Text style={styles.metricValue}>{summary.completionRate}%</Text><Text style={styles.metricLabel}>Completed</Text></View>
            </View>

            {summary.insights.slice(0, 2).map((insight) => (
              <View key={insight.code} style={styles.insightCard}>
                <Text style={styles.insightTitle}>{insight.title}</Text>
                <Text style={styles.insightText}>{insight.explanation}</Text>
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing passive lives here.</Text>
            <Text style={styles.emptyText}>Mutuals, aligned outcomes, Office Hours, and privacy-safe missed patterns will appear after the event creates something worth preserving.</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.entryCard}>
            <View style={styles.row}>
              <Text style={styles.kind}>{kindLabel(item.kind)}</Text>
              <Text style={[styles.status, item.status === 'completed' && styles.completed]}>{item.status.toUpperCase()}</Text>
            </View>
            <Text style={styles.entryTitle}>{item.title}</Text>
            {item.detail ? <Text style={styles.entryDetail}>{item.detail}</Text> : null}
            {item.nextAction ? <Text style={styles.nextAction}>{item.nextAction}</Text> : null}
            {item.status === 'open' && item.nextAction ? (
              <Pressable disabled={updatingId === item.id} onPress={() => complete(item)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                {updatingId === item.id ? <ActivityIndicator color="#071018" /> : <Text style={styles.actionText}>Mark outcome complete</Text>}
              </Pressable>
            ) : null}
          </View>
        )}
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070B12' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070B12', padding: 24 },
  loadingText: { marginTop: 14, color: '#94A3B8', fontSize: 13 },
  content: { padding: 18, paddingBottom: 44 },
  header: { marginBottom: 14 },
  eyebrow: { color: '#F59E0B', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { marginTop: 8, color: '#F8FAFC', fontSize: 27, lineHeight: 32, fontWeight: '800' },
  subtitle: { marginTop: 6, color: '#94A3B8', fontSize: 14 },
  metricGrid: { flexDirection: 'row', gap: 8, marginTop: 18 },
  metricCard: { flex: 1, borderRadius: 14, padding: 12, backgroundColor: '#111827', borderWidth: 1, borderColor: '#1F2937' },
  metricValue: { color: '#F8FAFC', fontSize: 21, fontWeight: '800' },
  metricLabel: { marginTop: 3, color: '#94A3B8', fontSize: 11 },
  insightCard: { marginTop: 10, borderRadius: 16, padding: 14, backgroundColor: '#111A2B', borderWidth: 1, borderColor: 'rgba(56,189,248,0.18)' },
  insightTitle: { color: '#E0F2FE', fontSize: 14, fontWeight: '800' },
  insightText: { marginTop: 5, color: '#9FB0C6', fontSize: 12, lineHeight: 18 },
  entryCard: { marginTop: 10, borderRadius: 18, padding: 15, backgroundColor: '#0E1522', borderWidth: 1, borderColor: '#202B3D' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: { color: '#7DD3FC', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  status: { color: '#F59E0B', fontSize: 10, fontWeight: '800' },
  completed: { color: '#34D399' },
  entryTitle: { marginTop: 10, color: '#F8FAFC', fontSize: 17, fontWeight: '800' },
  entryDetail: { marginTop: 6, color: '#A8B3C5', fontSize: 13, lineHeight: 19 },
  nextAction: { marginTop: 10, color: '#FCD34D', fontSize: 13, lineHeight: 19 },
  actionButton: { marginTop: 13, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F59E0B' },
  actionText: { color: '#071018', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  emptyCard: { marginTop: 24, borderRadius: 18, padding: 18, backgroundColor: '#0E1522', borderWidth: 1, borderColor: '#202B3D' },
  emptyTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  emptyText: { marginTop: 8, color: '#94A3B8', fontSize: 13, lineHeight: 20 },
});
