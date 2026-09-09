import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { buildInternalAgenticTimeline } from '../admin/InternalAgenticTimelineEngine';
import { analyzeInternalGraphEpistemicHealth } from '../admin/InternalGraphEpistemicHealthEngine';
import {
  appendInternalCaseMemory,
  assignInternalGraphCase,
  loadInternalCaseCollaboration,
  type InternalCaseCollaborationState,
  type InternalCaseMemoryKind,
} from '../admin/internalCaseMemory.service';
import { loadInternalGraphCases, type InternalGraphCase } from '../admin/internalGraphCasebook.service';
import { loadInternalHandoffOperatorDirectory, type InternalHandoffOperator } from '../admin/internalGraphHandoff.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

const ENTRY_KINDS: InternalCaseMemoryKind[] = [
  'checkpoint', 'question', 'verification', 'decision', 'timeline', 'note',
];

export default function InternalCollaborativeCaseMemoryScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [cases, setCases] = useState<InternalGraphCase[]>([]);
  const [operators, setOperators] = useState<InternalHandoffOperator[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<InternalCaseCollaborationState | null>(null);
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [entryKind, setEntryKind] = useState<InternalCaseMemoryKind>('checkpoint');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  const loadBase = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [caseRows, operatorRows] = await Promise.all([
        loadInternalGraphCases(),
        loadInternalHandoffOperatorDirectory(),
      ]);
      setCases(caseRows);
      setOperators(operatorRows);
      setSelectedCaseId((current) => current && caseRows.some((item) => item.id === current)
        ? current
        : caseRows.find((item) => item.status === 'active')?.id ?? caseRows[0]?.id ?? null);
    } catch (error) {
      Alert.alert('Collaborative memory unavailable', error instanceof Error ? error.message : 'Unable to load Casebook collaboration state.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => {
    if (!operator.loading) void loadBase();
  }, [operator.loading, loadBase]);

  const loadSelected = useCallback(async () => {
    if (!selectedCase || !operator.allowed || !operator.has('graph_manage')) {
      setCollaboration(null);
      setGraph(null);
      return;
    }
    try {
      const [memory, payload] = await Promise.all([
        loadInternalCaseCollaboration(selectedCase.id),
        loadInternalIntelligenceGraph({ eventId: selectedCase.scopeEventId, includeRestricted: false, limit: 1800 }),
      ]);
      setCollaboration(memory);
      setGraph(payload);
    } catch (error) {
      Alert.alert('Unable to load selected case', error instanceof Error ? error.message : 'Case collaboration load failed.');
    }
  }, [selectedCase, operator]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  const assign = async (operatorId: string | null) => {
    if (!selectedCase) return;
    try {
      await assignInternalGraphCase(selectedCase.id, operatorId);
      await loadSelected();
    } catch (error) {
      Alert.alert('Assignment rejected', error instanceof Error ? error.message : 'Unable to assign case.');
    }
  };

  const append = async () => {
    if (!selectedCase || !graph || title.trim().length < 1 || body.trim().length < 1) {
      Alert.alert('Memory entry incomplete', 'Choose a case and add a title and bounded analytical note.');
      return;
    }
    setSaving(true);
    try {
      const health = analyzeInternalGraphEpistemicHealth(graph);
      const timeline = buildInternalAgenticTimeline(graph);
      await appendInternalCaseMemory({
        caseId: selectedCase.id,
        kind: entryKind,
        graphVersion: graph.graphVersion,
        title,
        body,
        evidenceSummary: {
          schemaVersion: 'collaborative-case-memory-v1',
          graphVersion: graph.graphVersion,
          nodeCount: graph.nodeCount,
          edgeCount: graph.edgeCount,
          epistemicHealth: { band: health.band, score: health.score },
          timeline: {
            eventCount: timeline.events.length,
            episodeCount: timeline.episodes.length,
            chronologyGapCount: timeline.chronologyGapCount,
          },
          caseFindingCount: selectedCase.findings.length,
          casePinCount: selectedCase.pins.length,
        },
      });
      setTitle('');
      setBody('');
      await loadSelected();
    } catch (error) {
      Alert.alert('Memory entry rejected', error instanceof Error ? error.message : 'Unable to append collaborative memory.');
    } finally {
      setSaving(false);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>LOADING COLLABORATIVE MEMORY</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="COLLABORATIVE CASE MEMORY · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · COLLABORATIVE INVESTIGATION MEMORY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Case Memory</NeonText>
              <NeonText variant="bodyMuted">Assignment · canonical checkpoints · falsifiable questions · verification notes · timeline findings · decision memory · handoff continuity</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="COLLABORATION CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Case memory stores bounded operator reasoning tied to canonical graph versions and evidence digests. It does not clone graph payloads, create relationship truth, or authorize social action.</NeonText>
          </Surface>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {cases.map((item) => (
              <Pressable key={item.id} onPress={() => setSelectedCaseId(item.id)} style={[styles.chip, item.id === selectedCaseId && styles.chipActive]}>
                <NeonText variant="label" tone={item.id === selectedCaseId ? 'accent' : 'muted'}>{item.title.toUpperCase()}</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          {selectedCase && collaboration && graph ? (
            <>
              <Surface elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label="CASE CONTEXT" tone="accent" dot />
                    <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selectedCase.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{selectedCase.objective ?? 'No objective recorded.'}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">{collaboration.entries.length} ENTRIES</NeonText>
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>graph {graph.graphVersion.slice(0, 24)}… · assigned {collaboration.assignedOperatorLabel ?? 'unassigned'}</NeonText>
              </Surface>

              <View style={styles.section}>
                <NeonText variant="label" tone="accent">ASSIGNMENT</NeonText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  <Pressable onPress={() => void assign(null)} style={[styles.chip, !collaboration.assignedOperatorId && styles.chipActive]}><NeonText variant="label" tone={!collaboration.assignedOperatorId ? 'accent' : 'muted'}>UNASSIGNED</NeonText></Pressable>
                  {operators.map((item) => (
                    <Pressable key={item.id} onPress={() => void assign(item.id)} style={[styles.chip, collaboration.assignedOperatorId === item.id && styles.chipActive]}>
                      <NeonText variant="label" tone={collaboration.assignedOperatorId === item.id ? 'accent' : 'muted'}>{item.label.toUpperCase()}</NeonText>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.section}>
                <NeonText variant="label" tone="accent">APPEND ANALYTICAL MEMORY</NeonText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {ENTRY_KINDS.map((kind) => (
                    <Pressable key={kind} onPress={() => setEntryKind(kind)} style={[styles.chip, entryKind === kind && styles.chipActive]}>
                      <NeonText variant="label" tone={entryKind === kind ? 'accent' : 'muted'}>{kind.toUpperCase()}</NeonText>
                    </Pressable>
                  ))}
                </ScrollView>
                <TextInput value={title} onChangeText={setTitle} placeholder="Checkpoint / question title" placeholderTextColor="#64748B" style={styles.input} />
                <TextInput value={body} onChangeText={setBody} placeholder="What should the next operator remember, verify, falsify or revisit?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
                <GlowButton label={saving ? 'Sealing…' : 'Seal canonical memory entry'} disabled={saving} onPress={() => void append()} />
              </View>

              <View style={styles.section}>
                <NeonText variant="label" tone="accent">CASE CHRONOLOGY</NeonText>
                {collaboration.entries.map((entry) => (
                  <Surface key={entry.id} elevated padded style={styles.card}>
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Pill label={entry.kind.toUpperCase()} tone={entry.kind === 'decision' || entry.kind === 'verification' ? 'accent' : 'neutral'} dot />
                        <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{entry.title}</NeonText>
                        <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{entry.body}</NeonText>
                      </View>
                      <NeonText variant="label" tone="muted">{entry.authorLabel}</NeonText>
                    </View>
                    <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{new Date(entry.createdAt).toLocaleString()} · evidence {entry.evidenceDigest.slice(0, 12)}… · graph {entry.graphVersion.slice(0, 16)}…</NeonText>
                  </Surface>
                ))}
                {collaboration.entries.length === 0 ? <NeonText variant="bodyMuted">No collaborative memory yet. Handoff transitions will also appear here automatically.</NeonText> : null}
              </View>
            </>
          ) : <NeonText variant="bodyMuted">Create or select an active Casebook case to begin collaborative memory.</NeonText>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  chipRow: { gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  section: { gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
});