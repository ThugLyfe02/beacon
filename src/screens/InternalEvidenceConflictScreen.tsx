import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { analyzeInternalEvidenceTensions } from '../admin/InternalEvidenceTensionEngine';
import type { InternalGraphEdge, InternalGraphPayload } from '../admin/InternalGraphEngine';
import {
  createInternalEvidenceConflict,
  loadInternalEvidenceConflicts,
  resolveInternalEvidenceConflict,
  type InternalEvidenceConflict,
  type InternalEvidenceConflictKind,
} from '../admin/internalEvidenceConflict.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type ConflictRoute = {
  InternalEvidenceConflicts: { eventId?: string } | undefined;
};

const KINDS: Array<{ value: InternalEvidenceConflictKind; label: string }> = [
  { value: 'provenance_disagreement', label: 'PROVENANCE' },
  { value: 'temporal_overlap', label: 'TEMPORAL' },
  { value: 'state_collision', label: 'STATE' },
  { value: 'scope_mismatch', label: 'SCOPE' },
  { value: 'manual_review', label: 'MANUAL' },
];

function edgeSummary(graph: InternalGraphPayload | null, edgeId: string): string {
  const edge = graph?.edges.find((item) => item.id === edgeId);
  if (!edge || !graph) return edgeId;
  const source = graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source;
  const target = graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target;
  return `${source} → ${target} · ${edge.relation.replaceAll('_', ' ')} · ${edge.confidence}`;
}

function edgeWindow(edge: InternalGraphEdge): string {
  const first = new Date(edge.firstSeenAt).toLocaleDateString();
  const last = new Date(edge.lastSeenAt).toLocaleDateString();
  return first === last ? first : `${first} → ${last}`;
}

