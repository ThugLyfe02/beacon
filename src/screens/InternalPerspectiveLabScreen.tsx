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
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import InternalGraphCanvas from '../admin/InternalGraphCanvas';
import { analyzeInternalGraph, type InternalGraphConfidence, type InternalGraphPayload } from '../admin/InternalGraphEngine';
import {
  applyInternalGraphPerspective,
  INTERNAL_GRAPH_BUILTIN_PERSPECTIVES,
  recommendInternalGraphSceneDirectives,
  type InternalGraphPerspectiveDefinition,
} from '../admin/InternalGraphPerspectiveEngine';
import {
  deleteInternalGraphPerspective,
  loadInternalGraphPerspectives,
  saveInternalGraphPerspective,
  type InternalSavedGraphPerspective,
} from '../admin/internalGraphPerspective.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type PerspectiveRoute = {
  InternalPerspectiveLab: { eventId?: string } | undefined;
};

const KIND_OPTIONS = ['person', 'event', 'venue', 'room', 'role', 'outcome', 'organization', 'domain', 'project', 'topic'];
const CONFIDENCE_OPTIONS: InternalGraphConfidence[] = ['VERIFIED', 'DERIVED', 'AMBIGUOUS'];
const AGE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '90D', value: 90 },
  { label: '120D', value: 120 },
  { label: '1Y', value: 365 },
  { label: '2Y', value: 730 },
  { label: 'ALL', value: null },
];

function customDefinition(input: {
  id: string;
  title: string;
  description: string;
  focusKinds: string[];
  relations: string[];
  confidenceFloor: InternalGraphConfidence;
  minEvidenceCount: number;
  maxAgeDays: number | null;
}): InternalGraphPerspectiveDefinition {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    focusKinds: input.focusKinds,
    relations: input.relations,
    confidenceFloor: input.confidenceFloor,
    minEvidenceCount: input.minEvidenceCount,
    maxAgeDays: input.maxAgeDays,
    includeIsolates: false,
    builtin: false,
  };
}

