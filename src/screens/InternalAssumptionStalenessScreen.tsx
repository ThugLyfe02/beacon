import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { analyzeInternalGraph, type InternalGraphPayload } from '../admin/InternalGraphEngine';
import { runAdaptiveInternalGraphAgentOrchestrator } from '../admin/InternalAdaptiveAgentOrchestrator';
import { buildInternalAgenticTimeline } from '../admin/InternalAgenticTimelineEngine';
import { analyzeInternalAssumptionStaleness } from '../admin/InternalAssumptionStalenessEngine';
import { analyzeInternalDecisionConflictDependencies } from '../admin/InternalDecisionDependencyEngine';
import { triageInternalWatchtower } from '../admin/InternalWatchtowerTriageEngine';
import {
  loadInternalDecisionRetrospectives,
  type InternalDecisionRetrospectiveRow,
} from '../admin/internalDecisionJournal.service';
import {
  loadInternalDecisionEvidenceRefs,
  type InternalDecisionEvidenceRef,
} from '../admin/internalDecisionEvidenceRefs.service';
import {
  loadInternalEvidenceConflicts,
  type InternalEvidenceConflict,
} from '../admin/internalEvidenceConflict.service';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { loadInternalGraphWatchtower, type InternalGraphWatchtowerState } from '../admin/internalGraphWatchtower.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type AssumptionRoute = {
  InternalAssumptionStaleness: { eventId?: string } | undefined;
};

export default function InternalAssumptionStalenessScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<AssumptionRoute, 'InternalAssumptionStaleness'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [watchtower, setWatchtower] = useState<InternalGraphWatchtowerState | null>(null);
  const [retrospectives, setRetrospectives] = useState<InternalDecisionRetrospectiveRow[]>([]);
  const [decisionRefs, setDecisionRefs] = useState<InternalDecisionEvidenceRef[]>([]);
  const [evidenceConflicts, setEvidenceConflicts] = useState<InternalEvidenceConflict[]>([]);
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [graph, calibration, blockedPairs, watchState, decisionHistory, refs, conflicts] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1800 }),
        loadInternalBridgePatternCalibration(),
        getInternalBridgeSuppressions(),
        loadInternalGraphWatchtower(),
        loadInternalDecisionRetrospectives(eventId),
        loadInternalDecisionEvidenceRefs({ eventId, openOnly: true, limit: 1600 }),
        loadInternalEvidenceConflicts({ eventId, includeClosed: false, limit: 240 }),
      ]);
      setPayload(graph);
      setPatterns(calibration.patterns);
      setSuppressions(blockedPairs);
      setWatchtower(watchState);
      setRetrospectives(decisionHistory);
      setDecisionRefs(refs);
      setEvidenceConflicts(conflicts.conflicts);
      const analysis = analyzeInternalGraph(graph);
      setSourceNodeId(analysis.brokerNodeIds[0] ?? analysis.hubNodeIds[0] ?? graph.nodes.find((node) => node.kind === 'person')?.id ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      setDecisionRefs([]);
      setEvidenceConflicts([]);
      Alert.alert('Assumption Staleness unavailable', error instanceof Error ? error.message : 'Unable to reconstruct assumption state.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const adaptiveRun = useMemo(
    () => payload && suppressions
      ? runAdaptiveInternalGraphAgentOrchestrator({ current: payload, patterns, suppressions, sourceNodeId })
      : null,
    [payload, suppressions, patterns, sourceNodeId],
  );
  const timeline = useMemo(() => payload ? buildInternalAgenticTimeline(payload) : null, [payload]);
  const triage = useMemo(
    () => watchtower && adaptiveRun
      ? triageInternalWatchtower({ state: watchtower, epistemicHealth: adaptiveRun.epistemicHealth })
      : null,
    [watchtower, adaptiveRun],
  );
  const decisionDependencies = useMemo(
    () => analyzeInternalDecisionConflictDependencies({ refs: decisionRefs, conflicts: evidenceConflicts }),
    [decisionRefs, evidenceConflicts],
  );
  const report = useMemo(
    () => payload && adaptiveRun && timeline
      ? analyzeInternalAssumptionStaleness({
          currentGraphVersion: payload.graphVersion,
          retrospectives,
          epistemicHealth: adaptiveRun.epistemicHealth,
          timeline,
          routingPortfolio: adaptiveRun.routingPortfolio,
          watchtowerTriage: triage,
          decisionDependencies,
        })
      : null,
    [payload, adaptiveRun, timeline, retrospectives, triage, decisionDependencies],
  );

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>REVALIDATING OPEN ASSUMPTIONS</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage') || !payload || !suppressions || !report) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="ASSUMPTION STALENESS · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · ASSUMPTION REVALIDATION" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Assumption Staleness</NeonText>
              <NeonText variant="bodyMuted">Detects when the evidence environment materially changed after a hypothesis was sealed. Conflict-driven revalidation requires an exact recorded edge dependency. Stale means revalidate—not false.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metricRow}>
            <Metric label="CURRENT" value={`${report.currentCount}`} />
            <Metric label="REVIEW DUE" value={`${report.reviewDueCount}`} />
            <Metric label="STALE" value={`${report.staleCount}`} />
            <Metric label="CONFLICT-IMPACTED" value={`${decisionDependencies.impactedJournalIds.length}`} />
            <Metric label="GRAPH" value={payload.graphVersion.slice(0, 12)} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="REVALIDATION CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{report.operatingRule}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{decisionDependencies.operatingRule}</NeonText>
          </Surface>

          {report.assumptions.map((item) => (
            <Surface key={item.journalId} elevated padded style={[styles.card, item.freshness === 'stale' ? styles.warningBorder : null]}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Pill label={`${item.freshness.replaceAll('_', ' ').toUpperCase()} · ${item.decisionKind.replaceAll('_', ' ').toUpperCase()}`} tone={item.freshness === 'current' ? 'neutral' : 'accent'} dot={item.freshness !== 'current'} />
                  <NeonText variant="h2" style={{ marginTop: spacing.sm }}>Hypothesis {item.journalId.slice(0, 8)}…</NeonText>
                </View>
                <NeonText variant="mono" tone="accent">S{Math.round(item.score * 100)}</NeonText>
              </View>
              {item.reasons.map((reason, index) => <NeonText key={`${item.journalId}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
              <GlowButton label="Open required review" variant="ghost" onPress={() => navigation.navigate(item.recommendedSurface, { eventId: eventId ?? undefined })} />
            </Surface>
          ))}
          {report.assumptions.length === 0 ? <NeonText variant="bodyMuted">No open hypotheses with retained decision-time context exist in this scope.</NeonText> : null}
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
  lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 118, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  warningBorder: { borderColor: '#F59E0B' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
});
