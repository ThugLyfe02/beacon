import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  loadInternalReasoningRevalidationQueue,
  updateInternalReasoningRevalidationObligation,
  type InternalReasoningRevalidationObligation,
} from '../admin/internalReasoningRevalidation.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type QueueRoute = { InternalReasoningRevalidation: { eventId?: string } | undefined };

function destinationFor(item: InternalReasoningRevalidationObligation): string {
  if (item.reasonKind === 'evidence_conflict') return 'InternalReasoningLineage';
  if (item.artifactKind === 'case') return 'InternalCollaborativeCaseMemory';
  if (item.artifactKind === 'machine_manifest') return 'InternalMachineRegistry';
  if (item.reasonKind === 'temporal_incoherence') return 'InternalAgenticTimeline';
  return 'InternalDecisionJournal';
}

export default function InternalReasoningRevalidationScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<QueueRoute, 'InternalReasoningRevalidation'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [items, setItems] = useState<InternalReasoningRevalidationObligation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const state = await loadInternalReasoningRevalidationQueue({ eventId, includeResolved: false, limit: 320 });
      setItems(state.obligations);
    } catch (error) {
      Alert.alert('Revalidation Queue unavailable', error instanceof Error ? error.message : 'Unable to load reasoning obligations.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const counts = useMemo(() => ({
    open: items.filter((item) => item.status === 'open').length,
    acknowledged: items.filter((item) => item.status === 'acknowledged').length,
    critical: items.filter((item) => item.priority >= 4).length,
  }), [items]);

  const update = async (status: 'acknowledged' | 'resolved') => {
    if (!selected) return;
    if (status === 'resolved' && resolutionNote.trim().length < 3) {
      Alert.alert('Resolution note required', 'Record what was revalidated before closing the analytical obligation.');
      return;
    }
    setSaving(true);
    try {
      await updateInternalReasoningRevalidationObligation({ id: selected.id, status, resolutionNote });
      setSelectedId(null);
      setResolutionNote('');
      await load();
    } catch (error) {
      Alert.alert('Revalidation update failed', error instanceof Error ? error.message : 'Unable to update obligation.');
    } finally {
      setSaving(false);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>LOADING REVALIDATION OBLIGATIONS</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="REVALIDATION QUEUE · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · DURABLE ANALYTICAL REMEDIATION" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Revalidation Queue</NeonText>
              <NeonText variant="bodyMuted">Persist exactly which analytical artifact needs review, why, and what source condition triggered it. Closing the task records review—not truth.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metrics}>
            <Metric label="OPEN" value={`${counts.open}`} />
            <Metric label="ACKNOWLEDGED" value={`${counts.acknowledged}`} />
            <Metric label="P4/P5" value={`${counts.critical}`} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="REVALIDATION CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>Conflict-derived decision obligations are created only from exact stored decision→edge refs. A revalidation obligation never changes graph evidence, hypothesis status, social permissions, or person/entity scores.</NeonText>
          </Surface>

          {items.map((item) => (
            <Pressable key={item.id} onPress={() => setSelectedId(item.id)}>
              <Surface elevated padded style={[styles.card, selectedId === item.id && styles.selected, item.priority >= 4 ? styles.warning : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}><Pill label={`P${item.priority} · ${item.status.toUpperCase()} · ${item.reasonKind.replaceAll('_', ' ').toUpperCase()}`} tone={item.priority >= 4 ? 'accent' : 'neutral'} dot={item.status === 'open'} /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{item.artifactKind.replaceAll('_', ' ')} · {item.artifactId.slice(0, 12)}…</NeonText></View>
                  <NeonText variant="mono" tone="muted">{new Date(item.createdAt).toLocaleDateString()}</NeonText>
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{item.rationale}</NeonText>
                <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>graph {item.graphVersion.slice(0, 18)}…{item.sourceId ? ` · source ${item.sourceId.slice(0, 10)}…` : ''}</NeonText>
                <GlowButton label="Open evidence surface" variant="ghost" onPress={() => navigation.navigate(destinationFor(item), { eventId: item.eventId ?? eventId ?? undefined })} />
              </Surface>
            </Pressable>
          ))}
          {items.length === 0 ? <NeonText variant="bodyMuted">No active reasoning revalidation obligations.</NeonText> : null}

          {selected ? (
            <Surface elevated padded style={styles.selectedCard}>
              <Pill label="SELECTED OBLIGATION" tone="accent" dot />
              <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{selected.reasonKind.replaceAll('_', ' ')}</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{selected.rationale}</NeonText>
              <TextInput value={resolutionNote} onChangeText={setResolutionNote} placeholder="What review was performed and what is the updated analytical interpretation?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
              <View style={styles.actions}>
                {selected.status === 'open' ? <GlowButton label="Acknowledge" variant="ghost" disabled={saving} onPress={() => void update('acknowledged')} /> : null}
                <GlowButton label="Resolve after revalidation" variant="ghost" disabled={saving} onPress={() => void update('resolved')} />
              </View>
            </Surface>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></Surface>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 120, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  selected: { borderColor: palette.accent },
  warning: { borderColor: '#F59E0B' },
  selectedCard: { borderRadius: radii.xl, borderColor: palette.accent },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  input: { marginTop: spacing.sm, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