export default function InternalEvidenceConflictScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<ConflictRoute, 'InternalEvidenceConflicts'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [graph, setGraph] = useState<InternalGraphPayload | null>(null);
  const [conflicts, setConflicts] = useState<InternalEvidenceConflict[]>([]);
  const [leftEdgeId, setLeftEdgeId] = useState<string | null>(null);
  const [rightEdgeId, setRightEdgeId] = useState<string | null>(null);
  const [kind, setKind] = useState<InternalEvidenceConflictKind>('manual_review');
  const [priority, setPriority] = useState(3);
  const [rationale, setRationale] = useState('');
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [payload, ledger] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: operator.restricted, limit: 2000 }),
        loadInternalEvidenceConflicts({ eventId, includeClosed: true, limit: 200 }),
      ]);
      setGraph(payload);
      setConflicts(ledger.conflicts);
    } catch (error) {
      Alert.alert('Evidence Conflict Ledger unavailable', error instanceof Error ? error.message : 'Unable to load conflict state.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const tensions = useMemo(() => graph ? analyzeInternalEvidenceTensions(graph) : [], [graph]);
  const openConflicts = useMemo(() => conflicts.filter((item) => item.status === 'open'), [conflicts]);
  const selectedConflict = conflicts.find((item) => item.id === selectedConflictId) ?? null;

  const useTension = (tension: ReturnType<typeof analyzeInternalEvidenceTensions>[number]) => {
    setLeftEdgeId(tension.leftEdgeId);
    setRightEdgeId(tension.rightEdgeId);
    setKind(tension.suggestedConflictKind);
    setPriority(tension.score >= 0.8 ? 5 : tension.score >= 0.65 ? 4 : 3);
    setRationale(tension.reasons.join(' '));
  };

  const create = async () => {
    if (!graph || !leftEdgeId || !rightEdgeId || rationale.trim().length < 8) {
      Alert.alert('Conflict review incomplete', 'Choose two evidence edges and add a bounded rationale before confirming a conflict.');
      return;
    }
    setSaving(true);
    try {
      await createInternalEvidenceConflict({
        eventId,
        graphVersion: graph.graphVersion,
        leftEdgeId,
        rightEdgeId,
        kind,
        reviewPriority: priority,
        rationale,
      });
      setLeftEdgeId(null);
      setRightEdgeId(null);
      setRationale('');
      setKind('manual_review');
      setPriority(3);
      await load();
    } catch (error) {
      Alert.alert('Conflict not recorded', error instanceof Error ? error.message : 'Evidence conflict creation failed.');
    } finally {
      setSaving(false);
    }
  };

  const closeConflict = async (status: 'resolved' | 'dismissed') => {
    if (!selectedConflict || resolutionNote.trim().length < 3) {
      Alert.alert('Resolution note required', 'Select an open conflict and add a bounded resolution note.');
      return;
    }
    setSaving(true);
    try {
      await resolveInternalEvidenceConflict({ conflictId: selectedConflict.id, status, resolutionNote });
      setSelectedConflictId(null);
      setResolutionNote('');
      await load();
    } catch (error) {
      Alert.alert('Conflict update failed', error instanceof Error ? error.message : 'Unable to close evidence conflict.');
    } finally {
      setSaving(false);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>LOADING EVIDENCE CONFLICTS</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage') || !graph) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="EVIDENCE CONFLICTS · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · EVIDENCE CONFLICT LEDGER" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Conflict Review</NeonText>
              <NeonText variant="bodyMuted">Preserve both evidence edges · confirm conflicts explicitly · resolve review state without rewriting canonical truth</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="CONFLICT CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>Tension suggestions are not contradictions. Only an operator can confirm a ledger conflict. Open conflict never means either evidence edge is false, and resolving the ledger never mutates the underlying graph.</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{operator.restricted ? 'Restricted safety topology is available in this review session.' : 'Restricted safety topology is not loaded; standard evidence only.'}</NeonText>
          </Surface>

          <View style={styles.metricRow}>
            <Metric label="OPEN CONFLICTS" value={`${openConflicts.length}`} />
            <Metric label="TENSION CANDIDATES" value={`${tensions.length}`} />
            <Metric label="GRAPH EDGES" value={`${graph.edgeCount}`} />
          </View>

          <Section title="EVIDENCE TENSIONS" subtitle="Automatically surfaced review candidates. Loading one into the builder does not create a conflict.">
            {tensions.slice(0, 20).map((tension) => (
              <Surface key={tension.id} elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}><Pill label={`${tension.kind.replaceAll('_', ' ').toUpperCase()} · S${Math.round(tension.score * 100)}`} tone="neutral" /><NeonText variant="body" style={{ marginTop: spacing.sm }}>{edgeSummary(graph, tension.leftEdgeId)}</NeonText><NeonText variant="body" style={{ marginTop: 3 }}>{edgeSummary(graph, tension.rightEdgeId)}</NeonText></View>
                </View>
                {tension.reasons.map((reason, index) => <NeonText key={`${tension.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <GlowButton label="Load into conflict review" variant="ghost" onPress={() => useTension(tension)} />
              </Surface>
            ))}
            {tensions.length === 0 ? <NeonText variant="bodyMuted">No automatic evidence tensions detected in the currently authorized graph.</NeonText> : null}
          </Section>

          <Section title="CONFIRM CONFLICT" subtitle="An operator confirmation creates review state only; it does not choose which evidence is true.">
            {leftEdgeId && rightEdgeId ? (
              <Surface padded style={styles.card}>
                <NeonText variant="label" tone="accent">LEFT</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{edgeSummary(graph, leftEdgeId)}</NeonText>
                <NeonText variant="label" tone="accent" style={{ marginTop: spacing.sm }}>RIGHT</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{edgeSummary(graph, rightEdgeId)}</NeonText>
              </Surface>
            ) : <NeonText variant="bodyMuted">Load a tension candidate to populate the two evidence edges.</NeonText>}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {KINDS.map((item) => <Pressable key={item.value} onPress={() => setKind(item.value)} style={[styles.chip, kind === item.value && styles.chipActive]}><NeonText variant="label" tone={kind === item.value ? 'accent' : 'muted'}>{item.label}</NeonText></Pressable>)}
            </ScrollView>
            <View style={styles.chipRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.chip, priority === value && styles.chipActive]}><NeonText variant="label" tone={priority === value ? 'accent' : 'muted'}>P{value}</NeonText></Pressable>)}</View>
            <TextInput value={rationale} onChangeText={setRationale} placeholder="Why do these two evidence edges require explicit reconciliation?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <GlowButton label={saving ? 'Recording…' : 'Confirm evidence conflict'} disabled={saving} onPress={() => void create()} />
          </Section>

          <Section title="OPEN LEDGER" subtitle="Priority is review urgency for evidence reconciliation—not a risk score for a person or organization.">
            {openConflicts.map((conflict) => (
              <Pressable key={conflict.id} onPress={() => setSelectedConflictId(conflict.id)}>
                <Surface elevated padded style={[styles.card, selectedConflictId === conflict.id && styles.selectedBorder]}>
                  <View style={styles.rowBetween}><Pill label={`P${conflict.reviewPriority} · ${conflict.kind.replaceAll('_', ' ').toUpperCase()}`} tone={conflict.reviewPriority >= 4 ? 'accent' : 'neutral'} dot={conflict.reviewPriority >= 4} /><NeonText variant="label" tone="muted">{new Date(conflict.createdAt).toLocaleDateString()}</NeonText></View>
                  <NeonText variant="body" style={{ marginTop: spacing.sm }}>{edgeSummary(graph, conflict.leftEdgeId)}</NeonText>
                  <NeonText variant="body" style={{ marginTop: 3 }}>{edgeSummary(graph, conflict.rightEdgeId)}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{conflict.rationale}</NeonText>
                </Surface>
              </Pressable>
            ))}
            {openConflicts.length === 0 ? <NeonText variant="bodyMuted">No open operator-confirmed evidence conflicts.</NeonText> : null}
          </Section>

          {selectedConflict ? (
            <Section title="RESOLVE SELECTED CONFLICT" subtitle="Resolution closes the review obligation; both source evidence edges remain unchanged.">
              <TextInput value={resolutionNote} onChangeText={setResolutionNote} placeholder="What did the review establish, or why was the conflict dismissed?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
              <View style={styles.actionRow}><GlowButton label="Resolved" variant="ghost" disabled={saving} onPress={() => void closeConflict('resolved')} /><GlowButton label="Dismissed" variant="ghost" disabled={saving} onPress={() => void closeConflict('dismissed')} /></View>
            </Section>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></Surface>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 120, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  selectedBorder: { borderColor: palette.accent },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
