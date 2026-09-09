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
import { analyzeInternalGraph, type InternalGraphPayload } from '../admin/InternalGraphEngine';
import { runAdaptiveInternalGraphAgentOrchestrator } from '../admin/InternalAdaptiveAgentOrchestrator';
import {
  analyzeInternalRouteTemporalCoherence,
  buildInternalAgenticTimeline,
} from '../admin/InternalAgenticTimelineEngine';
import { triageInternalWatchtower } from '../admin/InternalWatchtowerTriageEngine';
import { evaluateInternalOperatorDecisionAdmission } from '../admin/InternalOperatorDecisionAdmission';
import { analyzeInternalEvidenceDebt } from '../admin/InternalEvidenceDebtEngine';
import {
  buildInternalNextBestAnalysisPlan,
  type InternalAnalysisCapability,
} from '../admin/InternalNextBestAnalysisEngine';
import { buildInternalAnalystAttentionBudget } from '../admin/InternalAnalystAttentionGovernor';
import { loadInternalDecisionCalibrationReport } from '../admin/internalDecisionCalibration.service';
import type { InternalDecisionCalibrationReport } from '../admin/InternalDecisionCalibrationEngine';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { loadInternalGraphWatchtower, type InternalGraphWatchtowerState } from '../admin/internalGraphWatchtower.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type AdaptiveCommandRoute = {
  InternalAdaptiveCommand: { eventId?: string } | undefined;
};

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function admissionLabel(state: string): string {
  return state.replaceAll('_', ' ').toUpperCase();
}

export default function InternalAdaptiveCommandScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<AdaptiveCommandRoute, 'InternalAdaptiveCommand'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [watchtower, setWatchtower] = useState<InternalGraphWatchtowerState | null>(null);
  const [decisionCalibration, setDecisionCalibration] = useState<InternalDecisionCalibrationReport | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [graph, calibration, safeSuppressions, watchState, methodCalibration] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1600 }),
        loadInternalBridgePatternCalibration(),
        getInternalBridgeSuppressions(),
        loadInternalGraphWatchtower(),
        loadInternalDecisionCalibrationReport(eventId),
      ]);
      setPayload(graph);
      setPatterns(calibration.patterns);
      setSuppressions(safeSuppressions);
      setWatchtower(watchState);
      setDecisionCalibration(methodCalibration);
      const analysis = analyzeInternalGraph(graph);
      setSourceNodeId((current) => current && graph.nodes.some((node) => node.id === current)
        ? current
        : analysis.brokerNodeIds[0] ?? analysis.hubNodeIds[0] ?? graph.nodes.find((node) => node.kind === 'person')?.id ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      setDecisionCalibration(null);
      Alert.alert('Adaptive Command unavailable', error instanceof Error ? error.message : 'Unable to assemble operator intelligence.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    const timer = setInterval(() => void load(), 45_000);
    return () => clearInterval(timer);
  }, [operator, load]);

  const adaptiveRun = useMemo(
    () => payload && suppressions
      ? runAdaptiveInternalGraphAgentOrchestrator({
          current: payload,
          patterns,
          suppressions,
          targetQuery: targetQuery.trim() || null,
          sourceNodeId,
        })
      : null,
    [payload, patterns, suppressions, targetQuery, sourceNodeId],
  );

  const timeline = useMemo(
    () => payload ? buildInternalAgenticTimeline(payload) : null,
    [payload],
  );

  const activeRules = useMemo(
    () => watchtower?.rules.filter((rule) => rule.enabled) ?? [],
    [watchtower],
  );

  const watchtowerTriage = useMemo(
    () => watchtower && adaptiveRun
      ? triageInternalWatchtower({ state: watchtower, epistemicHealth: adaptiveRun.epistemicHealth })
      : null,
    [watchtower, adaptiveRun],
  );

  const openIncidents = useMemo(
    () => watchtowerTriage?.incidents.filter((incident) => incident.openEventCount > 0) ?? [],
    [watchtowerTriage],
  );

  const decisionAdmission = useMemo(
    () => adaptiveRun && suppressions && decisionCalibration
      ? evaluateInternalOperatorDecisionAdmission({
          adaptiveRun,
          watchtowerTriage,
          decisionCalibration,
          suppressionsEstablished: true,
          capabilities: {
            manage: operator.manage,
            restricted: operator.restricted,
            export: operator.export,
          },
        })
      : null,
    [adaptiveRun, watchtowerTriage, decisionCalibration, suppressions, operator.manage, operator.restricted, operator.export],
  );

  const evidenceDebt = useMemo(
    () => payload && adaptiveRun
      ? analyzeInternalEvidenceDebt({ payload, routingPortfolio: adaptiveRun.routingPortfolio })
      : null,
    [payload, adaptiveRun],
  );

  const analysisCapabilities = useMemo(() => {
    const result = new Set<InternalAnalysisCapability>();
    if (operator.read) result.add('graph_read');
    if (operator.manage) result.add('graph_manage');
    if (operator.restricted) result.add('graph_restricted');
    if (operator.export) result.add('graph_export');
    return result;
  }, [operator.read, operator.manage, operator.restricted, operator.export]);

  const nextAnalysis = useMemo(
    () => adaptiveRun && evidenceDebt
      ? buildInternalNextBestAnalysisPlan({
          epistemicHealth: adaptiveRun.epistemicHealth,
          evidenceDebt,
          watchtowerTriage,
          routingPortfolio: adaptiveRun.routingPortfolio,
          capabilities: analysisCapabilities,
        })
      : null,
    [adaptiveRun, evidenceDebt, watchtowerTriage, analysisCapabilities],
  );

  const attentionBudget = useMemo(
    () => adaptiveRun && evidenceDebt && nextAnalysis
      ? buildInternalAnalystAttentionBudget({
          nextAnalysis,
          watchtowerTriage,
          evidenceDebt,
          missions: adaptiveRun.missions,
        })
      : null,
    [adaptiveRun, evidenceDebt, nextAnalysis, watchtowerTriage],
  );

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>CALIBRATING ADAPTIVE COMMAND</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_manage')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface padded style={styles.lockedCard}>
          <Pill label="ADAPTIVE COMMAND · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>This surface composes Watchtower, calibrated routing and private strategy state and therefore requires exact server-side graph_manage.</NeonText>
        </Surface>
      </View>
    );
  }

  if (!payload || !suppressions || !adaptiveRun || !decisionAdmission || !decisionCalibration || !timeline || !evidenceDebt || !nextAnalysis || !attentionBudget) return null;
  const health = adaptiveRun.epistemicHealth;
  const routing = adaptiveRun.routingPortfolio;
  const bestTemporal = routing?.routes[0] ? analyzeInternalRouteTemporalCoherence(routing.routes[0]) : null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.13} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · ADAPTIVE NETWORK COMMAND" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Operator Command</NeonText>
              <NeonText variant="bodyMuted">Attention budget · next-best analysis · Watchtower triage · evidence debt · calibrated admission · temporal coherence · diversified routing · adaptive missions</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metricRow}>
            <Metric label="GRAPH HEALTH" value={`${Math.round(health.score * 100)}%`} />
            <Metric label="EVIDENCE DEBT" value={`${evidenceDebt.highPriorityCount} HIGH`} />
            <Metric label="METHOD VERDICTS" value={`${decisionCalibration.resolvedCount}`} />
            <Metric label="CHRONOLOGY GAPS" value={`${timeline.chronologyGapCount}`} />
            <Metric label="FOCUS THREADS" value={`${(attentionBudget.primary ? 1 : 0) + attentionBudget.supporting.length}`} />
          </View>

          <Section title="ATTENTION BUDGET · NEXT BEST ANALYSIS" subtitle="One primary analytical thread, at most two supporting threads; critical evidence/safety conditions may preempt">
            {attentionBudget.primary ? (
              <Surface elevated padded style={[styles.nextActionCard, styles.topActionBorder]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={`FOCUS NOW · ${attentionBudget.primary.source.replaceAll('_', ' ').toUpperCase()}`} tone="accent" dot />
                    <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{attentionBudget.primary.title}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">P{attentionBudget.primary.priority.toFixed(1)}</NeonText>
                </View>
                {attentionBudget.primary.rationale.slice(0, 5).map((reason, index) => <NeonText key={`primary-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                {attentionBudget.primary.destination ? <GlowButton label="Run primary analysis" variant="ghost" onPress={() => navigation.navigate(attentionBudget.primary!.destination!, { eventId: eventId ?? undefined })} /> : null}
              </Surface>
            ) : null}
            {attentionBudget.supporting.map((thread, index) => (
              <Surface key={thread.id} padded style={styles.supportCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}><Pill label={`SUPPORT ${index + 1}`} tone="neutral" /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{thread.title}</NeonText></View>
                  <NeonText variant="mono" tone="muted">P{thread.priority.toFixed(1)}</NeonText>
                </View>
                {thread.rationale.slice(0, 3).map((reason, reasonIndex) => <NeonText key={`${thread.id}-${reasonIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                {thread.destination ? <GlowButton label="Open supporting analysis" variant="ghost" onPress={() => navigation.navigate(thread.destination!, { eventId: eventId ?? undefined })} /> : null}
              </Surface>
            ))}
            {attentionBudget.later.length > 0 ? (
              <Surface padded style={styles.laterCard}>
                <Pill label={`LATER QUEUE · ${attentionBudget.later.length}${attentionBudget.suppressedCount > 0 ? ` + ${attentionBudget.suppressedCount} SUPPRESSED` : ''}`} tone="neutral" />
                {attentionBudget.later.slice(0, 5).map((thread) => <NeonText key={thread.id} variant="bodyMuted" style={{ marginTop: 3 }}>• {thread.title}</NeonText>)}
              </Surface>
            ) : null}
            <NeonText variant="bodyMuted">{attentionBudget.operatingRule}</NeonText>
          </Section>

          <Surface elevated padded style={[styles.healthCard, health.band === 'degraded' || health.band === 'fragile' ? styles.warningBorder : null]}>
            <Pill label={`EPISTEMIC HEALTH · ${health.band.toUpperCase()}`} tone={health.band === 'strong' || health.band === 'usable' ? 'accent' : 'neutral'} dot />
            <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{Math.round(health.score * 100)}% evidence authority</NeonText>
            {health.warnings.slice(0, 5).map((warning) => <NeonText key={warning} variant="bodyMuted" style={{ marginTop: 3 }}>• {warning}</NeonText>)}
          </Surface>

          <Surface padded style={styles.boundaryCard}>
            <Pill label="CALIBRATION + TEMPORAL AUTHORITY" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Resolved falsifiable hypotheses may only reduce future authority when they demonstrate repeated overconfidence. Historical underconfidence never boosts authority automatically.</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Agentic Timeline describes retained observation order only. {bestTemporal ? `Best route temporal coherence is ${Math.round(bestTemporal.overlapScore * 100)}%${bestTemporal.hasSharedObservationWindow ? ' with a shared observation window.' : ` with no shared observation window; nearest gap ~${Math.round(bestTemporal.nearestGapDays)} days.`}` : 'No target route is currently selected.'}</NeonText>
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label="Evidence Debt" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceDebt', { eventId: eventId ?? undefined })} />
            <GlowButton label="Timeline" variant="ghost" onPress={() => navigation.navigate('InternalAgenticTimeline', { eventId: eventId ?? undefined })} />
            <GlowButton label="Decision Calibration" variant="ghost" onPress={() => navigation.navigate('InternalDecisionCalibration', { eventId: eventId ?? undefined })} />
            <GlowButton label="Watchtower" variant="ghost" onPress={() => navigation.navigate('InternalWatchtower', { eventId: eventId ?? undefined })} />
            <GlowButton label="Target Routing" variant="ghost" onPress={() => navigation.navigate('InternalTargetRouting', { eventId: eventId ?? undefined })} />
            <GlowButton label="Private Access" variant="ghost" onPress={() => navigation.navigate('InternalPrivateAccess')} />
          </View>

          <Section title="WATCHTOWER INCIDENT TRIAGE" subtitle={`${activeRules.length} active structural watches; incidents are replayable review-urgency groupings, never person/org risk scores or automatic actions`}>
            {openIncidents.slice(0, 8).map((incident) => (
              <Surface key={incident.id} elevated padded style={[styles.incidentCard, incident.severity === 'critical' || incident.severity === 'high' ? styles.warningBorder : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}><Pill label={`${incident.severity.toUpperCase()} · ${incident.family.replaceAll('_', ' ').toUpperCase()}`} tone={incident.severity === 'critical' || incident.severity === 'high' ? 'accent' : 'neutral'} dot /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{incident.title}</NeonText></View>
                  <NeonText variant="mono" tone="accent">S{incident.score.toFixed(1)}</NeonText>
                </View>
                {incident.reasons.slice(0, 4).map((reason, index) => <NeonText key={`${incident.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <GlowButton label="Open evidence" variant="ghost" onPress={() => navigation.navigate(incident.recommendedReviewSurface, { eventId: incident.eventId ?? eventId ?? undefined })} />
              </Surface>
            ))}
            {openIncidents.length === 0 ? <NeonText variant="bodyMuted">No open correlated Watchtower incidents.</NeonText> : null}
          </Section>

          <Section title="DECISION ADMISSION" subtitle="Current evidence sets the ceiling; historical calibration and temporal coherence may only reduce authority. Admission never authorizes action.">
            {decisionAdmission.admissions.map((admission) => (
              <Surface key={admission.kind} padded style={[styles.admissionCard, admission.state === 'safety_blocked' || admission.state === 'evidence_remediation_required' ? styles.warningBorder : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}><Pill label={admissionLabel(admission.state)} tone={admission.state === 'admitted_to_review' ? 'accent' : 'neutral'} dot={admission.state === 'admitted_to_review'} /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{admission.title}</NeonText></View>
                  <NeonText variant="mono" tone="accent">A{Math.round(admission.authority * 100)}</NeonText>
                </View>
                {admission.reasons.slice(0, 6).map((reason, index) => <NeonText key={`${admission.kind}-reason-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                {admission.requiredRemediation.slice(0, 4).map((item, index) => <NeonText key={`${admission.kind}-remediation-${index}`} variant="body" style={{ marginTop: 3 }}>→ {item}</NeonText>)}
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{admission.operatingRule}</NeonText>
              </Surface>
            ))}
          </Section>

          <Section title="TARGET ROUTING OBJECTIVE" subtitle="Routing changes mission evidence only; it never authorizes outreach, predicts consent or bypasses blocks">
            <TextInput value={targetQuery} onChangeText={setTargetQuery} placeholder="Target ecosystem: defense, climate, investor, university…" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
            {sourceNodeId ? <NeonText variant="bodyMuted">Source: {nodeLabel(payload, sourceNodeId)}</NeonText> : null}
            {routing ? <View style={styles.metricRow}><Metric label="ROUTES" value={`${routing.routes.length}`} /><Metric label="DIVERSITY" value={`${Math.round(routing.routeDiversity * 100)}%`} /><Metric label="SHARED BOTTLENECKS" value={`${routing.structuralSinglePointNodeIds.length}`} /></View> : null}
            {routing?.routes.slice(0, 3).map((routeResult) => {
              const coherence = analyzeInternalRouteTemporalCoherence(routeResult);
              return (
                <Surface key={routeResult.id} padded style={styles.smallCard}>
                  <View style={styles.rowBetween}><NeonText variant="h2" style={{ flex: 1 }}>{routeResult.targetLabel}</NeonText><Pill label={routeResult.confidenceFloor} tone={routeResult.confidenceFloor === 'VERIFIED' ? 'accent' : 'neutral'} /></View>
                  <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{routeResult.nodeIds.map((id) => nodeLabel(payload, id)).join(' → ')}</NeonText>
                  <NeonText variant="label" tone="muted" style={{ marginTop: 4 }}>{Math.round(routeResult.verifiedEdgeRatio * 100)}% VERIFIED · {routeResult.hopCount} HOPS · TEMPORAL {Math.round(coherence.overlapScore * 100)}%</NeonText>
                </Surface>
              );
            })}
          </Section>

          <Section title="ADAPTIVE MISSION QUEUE" subtitle="Mission priority is graph-health calibrated; Sentinel is never down-weighted">
            {adaptiveRun.missions.map((mission) => (
              <Surface key={mission.id} elevated padded style={styles.missionCard}>
                <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={mission.agent.toUpperCase()} tone="accent" dot /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{mission.title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{mission.thesis}</NeonText></View><NeonText variant="mono" tone="accent">P{mission.priority.toFixed(1)}</NeonText></View>
                {mission.evidence.slice(0, 6).map((evidence, index) => <NeonText key={`${mission.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {evidence}</NeonText>)}
                <NeonText variant="body" style={{ marginTop: spacing.sm }}>{mission.recommendedAction}</NeonText>
                <Pill label="HUMAN APPROVAL REQUIRED" tone="neutral" />
              </Surface>
            ))}
          </Section>
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
  lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 132, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  healthCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  warningBorder: { borderColor: '#F59E0B' },
  topActionBorder: { borderColor: palette.accent },
  boundaryCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  nextActionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  supportCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  laterCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  incidentCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  admissionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  missionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
});