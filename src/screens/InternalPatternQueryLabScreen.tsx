import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  runInternalGraphPatternQuery,
  suggestInternalGraphPatterns,
  type InternalGraphPatternDefinition,
} from '../admin/InternalGraphPatternQueryEngine';
import type { InternalGraphConfidence, InternalGraphPayload } from '../admin/InternalGraphEngine';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type PatternRoute = { InternalPatternQueryLab: { eventId?: string } | undefined };
const FLOORS: InternalGraphConfidence[] = ['VERIFIED', 'DERIVED', 'AMBIGUOUS'];

function nodeLabel(payload: InternalGraphPayload | null, id: string): string {
  return payload?.nodes.find((node) => node.id === id)?.label ?? id;
}

function normalize(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || null;
}

export default function InternalPatternQueryLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<PatternRoute, 'InternalPatternQueryLab'>>();
  const eventId = route.params?.eventId ?? null;
  const operator = useInternalOperator();
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [definition, setDefinition] = useState<InternalGraphPatternDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [startKind, setStartKind] = useState('person');
  const [relationA, setRelationA] = useState('mutual_with');
  const [middleKind, setMiddleKind] = useState('person');
  const [relationB, setRelationB] = useState('office_hours_with');
  const [endKind, setEndKind] = useState('person');
  const [confidenceFloor, setConfidenceFloor] = useState<InternalGraphConfidence>('VERIFIED');
  const [minEvidenceCount, setMinEvidenceCount] = useState(1);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      setPayload(await loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1600 }));
    } catch (error) {
      Alert.alert('Pattern Grammar unavailable', error instanceof Error ? error.message : 'Unable to load graph evidence.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const suggestions = useMemo(() => payload ? suggestInternalGraphPatterns(payload) : [], [payload]);
  const result = useMemo(
    () => payload && definition ? runInternalGraphPatternQuery(payload, definition) : null,
    [payload, definition],
  );

  const runCustom = () => {
    setDefinition({
      id: `custom-${Date.now()}`,
      title: 'Custom two-hop pattern',
      nodeConstraints: [
        { kind: normalize(startKind) },
        { kind: normalize(middleKind) },
        { kind: normalize(endKind) },
      ],
      edgeConstraints: [
        { relation: normalize(relationA), confidenceFloor, minEvidenceCount },
        { relation: normalize(relationB), confidenceFloor, minEvidenceCount },
      ],
      maxResults: 60,
    });
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>COMPILING GRAPH GRAMMAR</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_read')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="PATTERN GRAMMAR · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }
  if (!payload) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · BOUNDED GRAPH PATTERN SEARCH" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Pattern Grammar</NeonText>
              <NeonText variant="bodyMuted">Bloom-style structural search over authorized Beacon evidence—without arbitrary Cypher, SQL, or external enrichment.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="QUERY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Patterns are path-shaped, bounded to four edges in the engine, and operate only over the graph already authorized for this operator. A match is evidence structure, not a contact recommendation or behavioral inference.</NeonText>
          </Surface>

          <Section title="PROACTIVE PATTERN SUGGESTIONS" subtitle="The graph proposes valid structural questions from the relationships that actually exist">
            {suggestions.length === 0 ? <NeonText variant="bodyMuted">No built-in suggestion is supported by the current graph schema.</NeonText> : null}
            {suggestions.map((suggestion) => (
              <Pressable key={suggestion.id} onPress={() => setDefinition(suggestion.definition)}>
                <Surface elevated padded style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{suggestion.title}</NeonText>
                      <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{suggestion.description}</NeonText>
                    </View>
                    <Pill label="RUN" tone="accent" />
                  </View>
                </Surface>
              </Pressable>
            ))}
          </Section>

          <Section title="CUSTOM TWO-HOP BUILDER" subtitle="A guided subset of the bounded grammar; blank node kind or relation means wildcard">
            <View style={styles.builderRow}>
              <Field label="START KIND" value={startKind} onChange={setStartKind} />
              <Field label="RELATION 1" value={relationA} onChange={setRelationA} />
              <Field label="MIDDLE KIND" value={middleKind} onChange={setMiddleKind} />
              <Field label="RELATION 2" value={relationB} onChange={setRelationB} />
              <Field label="END KIND" value={endKind} onChange={setEndKind} />
            </View>
            <NeonText variant="label" tone="muted">CONFIDENCE FLOOR</NeonText>
            <View style={styles.optionRow}>{FLOORS.map((floor) => <Pressable key={floor} onPress={() => setConfidenceFloor(floor)} style={[styles.optionChip, confidenceFloor === floor && styles.optionChipActive]}><NeonText variant="label" tone={confidenceFloor === floor ? 'accent' : 'muted'}>{floor}</NeonText></Pressable>)}</View>
            <NeonText variant="label" tone="muted">MINIMUM EVIDENCE PER EDGE</NeonText>
            <View style={styles.optionRow}>{[1, 2, 3, 5].map((count) => <Pressable key={count} onPress={() => setMinEvidenceCount(count)} style={[styles.optionChip, minEvidenceCount === count && styles.optionChipActive]}><NeonText variant="label" tone={minEvidenceCount === count ? 'accent' : 'muted'}>N≥{count}</NeonText></Pressable>)}</View>
            <GlowButton label="Run structural pattern" onPress={runCustom} />
          </Section>

          {result ? (
            <Section title="PATTERN RESULTS" subtitle={`${result.matchCount} bounded structural match${result.matchCount === 1 ? '' : 'es'} · ${result.definition.title}`}>
              <Surface padded style={styles.contractCard}><NeonText variant="bodyMuted">{result.operatingRule}</NeonText></Surface>
              {result.matches.slice(0, 40).map((match, index) => (
                <Surface key={match.id} elevated padded style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Pill label={`MATCH ${index + 1} · ${match.confidenceFloor}`} tone={match.confidenceFloor === 'VERIFIED' ? 'accent' : 'neutral'} />
                    <NeonText variant="mono" tone="accent">S{match.score.toFixed(2)}</NeonText>
                  </View>
                  <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{match.nodeIds.map((id) => nodeLabel(payload, id)).join(' → ')}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{Math.round(match.verifiedEdgeRatio * 100)}% verified edges · evidence ×{match.evidenceCount}</NeonText>
                </Surface>
              ))}
              {result.matchCount === 0 ? <NeonText variant="bodyMuted">No evidence chain matches this bounded pattern.</NeonText> : null}
            </Section>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return <View style={styles.field}><NeonText variant="label" tone="muted">{label}</NeonText><TextInput value={value} onChangeText={onChange} placeholder="wildcard" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" /></View>;
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 40 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, section: { gap: spacing.sm }, card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, builderRow: { gap: spacing.sm }, field: { gap: 4 }, input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, optionChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairline }, optionChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
});
