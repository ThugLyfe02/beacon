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
import { triageInternalWatchtower } from '../admin/InternalWatchtowerTriageEngine';
import { evaluateInternalOperatorDecisionAdmission } from '../admin/InternalOperatorDecisionAdmission';
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
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [graph, calibration, safeSuppressions, watchState] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1600 }),
        loadInternalBridgePatternCalibration(),
        getInternalBridgeSuppressions(),
        loadInternalGraphWatchtower(),
      ]);
      setPayload(graph);
      setPatterns(calibration.patterns);
      setSuppressions(safeSuppressions);
      setWatchtower(watchState);
      const analysis = analyzeInternalGraph(graph);
      setSourceNodeId((current) => current && graph.nodes.some((node) => node.id === current)
        ? current
        : analysis.brokerNodeIds[0] ?? analysis.hubNodeIds[0] ?? graph.nodes.find((node) => node.kind === 'person')?.id ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Adaptive Command unavailable', error instanceof Error ? error.message : 'Unable to assemble operator intelligence.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    const timer = setInterval(load, 45_000);
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
    () => adaptiveRun && suppressions
      ? evaluateInternalOperatorDecisionAdmission({
          adaptiveRun,
          watchtowerTriage,
          suppressionsEstablished: true,
          capabilities: {
            manage: operator.manage,
            restricted: operator.restricted,
            export: operator.export,
          },
        })
      : null,
    [adaptiveRun, watchtowerTriage, suppressions, operator.manage, operator.restricted, operator.export],
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

  if (!payload || !suppressions || !adaptiveRun || !decisionAdmission) return null;
  const health = adaptiveRun.epistemicHealth;
  const routing = adaptiveRun.routingPortfolio;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.13} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · ADAPTIVE NETWORK COMMAND" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Operator Command</NeonText>
              <NeonText variant="bodyMuted">Watchtower incident triage · epistemic authority · decision admission · diversified target routing · adaptive mission queue · human approval boundary</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metricRow}>
            <Metric label="GRAPH HEALTH" value={`${Math.round(health.score * 100)}%`} />
            <Metric label="POSTURE" value={adaptiveRun.decisionPosture.replaceAll('_', ' ').toUpperCase()} />
            <Metric label="OPEN INCIDENTS" value={`${watchtowerTriage?.openIncidentCount ?? 0}`} />
            <Metric label="ADMISSION BLOCKS" value={`${decisionAdmission.blockedCount}`} />
            <Metric label="MISSIONS" value={`${adaptiveRun.missionCount}`} />
          </View>

          <Surface elevated padded style={[styles.healthCard, health.band === 'degraded' || health.band === 'fragile' ? styles.warningBorder : null]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Pill label={`EPISTEMIC HEALTH · ${health.band.toUpperCase()}`} tone={health.band === 'strong' || health.band === 'usable' ? 'accent' : 'neutral'} dot />
                <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{Math.round(health.score * 100)}% analytical authority</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Non-safety mission priority is multiplied by {adaptiveRun.confidenceMultiplier.toFixed(2)} before operator review.</NeonText>
              </View>
            </View>
            {health.warnings.slice(0, 5).map((warning) => <NeonText key={warning} variant="bodyMuted" style={{ marginTop: 3 }}>• {warning}</NeonText>)}
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{health.methodology}</NeonText>
          </Surface>

          <Surface padded style={styles.boundaryCard}>
            <Pill label="ADAPTIVE AUTONOMY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{adaptiveRun.operatingRule}</NeonText>
            {adaptiveRun.operatingPrinciples.map((principle) => <NeonText key={principle} variant="bodyMuted" style={{ marginTop: 3 }}>• {principle}</NeonText>)}
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label="Watchtower" variant="ghost" onPress={() => navigation.navigate('InternalWatchtower', { eventId: eventId ?? undefined })} />
            <GlowButton label="Target Routing" variant="ghost" onPress={() => navigation.navigate('InternalTargetRouting', { eventId: eventId ?? undefined })} />
            <GlowButton label="Evidence Health" variant="ghost" onPress={() => navigation.navigate('InternalGraphHealth', { eventId: eventId ?? undefined })} />
            <GlowButton label="Mission Ledger" variant="ghost" onPress={() => navigation.navigate('InternalMissionLedger', { eventId: eventId ?? undefined })} />
            <GlowButton label="Private Access" variant="ghost" onPress={() => navigation.navigate('InternalPrivateAccess')} />
          </View>

          <Section title="WATCHTOWER INCIDENT TRIAGE" subtitle={`${activeRules.length} active structural watches; incidents are replayable review-urgency groupings, never person/org risk scores or automatic actions`}>
            {openIncidents.slice(0, 8).map((incident) => (
              <Surface key={incident.id} elevated padded style={[styles.incidentCard, incident.severity === 'critical' || incident.severity === 'high' ? styles.warningBorder : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={`${incident.severity.toUpperCase()} · ${incident.family.replaceAll('_', ' ').toUpperCase()}`} tone={incident.severity === 'critical' || incident.severity === 'high' ? 'accent' : 'neutral'} dot />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{incident.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{incident.summary}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">S{incident.score.toFixed(1)}</NeonText>
                </View>
                {incident.reasons.slice(0, 5).map((reason, index) => <NeonText key={`${incident.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>
                  {incident.eventCount} SIGNALS · {incident.openEventCount} OPEN · LAST {new Date(incident.lastSeenAt).toLocaleString()}
                </NeonText>
                <View style={styles.actionRow}>
                  <GlowButton
                    label="Open evidence"
                    variant="ghost"
                    onPress={() => navigation.navigate(incident.recommendedReviewSurface, { eventId: incident.eventId ?? eventId ?? undefined })}
                  />
                </View>
              </Surface>
            ))}
            {openIncidents.length === 0 ? <NeonText variant="bodyMuted">No open correlated Watchtower incidents.</NeonText> : null}
            {watchtowerTriage ? <NeonText variant="bodyMuted">{watchtowerTriage.operatingRule}</NeonText> : null}
          </Section>

          <Section title="DECISION ADMISSION" subtitle="Evidence can enter operator review only when graph quality, block truth and exact capability boundaries support that level of review; admission never authorizes action">
            {decisionAdmission.admissions.map((admission) => (
              <Surface key={admission.kind} padded style={[styles.admissionCard, admission.state === 'safety_blocked' || admission.state === 'evidence_remediation_required' ? styles.warningBorder : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={admissionLabel(admission.state)} tone={admission.state === 'admitted_to_review' ? 'accent' : 'neutral'} dot={admission.state === 'admitted_to_review'} />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{admission.title}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">A{Math.round(admission.authority * 100)}</NeonText>
                </View>
                {admission.reasons.slice(0, 5).map((reason, index) => <NeonText key={`${admission.kind}-reason-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                {admission.requiredRemediation.length > 0 ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <NeonText variant="label" tone="muted">REQUIRED BEFORE ESCALATION</NeonText>
                    {admission.requiredRemediation.slice(0, 4).map((item, index) => <NeonText key={`${admission.kind}-remediation-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {item}</NeonText>)}
                  </View>
                ) : null}
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{admission.operatingRule}</NeonText>
              </Surface>
            ))}
            <NeonText variant="bodyMuted">{decisionAdmission.operatingRule}</NeonText>
          </Section>

          <Section title="TARGET ROUTING OBJECTIVE" subtitle="Routing changes mission evidence only; it never authorizes outreach, predicts consent or bypasses blocks">
            <TextInput
              value={targetQuery}
              onChangeText={setTargetQuery}
              placeholder="Target ecosystem: defense, climate, investor, university…"
              placeholderTextColor="#64748B"
              style={styles.input}
              autoCapitalize="none"
            />
            {sourceNodeId ? <NeonText variant="bodyMuted">Source: {nodeLabel(payload, sourceNodeId)}</NeonText> : null}
            {routing ? (
              <View style={styles.metricRow}>
                <Metric label="ROUTES" value={`${routing.routes.length}`} />
                <Metric label="DIVERSITY" value={`${Math.round(routing.routeDiversity * 100)}%`} />
                <Metric label="CANDIDATES" value={`${routing.candidatePathCount}`} />
                <Metric label="SHARED BOTTLENECKS" value={`${routing.structuralSinglePointNodeIds.length}`} />
              </View>
            ) : null}
            {routing?.routes.slice(0, 3).map((routeResult) => (
              <Surface key={routeResult.id} padded style={styles.smallCard}>
                <View style={styles.rowBetween}>
                  <NeonText variant="h2" style={{ flex: 1 }}>{routeResult.targetLabel}</NeonText>
                  <Pill label={routeResult.confidenceFloor} tone={routeResult.confidenceFloor === 'VERIFIED' ? 'accent' : 'neutral'} />
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{routeResult.nodeIds.map((id) => nodeLabel(payload, id)).join(' → ')}</NeonText>
                <NeonText variant="label" tone="muted" style={{ marginTop: 4 }}>{Math.round(routeResult.verifiedEdgeRatio * 100)}% VERIFIED · {routeResult.hopCount} HOPS · SCORE {routeResult.score.toFixed(2)}</NeonText>
              </Surface>
            ))}
          </Section>

          <Section title="ADAPTIVE MISSION QUEUE" subtitle="Mission priority is graph-health calibrated; Sentinel is never down-weighted">
            {adaptiveRun.missions.map((mission) => (
              <Surface key={mission.id} elevated padded style={styles.missionCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={mission.agent.toUpperCase()} tone="accent" dot />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{mission.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{mission.thesis}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">P{mission.priority.toFixed(1)}</NeonText>
                </View>
                {mission.evidence.slice(0, 7).map((evidence, index) => <NeonText key={`${mission.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {evidence}</NeonText>)}
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
  boundaryCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  incidentCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  admissionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  missionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
});
