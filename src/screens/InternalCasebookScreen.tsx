import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { evaluateInternalGraphCase } from '../admin/InternalGraphCasebookEngine';
import {
  createInternalGraphCase,
  loadInternalGraphCases,
  pinInternalGraphCaseNode,
  setInternalGraphCaseStatus,
  upsertInternalGraphCaseFinding,
  type InternalGraphCase,
} from '../admin/internalGraphCasebook.service';
import {
  getInternalBridgeSuppressions,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

export default function InternalCasebookScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [cases, setCases] = useState<InternalGraphCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [graph, setGraph] = useState<InternalGraphPayload | null>(null);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [nextCases, nextGraph, nextSuppressions] = await Promise.all([
        loadInternalGraphCases(),
        loadInternalIntelligenceGraph({ includeRestricted: false, limit: 1600 }),
        operator.has('graph_manage') ? getInternalBridgeSuppressions() : Promise.resolve(new Set<string>()),
      ]);
      setCases(nextCases);
      setGraph(nextGraph);
      setSuppressions(nextSuppressions);
      setSelectedCaseId((current) => current && nextCases.some((item) => item.id === current)
        ? current
        : nextCases.find((item) => item.status === 'active')?.id ?? nextCases[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Casebook unavailable', error instanceof Error ? error.message : 'Unable to load investigation state.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const searchResults = useMemo(() => {
    if (!graph || !query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return graph.nodes
      .filter((node) => node.label.toLowerCase().includes(needle) || node.kind.toLowerCase().includes(needle))
      .filter((node) => !selectedCase?.pins.some((pin) => pin.nodeId === node.id))
      .slice(0, 12);
  }, [graph, query, selectedCase]);

  const createCase = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const id = await createInternalGraphCase({
        title,
        objective: objective || null,
        targetQuery: targetQuery || null,
      });
      setCreateOpen(false);
      setTitle('');
      setObjective('');
      setTargetQuery('');
      await load();
      setSelectedCaseId(id);
    } catch (error) {
      Alert.alert('Case creation rejected', error instanceof Error ? error.message : 'Unable to create case.');
    } finally {
      setSaving(false);
    }
  };

  const pinNode = async (nodeId: string) => {
    if (!selectedCase) return;
    try {
      await pinInternalGraphCaseNode(selectedCase.id, nodeId);
      setQuery('');
      await load();
    } catch (error) {
      Alert.alert('Pin rejected', error instanceof Error ? error.message : 'Unable to pin node.');
    }
  };

  const evaluateCase = async () => {
    if (!selectedCase || !graph || !suppressions || !operator.has('graph_manage')) return;
    setEvaluating(true);
    try {
      const evaluation = evaluateInternalGraphCase({ investigation: selectedCase, payload: graph, suppressions });
      for (const finding of evaluation.findings) {
        await upsertInternalGraphCaseFinding({
          caseId: selectedCase.id,
          key: finding.key,
          class: finding.class,
          summary: finding.summary,
          score: finding.score,
          evidence: finding.evidence,
        });
      }
      await load();
      Alert.alert('Case re-evaluated', evaluation.summary.join('\n'));
    } catch (error) {
      Alert.alert('Evaluation failed', error instanceof Error ? error.message : 'Unable to re-evaluate case.');
    } finally {
      setEvaluating(false);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>ASSEMBLING CASEBOOK</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="CASEBOOK · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.14} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · SAVED INVESTIGATIONS" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Casebook</NeonText>
              <NeonText variant="bodyMuted">Persistent evidence cases · erasable person pins · agent re-evaluation · target ecosystems</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            {operator.has('graph_manage') ? <GlowButton label="New case" onPress={() => setCreateOpen(true)} variant="ghost" /> : null}
            <GlowButton label="Constellation" onPress={() => navigation.navigate('InternalGraph')} variant="ghost" />
            <GlowButton label="Epoch Lab" onPress={() => navigation.navigate('InternalEpochLab')} variant="ghost" />
            <GlowButton label="Strategy Lab" onPress={() => navigation.navigate('InternalStrategyLab')} variant="ghost" />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.caseRow}>
            {cases.map((investigation) => (
              <Pressable
                key={investigation.id}
                onPress={() => setSelectedCaseId(investigation.id)}
                style={[styles.caseChip, selectedCaseId === investigation.id && styles.caseChipActive]}
              >
                <NeonText variant="label" tone={selectedCaseId === investigation.id ? 'accent' : 'muted'}>{investigation.title.toUpperCase()}</NeonText>
                <NeonText variant="bodyMuted">{investigation.pins.length} pins · {investigation.findings.length} findings · {investigation.status}</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          {!selectedCase ? (
            <Surface elevated padded style={styles.emptyCard}>
              <NeonText variant="h2">No saved investigations.</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Create a case to preserve a target ecosystem, pin evidence, and let Constellation revisit it as topology evolves.</NeonText>
            </Surface>
          ) : (
            <>
              <Surface elevated padded glow style={styles.caseCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={selectedCase.status.toUpperCase()} tone={selectedCase.status === 'active' ? 'accent' : 'neutral'} dot />
                    <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selectedCase.title}</NeonText>
                    {selectedCase.objective ? <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{selectedCase.objective}</NeonText> : null}
                    {selectedCase.targetQuery ? <NeonText variant="label" tone="accent" style={{ marginTop: spacing.sm }}>TARGET · {selectedCase.targetQuery.toUpperCase()}</NeonText> : null}
                  </View>
                  {operator.has('graph_manage') ? (
                    <GlowButton
                      label={evaluating ? 'Evaluating…' : 'Re-evaluate'}
                      onPress={evaluateCase}
                      disabled={evaluating || !suppressions}
                      variant="ghost"
                    />
                  ) : null}
                </View>
                {operator.has('graph_manage') ? (
                  <View style={styles.actionRow}>
                    {selectedCase.status !== 'active' ? <GlowButton label="Activate" onPress={async () => { await setInternalGraphCaseStatus(selectedCase.id, 'active'); await load(); }} variant="ghost" /> : null}
                    {selectedCase.status === 'active' ? <GlowButton label="Pause" onPress={async () => { await setInternalGraphCaseStatus(selectedCase.id, 'paused'); await load(); }} variant="ghost" /> : null}
                    {selectedCase.status !== 'archived' ? <GlowButton label="Archive" onPress={async () => { await setInternalGraphCaseStatus(selectedCase.id, 'archived'); await load(); }} variant="ghost" /> : null}
                  </View>
                ) : null}
              </Surface>

              {operator.has('graph_manage') && selectedCase.status !== 'archived' ? (
                <View>
                  <NeonText variant="label" tone="accent">PIN GRAPH EVIDENCE</NeonText>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search a person, role, organization, project, venue…"
                    placeholderTextColor="#64748B"
                    style={styles.input}
                    autoCapitalize="none"
                  />
                  {searchResults.length > 0 ? (
                    <Surface padded style={styles.searchResults}>
                      {searchResults.map((node) => (
                        <Pressable key={node.id} onPress={() => pinNode(node.id)} style={styles.searchRow}>
                          <NeonText variant="body">{node.label}</NeonText>
                          <NeonText variant="label" tone="muted">{node.kind.toUpperCase()}</NeonText>
                        </Pressable>
                      ))}
                    </Surface>
                  ) : null}
                </View>
              ) : null}

              <Section title="PINNED EVIDENCE" subtitle="Person pins disappear automatically when their erasable graph alias is deleted">
                {selectedCase.pins.map((pin) => (
                  <Surface key={pin.nodeId} padded style={styles.smallCard}>
                    <View style={styles.rowBetween}>
                      <NeonText variant="h2">{pin.label}</NeonText>
                      <Pill label={pin.kind.toUpperCase()} tone="neutral" />
                    </View>
                    {pin.note ? <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{pin.note}</NeonText> : null}
                  </Surface>
                ))}
                {selectedCase.pins.length === 0 ? <NeonText variant="bodyMuted">No pinned evidence yet.</NeonText> : null}
              </Section>

              <Section title="LIVE CASE FINDINGS" subtitle="Internal analytical findings are refreshed from current Beacon evidence; they do not authorize outreach">
                {selectedCase.findings.slice(0, 30).map((finding) => (
                  <Surface key={finding.id} padded style={styles.smallCard}>
                    <View style={styles.rowBetween}>
                      <Pill label={finding.class.toUpperCase()} tone="accent" />
                      <NeonText variant="mono" tone="muted">{finding.score.toFixed(2)}</NeonText>
                    </View>
                    <NeonText variant="body" style={{ marginTop: spacing.sm }}>{finding.summary}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Last observed {new Date(finding.lastSeenAt).toLocaleDateString()}</NeonText>
                  </Surface>
                ))}
                {selectedCase.findings.length === 0 ? <NeonText variant="bodyMuted">Re-evaluate the case to generate the first evidence findings.</NeonText> : null}
              </Section>

              <Surface padded style={styles.contractCard}>
                <Pill label="CASE AUTONOMY CONTRACT" tone="neutral" dot />
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
                  Constellation may automatically refresh internal case findings and topology evidence. It cannot contact people, create introductions, change relationships, or treat a case score as a judgment of a person.
                </NeonText>
              </Surface>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Surface elevated padded glow style={styles.modalCard}>
            <Pill label="NEW CASE" tone="accent" dot />
            <TextInput value={title} onChangeText={setTitle} placeholder="Case title" placeholderTextColor="#64748B" style={styles.input} />
            <TextInput value={objective} onChangeText={setObjective} placeholder="Objective / question" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <TextInput value={targetQuery} onChangeText={setTargetQuery} placeholder="Target ecosystem (optional)" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
            <View style={styles.actionRow}>
              <GlowButton label={saving ? 'Creating…' : 'Create case'} onPress={createCase} disabled={saving || !title.trim()} />
              <GlowButton label="Cancel" onPress={() => setCreateOpen(false)} variant="ghost" />
            </View>
          </Surface>
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View>
        <NeonText variant="label" tone="accent">{title}</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#040711' },
  centered: { flex: 1, backgroundColor: '#040711', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  caseRow: { gap: spacing.sm, paddingRight: spacing.lg },
  caseChip: { minWidth: 200, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.7)' },
  caseChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.92)' },
  caseCard: { borderRadius: radii.xl },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  input: { marginTop: spacing.sm, minHeight: 44, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.76)' },
  multiline: { minHeight: 82, paddingTop: spacing.md, textAlignVertical: 'top' },
  searchResults: { marginTop: spacing.sm, borderRadius: radii.lg },
  searchRow: { paddingVertical: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.hairline },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  emptyCard: { borderRadius: radii.xl },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { width: '100%', maxWidth: 540, borderRadius: radii.xl },
});
