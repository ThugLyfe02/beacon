import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useInternalOperator } from '../admin/useInternalOperator';
import { loadInternalGraphEventSequence, loadInternalIntelligenceGraph, type InternalGraphEventSummary } from '../admin/internalGraph.service';
import { analyzeInternalGraphEpistemicHealth } from '../admin/InternalGraphEpistemicHealthEngine';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.finalizedAt ?? event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InternalGraphHealthScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [graph, setGraph] = useState<InternalGraphPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const sequence = await loadInternalGraphEventSequence(48);
      const ordered = [...sequence.events].sort((a, b) => eventTime(b) - eventTime(a));
      const selectedId = eventId ?? ordered[0]?.eventId ?? null;
      const nextGraph = await loadInternalIntelligenceGraph({ eventId: selectedId, includeRestricted: false, limit: 2000 });
      setEvents(ordered);
      setEventId(selectedId);
      setGraph(nextGraph);
    } catch (error) {
      Alert.alert('Graph health unavailable', error instanceof Error ? error.message : 'Unable to load epistemic graph state.');
    } finally {
      setLoading(false);
    }
  }, [operator, eventId]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const health = useMemo(() => graph ? analyzeInternalGraphEpistemicHealth(graph) : null, [graph]);

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>CALIBRATING GRAPH EVIDENCE</NeonText></View>;
  }

  if (!operator.allowed || !operator.has('graph_read') || !graph || !health) {
    return <View style={styles.centered}><GridBackground /><Surface elevated padded style={styles.lockedCard}><Pill label="GRAPH HEALTH · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.1} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · EPISTEMIC GRAPH HEALTH" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Evidence Health</NeonText>
              <NeonText variant="bodyMuted">Confidence composition · freshness · repetition · context integrity · canonicalization hygiene</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="EPISTEMIC CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>{health.methodology}</NeonText>
          </Surface>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {events.slice(0, 16).map((event) => <Pressable key={event.eventId} onPress={() => setEventId(event.eventId)} style={[styles.chip, eventId === event.eventId && styles.chipActive]}><NeonText variant="label" tone={eventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText></Pressable>)}
          </ScrollView>

          <Surface elevated padded style={[styles.scoreCard, health.band === 'strong' && styles.strongCard, health.band === 'fragile' && styles.warningCard, health.band === 'degraded' && styles.dangerCard]}>
            <View style={styles.rowBetween}>
              <View><Pill label={health.band.toUpperCase()} tone={health.band === 'strong' || health.band === 'usable' ? 'accent' : 'neutral'} dot /><NeonText variant="display" tone="text" glow style={{ marginTop: spacing.sm }}>{Math.round(health.score * 100)}</NeonText><NeonText variant="label" tone="muted">EPISTEMIC HEALTH / 100</NeonText></View>
              <NeonText variant="bodyMuted" style={styles.scoreExplain}>How strongly the current canonical graph supports topology-level conclusions.</NeonText>
            </View>
          </Surface>

          <View style={styles.metrics}>
            <Metric label="VERIFIED" value={`${Math.round(health.verifiedEdgeRatio * 100)}%`} />
            <Metric label="DERIVED" value={`${Math.round(health.derivedEdgeRatio * 100)}%`} />
            <Metric label="AMBIGUOUS" value={`${Math.round(health.ambiguousEdgeRatio * 100)}%`} />
            <Metric label="REPEATED" value={`${Math.round(health.repeatedEvidenceRatio * 100)}%`} />
            <Metric label="FRESH ≤120D" value={`${Math.round(health.freshEdgeRatio * 100)}%`} />
            <Metric label="STALE >365D" value={`${Math.round(health.staleEdgeRatio * 100)}%`} />
            <Metric label="WEAK CONTEXT" value={`${Math.round(health.weakContextRatio * 100)}%`} />
            <Metric label="ALIASES COLLAPSED" value={`${health.canonicalizedAliasCount}`} />
          </View>

          <Section title="STRENGTHS" subtitle="Evidence properties that increase confidence in structural interpretation.">
            {health.strengths.map((item, index) => <Surface key={`strength-${index}`} padded style={styles.itemCard}><NeonText variant="body">✓ {item}</NeonText></Surface>)}
            {health.strengths.length === 0 ? <NeonText variant="bodyMuted">No strong evidence-quality signal crosses the current reporting thresholds.</NeonText> : null}
          </Section>

          <Section title="WARNINGS" subtitle="Conditions that should lower confidence or trigger data-quality work before strong operator conclusions.">
            {health.warnings.map((item, index) => <Surface key={`warning-${index}`} padded style={styles.warningItem}><NeonText variant="body">⚠ {item}</NeonText></Surface>)}
            {health.warnings.length === 0 ? <NeonText variant="bodyMuted">No epistemic-health warning crosses the current thresholds.</NeonText> : null}
          </Section>

          <Section title="REMEDIATION ROUTES" subtitle="Graph-quality work should improve evidence before increasing analytical complexity.">
            <View style={styles.actions}>
              {operator.has('graph_manage') ? <GlowButton label="Entity Resolution" variant="ghost" onPress={() => navigation.navigate('InternalEntityResolutionLab', { eventId: eventId ?? undefined })} /> : null}
              <GlowButton label="Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab', { eventId: eventId ?? undefined })} />
              <GlowButton label="Epoch lineage" variant="ghost" onPress={() => navigation.navigate('InternalEpochLab')} />
              {operator.has('graph_manage') ? <GlowButton label="Target Routing" variant="ghost" onPress={() => navigation.navigate('InternalTargetRouting', { eventId: eventId ?? undefined })} /> : null}
            </View>
          </Section>

          <Surface padded style={styles.footerCard}>
            <Pill label="CANONICAL GRAPH" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>Version {graph.graphVersion}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{health.canonicalizedAliasCount > 0 ? `${Math.round(health.canonicalCompressionRatio * 100)}% estimated pre-canonical node duplication was collapsed by approved non-person aliases.` : 'No approved non-person alias compression is visible in this payload.'}</NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <View style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>; }
function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) { return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 42 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, bodyGap: { marginTop: spacing.sm, lineHeight: 19 }, chips: { gap: spacing.sm }, chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.space }, chipActive: { borderColor: palette.accent }, scoreCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, strongCard: { borderColor: palette.accent }, warningCard: { borderColor: '#F59E0B' }, dangerCard: { borderColor: '#F43F5E' }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.lg }, scoreExplain: { flex: 1, maxWidth: 260, lineHeight: 19 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { minWidth: 118, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.lg, backgroundColor: palette.space }, section: { gap: spacing.sm }, itemCard: { borderRadius: radii.lg, borderColor: palette.hairlineStrong }, warningItem: { borderRadius: radii.lg, borderColor: '#F59E0B' }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, footerCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
