import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useInternalOperator } from '../admin/useInternalOperator';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import { buildInternalTargetRoutingPortfolio } from '../admin/InternalTargetRoutingEngine';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type RouteParams = {
  InternalTargetRouting: { eventId?: string; nodeId?: string; targetQuery?: string } | undefined;
};

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.finalizedAt ?? event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function label(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function kind(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.kind ?? 'unknown';
}

export default function InternalTargetRoutingScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<RouteParams, 'InternalTargetRouting'>>();
  const operator = useInternalOperator();
  const requestedEventId = route.params?.eventId ?? null;
  const requestedNodeId = route.params?.nodeId ?? null;

  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [eventId, setEventId] = useState<string | null>(requestedEventId);
  const [graph, setGraph] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(requestedNodeId);
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState(route.params?.targetQuery ?? '');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [sequence, calibration, blockedPairs] = await Promise.all([
        loadInternalGraphEventSequence(48),
        loadInternalBridgePatternCalibration(),
        getInternalBridgeSuppressions(),
      ]);
      const ordered = [...sequence.events].sort((a, b) => eventTime(b) - eventTime(a));
      const selectedEventId = eventId ?? requestedEventId ?? ordered[0]?.eventId ?? null;
      const nextGraph = await loadInternalIntelligenceGraph({ eventId: selectedEventId, includeRestricted: false, limit: 2000 });
      setEvents(ordered);
      setEventId(selectedEventId);
      setPatterns(calibration.patterns);
      setSuppressions(blockedPairs);
      setGraph(nextGraph);
      setSourceNodeId((current) => {
        if (current && nextGraph.nodes.some((node) => node.id === current)) return current;
        if (requestedNodeId && nextGraph.nodes.some((node) => node.id === requestedNodeId)) return requestedNodeId;
        return nextGraph.nodes.find((node) => node.kind === 'person')?.id ?? nextGraph.nodes[0]?.id ?? null;
      });
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Target routing unavailable', error instanceof Error ? error.message : 'Unable to load safe routing evidence.');
    } finally {
      setLoading(false);
    }
  }, [operator, eventId, requestedEventId, requestedNodeId]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const sourceCandidates = useMemo(() => {
    if (!graph) return [];
    const query = sourceQuery.trim().toLowerCase();
    return graph.nodes
      .filter((node) => node.kind === 'person')
      .filter((node) => !query || node.label.toLowerCase().includes(query))
      .slice(0, 24);
  }, [graph, sourceQuery]);

  const portfolio = useMemo(() => {
    if (!graph || !sourceNodeId || !suppressions || !targetQuery.trim()) return null;
    return buildInternalTargetRoutingPortfolio({
      payload: graph,
      sourceNodeId,
      targetQuery,
      patterns,
      suppressions,
      maxHops: 6,
      maxRoutes: 8,
    });
  }, [graph, sourceNodeId, targetQuery, patterns, suppressions]);

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>MAPPING EXPLAINABLE ROUTES</NeonText></View>;
  }

  if (!operator.allowed || !operator.has('graph_manage') || !graph || !suppressions) {
    return <View style={styles.centered}><GridBackground /><Surface elevated padded style={styles.lockedCard}><Pill label="TARGET ROUTING · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText><NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Routing fails closed when authoritative bridge suppressions cannot be established.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.1} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · EXPLAINABLE ECOSYSTEM ROUTING" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Target Routing</NeonText>
              <NeonText variant="bodyMuted">Diverse paths · provenance quality · bottleneck exposure · safety suppression · observational priors</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="ROUTING CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>A route means the authorized graph contains an explainable structural path. It does not estimate compatibility, consent, influence, or whether an introduction should occur. Person-person hops are removed when the authoritative block-suppression set forbids them; any social action remains human-approved.</NeonText>
          </Surface>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {events.slice(0, 16).map((event) => <Pressable key={event.eventId} onPress={() => setEventId(event.eventId)} style={[styles.chip, eventId === event.eventId && styles.chipActive]}><NeonText variant="label" tone={eventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText></Pressable>)}
          </ScrollView>

          <Section title="SOURCE" subtitle="Routing starts from one currently authorized person node; this selection is session-local and is not persisted by Target Routing.">
            <TextInput value={sourceQuery} onChangeText={setSourceQuery} placeholder="Search source person…" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
            <View style={styles.sourceGrid}>{sourceCandidates.map((node) => <Pressable key={node.id} onPress={() => { setSourceNodeId(node.id); setSourceQuery(''); }} style={[styles.sourceChip, sourceNodeId === node.id && styles.sourceChipActive]}><NeonText variant="body">{node.label}</NeonText><NeonText variant="label" tone="muted">PERSON</NeonText></Pressable>)}</View>
          </Section>

          <Section title="TARGET ECOSYSTEM" subtitle="Searches existing graph labels/kinds only—no external enrichment or target-query persistence.">
            <TextInput value={targetQuery} onChangeText={setTargetQuery} placeholder="e.g. defense, fintech, university, climate…" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
            {sourceNodeId ? <NeonText variant="bodyMuted">Source: {label(graph, sourceNodeId)} · canonical graph {graph.graphVersion.slice(0, 26)}…</NeonText> : null}
          </Section>

          {portfolio ? <>
            <View style={styles.metrics}>
              <Metric label="MATCHED TARGETS" value={`${portfolio.matchedTargetCount}`} />
              <Metric label="CANDIDATE PATHS" value={`${portfolio.candidatePathCount}`} />
              <Metric label="ROUTES" value={`${portfolio.routes.length}`} />
              <Metric label="DIVERSITY" value={`${Math.round(portfolio.routeDiversity * 100)}%`} />
            </View>

            {portfolio.structuralSinglePointNodeIds.length > 0 ? <Surface elevated padded style={styles.warningCard}><Pill label="SHARED SINGLE-POINT DEPENDENCE" tone="accent" dot /><NeonText variant="bodyMuted" style={styles.bodyGap}>Every selected route currently depends on: {portfolio.structuralSinglePointNodeIds.map((id) => label(graph, id)).join(', ')}. Treat this as structural fragility, not importance or human value.</NeonText><GlowButton label="Open Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab', { eventId: eventId ?? undefined })} /></Surface> : null}

            <Section title="ROUTE PORTFOLIO" subtitle="Routes are diversity-aware: a slightly lower raw score can outrank a near-duplicate path when it provides independent structural reachability.">
              {portfolio.routes.map((route, index) => <Surface key={route.id} elevated padded style={styles.routeCard}>
                <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={`ROUTE ${index + 1} · ${route.confidenceFloor}`} tone={route.confidenceFloor === 'VERIFIED' ? 'accent' : 'neutral'} dot={route.confidenceFloor === 'VERIFIED'} /><NeonText variant="h1" style={{ marginTop: 5 }}>{route.targetLabel}</NeonText><NeonText variant="bodyMuted">{route.targetKind} · {route.hopCount} hops · score {route.score.toFixed(2)}</NeonText></View><Pill label={`${Math.round(route.verifiedEdgeRatio * 100)}% VERIFIED`} tone="neutral" /></View>

                <View style={styles.routeMetrics}><Mini label="EVIDENCE" value={`${Math.round(route.evidenceQuality * 100)}%`} /><Mini label="FRESHNESS" value={`${Math.round(route.freshness * 100)}%`} /><Mini label="CROSSINGS" value={`${route.communityCrossings}`} /><Mini label="REDUNDANCY" value={`${Math.round(route.redundancy * 100)}%`} /></View>

                <View style={styles.pathLine}>{route.nodeIds.map((nodeId, nodeIndex) => <React.Fragment key={`${route.id}-${nodeId}-${nodeIndex}`}><View style={styles.pathNode}><NeonText variant="body">{label(graph, nodeId)}</NeonText><NeonText variant="label" tone="muted">{kind(graph, nodeId).toUpperCase()}</NeonText></View>{nodeIndex < route.nodeIds.length - 1 ? <NeonText variant="label" tone="accent">→</NeonText> : null}</React.Fragment>)}</View>

                {route.edges.map((edge, edgeIndex) => <View key={edge.edgeId} style={styles.edgeRow}><NeonText variant="label" tone="accent">{edgeIndex + 1}. {edge.relation.replaceAll('_', ' ')}</NeonText><NeonText variant="bodyMuted">{label(graph, edge.fromNodeId)} → {label(graph, edge.toNodeId)} · {edge.confidence} · evidence n={edge.evidenceCount} · quality {Math.round(edge.evidenceScore * 100)}%{!edge.traversedForward ? ' · reverse structural traversal' : ''}</NeonText></View>)}

                {route.rationale.map((item, itemIndex) => <NeonText key={`${route.id}-r-${itemIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {item}</NeonText>)}
                {route.warnings.map((item, itemIndex) => <NeonText key={`${route.id}-w-${itemIndex}`} variant="bodyMuted" style={styles.warningText}>⚠ {item}</NeonText>)}

                <View style={styles.actions}><GlowButton label="Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab', { eventId: eventId ?? undefined, nodeId: route.nodeIds[1] })} /><GlowButton label="Transform source" variant="ghost" onPress={() => navigation.navigate('InternalTransformLab', { eventId: eventId ?? undefined, nodeId: sourceNodeId ?? undefined })} /></View>
              </Surface>)}
              {portfolio.routes.length === 0 ? <NeonText variant="bodyMuted">No block-safe route into the requested ecosystem exists within the bounded six-hop search.</NeonText> : null}
            </Section>
          </> : <Surface padded style={styles.emptyCard}><Pill label="ROUTING IDLE" tone="neutral" dot /><NeonText variant="bodyMuted" style={styles.bodyGap}>Choose a source and enter a target ecosystem to compute a diverse route portfolio.</NeonText></Surface>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <View style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>; }
function Mini({ label, value }: Readonly<{ label: string; value: string }>) { return <View style={styles.mini}><NeonText variant="body">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>; }
function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) { return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 42 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, bodyGap: { marginTop: spacing.sm, lineHeight: 19 }, chips: { gap: spacing.sm }, chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.space }, chipActive: { borderColor: palette.accent }, section: { gap: spacing.sm }, input: { minHeight: 46, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.lg, paddingHorizontal: spacing.md, color: palette.text, backgroundColor: palette.space }, sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, sourceChip: { minWidth: 132, maxWidth: 220, padding: spacing.sm, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.lg, backgroundColor: palette.space }, sourceChipActive: { borderColor: palette.accent }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { minWidth: 118, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.lg, backgroundColor: palette.space }, warningCard: { borderRadius: radii.xl, borderColor: palette.accent }, routeCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }, routeMetrics: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, mini: { minWidth: 88, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.space }, pathLine: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs }, pathNode: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong }, edgeRow: { marginTop: spacing.sm, gap: 2 }, warningText: { marginTop: 4, color: '#FBBF24' }, actions: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, emptyCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