export default function InternalPerspectiveLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<PerspectiveRoute, 'InternalPerspectiveLab'>>();
  const eventId = route.params?.eventId ?? null;
  const operator = useInternalOperator();
  const [rawGraph, setRawGraph] = useState<InternalGraphPayload | null>(null);
  const [saved, setSaved] = useState<InternalSavedGraphPerspective[]>([]);
  const [selectedId, setSelectedId] = useState('evidence_first');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [focusKinds, setFocusKinds] = useState<string[]>([]);
  const [relationText, setRelationText] = useState('');
  const [confidenceFloor, setConfidenceFloor] = useState<InternalGraphConfidence>('DERIVED');
  const [minEvidenceCount, setMinEvidenceCount] = useState(1);
  const [maxAgeDays, setMaxAgeDays] = useState<number | null>(365);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [graph, catalog] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1600 }),
        loadInternalGraphPerspectives(),
      ]);
      setRawGraph(graph);
      setSaved(catalog.perspectives);
    } catch (error) {
      Alert.alert('Perspective Lab unavailable', error instanceof Error ? error.message : 'Unable to assemble graph lenses.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const allPerspectives = useMemo<InternalGraphPerspectiveDefinition[]>(
    () => [...INTERNAL_GRAPH_BUILTIN_PERSPECTIVES, ...saved],
    [saved],
  );
  const selected = allPerspectives.find((perspective) => perspective.id === selectedId)
    ?? INTERNAL_GRAPH_BUILTIN_PERSPECTIVES[0];
  const perspectiveResult = useMemo(
    () => rawGraph ? applyInternalGraphPerspective(rawGraph, selected) : null,
    [rawGraph, selected],
  );
  const analysis = useMemo(
    () => perspectiveResult ? analyzeInternalGraph(perspectiveResult.payload) : null,
    [perspectiveResult],
  );
  const directives = useMemo(
    () => rawGraph ? recommendInternalGraphSceneDirectives(rawGraph) : [],
    [rawGraph],
  );

  useEffect(() => {
    if (!perspectiveResult || !selectedNodeId) return;
    if (!perspectiveResult.payload.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(null);
  }, [perspectiveResult, selectedNodeId]);

  const toggleKind = (kind: string) => {
    setFocusKinds((current) => current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]);
  };

  const savePerspective = async () => {
    if (!operator.has('graph_manage')) return;
    if (title.trim().length < 3) {
      Alert.alert('Perspective title required', 'Use at least three characters so the saved lens remains recognizable later.');
      return;
    }
    const relations = relationText
      .split(',')
      .map((value) => value.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
      .slice(0, 40);
    setSaving(true);
    try {
      const id = await saveInternalGraphPerspective({
        title,
        description,
        definition: {
          focusKinds,
          relations,
          confidenceFloor,
          minEvidenceCount,
          maxAgeDays,
          includeIsolates: false,
        },
      });
      setTitle('');
      setDescription('');
      setRelationText('');
      setFocusKinds([]);
      setSelectedId(id);
      await load();
    } catch (error) {
      Alert.alert('Perspective rejected', error instanceof Error ? error.message : 'Unable to save lens.');
    } finally {
      setSaving(false);
    }
  };

  const deletePerspective = async (id: string) => {
    if (!operator.has('graph_manage')) return;
    try {
      await deleteInternalGraphPerspective(id);
      if (selectedId === id) setSelectedId('evidence_first');
      await load();
    } catch (error) {
      Alert.alert('Unable to delete Perspective', error instanceof Error ? error.message : 'Perspective deletion failed.');
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>ASSEMBLING ANALYTICAL LENSES</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_read')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="PERSPECTIVE LAB · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }
  if (!rawGraph || !perspectiveResult || !analysis) return null;

  const filtered = perspectiveResult.payload;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · PERSPECTIVE / SCENE DIRECTOR" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Lens Workbench</NeonText>
              <NeonText variant="bodyMuted">Task-specific business views over one canonical graph. Perspectives change visibility and analytical context, never evidence truth.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="PERSPECTIVE CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{perspectiveResult.operatingRule}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Scene version {perspectiveResult.sceneVersion.slice(0, 28)}… makes analytical context reproducible instead of an invisible UI preference.</NeonText>
          </Surface>

          <Section title="SCENE DIRECTOR" subtitle="Agents may recommend a lens. They cannot apply one autonomously or mutate graph evidence.">
            {directives.slice(0, 5).map((directive) => (
              <Pressable key={directive.id} onPress={() => setSelectedId(directive.perspectiveId)}>
                <Surface padded style={styles.directiveCard}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{directive.title}</NeonText>
                      <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{directive.rationale}</NeonText>
                    </View>
                    <Pill label={`P${directive.priority.toFixed(1)}`} tone="accent" />
                  </View>
                </Surface>
              </Pressable>
            ))}
          </Section>

          <Section title="PERSPECTIVE GALLERY" subtitle="Built-ins plus your bounded private lenses">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.perspectiveRow}>
              {allPerspectives.map((perspective) => (
                <Pressable key={perspective.id} onPress={() => setSelectedId(perspective.id)} style={[styles.perspectiveChip, perspective.id === selectedId && styles.perspectiveChipActive]}>
                  <NeonText variant="label" tone={perspective.id === selectedId ? 'accent' : 'muted'}>{perspective.title.toUpperCase()}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{perspective.builtin ? 'BUILT-IN' : 'PRIVATE'}</NeonText>
                </Pressable>
              ))}
            </ScrollView>
          </Section>

          <Surface elevated padded style={styles.selectedCard}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Pill label={selected.builtin ? 'BUILT-IN LENS' : 'PRIVATE LENS'} tone="accent" dot />
                <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selected.title}</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{selected.description}</NeonText>
              </View>
              {!selected.builtin && operator.has('graph_manage') ? <GlowButton label="Delete" variant="ghost" onPress={() => deletePerspective(selected.id)} /> : null}
            </View>
            <View style={styles.metricRow}>
              <Metric label="VISIBLE NODES" value={`${filtered.nodeCount}`} />
              <Metric label="VISIBLE EDGES" value={`${filtered.edgeCount}`} />
              <Metric label="HIDDEN NODES" value={`${perspectiveResult.hiddenNodeCount}`} />
              <Metric label="HIDDEN EDGES" value={`${perspectiveResult.hiddenEdgeCount}`} />
              <Metric label="COMMUNITIES" value={`${analysis.communities.length}`} />
            </View>
            <View style={styles.ruleRow}>
              <Pill label={`FLOOR ${selected.confidenceFloor}`} tone="neutral" />
              <Pill label={`EVIDENCE ≥ ${selected.minEvidenceCount}`} tone="neutral" />
              <Pill label={selected.maxAgeDays == null ? 'AGE ALL' : `AGE ≤ ${selected.maxAgeDays}D`} tone="neutral" />
              {selected.focusKinds.slice(0, 5).map((kind) => <Pill key={kind} label={kind.toUpperCase()} tone="neutral" />)}
            </View>
          </Surface>

          <InternalGraphCanvas payload={filtered} analysis={analysis} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />

          {operator.has('graph_manage') ? (
            <Section title="BUILD PRIVATE PERSPECTIVE" subtitle="A safe lens DSL: focus kinds, optional relations, evidence floor, repetition and recency. No person targets or arbitrary queries.">
              <TextInput value={title} onChangeText={setTitle} placeholder="Perspective title" placeholderTextColor="#64748B" style={styles.input} />
              <TextInput value={description} onChangeText={setDescription} placeholder="Why this lens exists" placeholderTextColor="#64748B" style={styles.input} />
              <NeonText variant="label" tone="muted">FOCUS KINDS · EMPTY = ALL</NeonText>
              <View style={styles.kindGrid}>
                {KIND_OPTIONS.map((kind) => (
                  <Pressable key={kind} onPress={() => toggleKind(kind)} style={[styles.kindChip, focusKinds.includes(kind) && styles.kindChipActive]}>
                    <NeonText variant="label" tone={focusKinds.includes(kind) ? 'accent' : 'muted'}>{kind.toUpperCase()}</NeonText>
                  </Pressable>
                ))}
              </View>
              <TextInput value={relationText} onChangeText={setRelationText} placeholder="Optional relations, comma separated: mutual_with, office_hours_with…" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
              <NeonText variant="label" tone="muted">CONFIDENCE FLOOR</NeonText>
              <View style={styles.kindGrid}>{CONFIDENCE_OPTIONS.map((floor) => <Pressable key={floor} onPress={() => setConfidenceFloor(floor)} style={[styles.kindChip, confidenceFloor === floor && styles.kindChipActive]}><NeonText variant="label" tone={confidenceFloor === floor ? 'accent' : 'muted'}>{floor}</NeonText></Pressable>)}</View>
              <NeonText variant="label" tone="muted">MINIMUM EVIDENCE COUNT</NeonText>
              <View style={styles.kindGrid}>{[1, 2, 3, 5].map((count) => <Pressable key={count} onPress={() => setMinEvidenceCount(count)} style={[styles.kindChip, minEvidenceCount === count && styles.kindChipActive]}><NeonText variant="label" tone={minEvidenceCount === count ? 'accent' : 'muted'}>N≥{count}</NeonText></Pressable>)}</View>
              <NeonText variant="label" tone="muted">RECENCY WINDOW</NeonText>
              <View style={styles.kindGrid}>{AGE_OPTIONS.map((option) => <Pressable key={option.label} onPress={() => setMaxAgeDays(option.value)} style={[styles.kindChip, maxAgeDays === option.value && styles.kindChipActive]}><NeonText variant="label" tone={maxAgeDays === option.value ? 'accent' : 'muted'}>{option.label}</NeonText></Pressable>)}</View>
              <GlowButton label={saving ? 'Saving…' : 'Save private Perspective'} disabled={saving} onPress={savePerspective} />
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
  return <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">{label}</NeonText><NeonText variant="h2" style={{ marginTop: 3 }}>{value}</NeonText></Surface>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  directiveCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  perspectiveRow: { gap: spacing.sm },
  perspectiveChip: { minWidth: 170, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.62)' },
  perspectiveChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  selectedCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  metricRow: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 118, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairline },
  kindChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
});
