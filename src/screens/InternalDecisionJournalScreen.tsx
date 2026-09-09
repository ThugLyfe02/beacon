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
import {
  analyzeInternalDecisionCalibration,
  getInternalDecisionCalibrationAdjustment,
} from '../admin/InternalDecisionCalibrationEngine';
import {
  evaluateInternalOperatorDecisionAdmission,
  type InternalOperatorDecisionKind,
} from '../admin/InternalOperatorDecisionAdmission';
import {
  loadInternalDecisionJournal,
  recordInternalDecisionContext,
  resolveInternalDecisionJournal,
  saveInternalDecisionJournal,
  type InternalDecisionJournalEntry,
  type InternalDecisionJournalStatus,
  type InternalDecisionRetrospectiveMetrics,
} from '../admin/internalDecisionJournal.service';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { loadInternalGraphWatchtower, type InternalGraphWatchtowerState } from '../admin/internalGraphWatchtower.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type JournalRoute = {
  InternalDecisionJournal: { eventId?: string } | undefined;
};

const DECISION_KINDS: Array<{ kind: InternalOperatorDecisionKind; label: string }> = [
  { kind: 'analysis_review', label: 'ANALYSIS' },
  { kind: 'target_route_review', label: 'ROUTING' },
  { kind: 'intervention_review', label: 'INTERVENTION' },
  { kind: 'restricted_forensics_review', label: 'RESTRICTED' },
  { kind: 'portable_export_review', label: 'EXPORT' },
];

function statusTone(status: InternalDecisionJournalStatus): 'accent' | 'neutral' {
  return status === 'supported' ? 'accent' : 'neutral';
}

export default function InternalDecisionJournalScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<JournalRoute, 'InternalDecisionJournal'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [watchtower, setWatchtower] = useState<InternalGraphWatchtowerState | null>(null);
  const [entries, setEntries] = useState<InternalDecisionJournalEntry[]>([]);
  const [decisionKind, setDecisionKind] = useState<InternalOperatorDecisionKind>('analysis_review');
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [disconfirmingCondition, setDisconfirmingCondition] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [conclusionNote, setConclusionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [graph, calibration, safeSuppressions, watchState, journal] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1600 }),
        loadInternalBridgePatternCalibration(),
        getInternalBridgeSuppressions(),
        loadInternalGraphWatchtower(),
        loadInternalDecisionJournal(eventId),
      ]);
      setPayload(graph);
      setPatterns(calibration.patterns);
      setSuppressions(safeSuppressions);
      setWatchtower(watchState);
      setEntries(journal.entries);
      const analysis = analyzeInternalGraph(graph);
      setSourceNodeId((current) => current && graph.nodes.some((node) => node.id === current)
        ? current
        : analysis.brokerNodeIds[0] ?? analysis.hubNodeIds[0] ?? graph.nodes.find((node) => node.kind === 'person')?.id ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Decision Journal unavailable', error instanceof Error ? error.message : 'Unable to assemble decision evidence.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

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
    [payload, suppressions, patterns, targetQuery, sourceNodeId],
  );

  const timeline = useMemo(() => payload ? buildInternalAgenticTimeline(payload) : null, [payload]);

  const triage = useMemo(
    () => watchtower && adaptiveRun
      ? triageInternalWatchtower({ state: watchtower, epistemicHealth: adaptiveRun.epistemicHealth })
      : null,
    [watchtower, adaptiveRun],
  );

  const decisionCalibration = useMemo(
    () => analyzeInternalDecisionCalibration(entries),
    [entries],
  );

  const admissionSet = useMemo(
    () => adaptiveRun && suppressions
      ? evaluateInternalOperatorDecisionAdmission({
          adaptiveRun,
          watchtowerTriage: triage,
          decisionCalibration,
          suppressionsEstablished: true,
          capabilities: {
            manage: operator.manage,
            restricted: operator.restricted,
            export: operator.export,
          },
        })
      : null,
    [adaptiveRun, suppressions, triage, decisionCalibration, operator.manage, operator.restricted, operator.export],
  );

  const selectedAdmission = admissionSet?.admissions.find((admission) => admission.kind === decisionKind) ?? null;
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const selectedCalibrationBucket = decisionCalibration.byDecisionKind.find((bucket) => bucket.key === decisionKind) ?? null;
  const selectedCalibrationAdjustment = getInternalDecisionCalibrationAdjustment(decisionCalibration, decisionKind);
  const resolutionAdmission = selectedEntry
    ? admissionSet?.admissions.find((admission) => admission.kind === selectedEntry.decisionKind) ?? null
    : null;
  const resolutionCalibrationAdjustment = selectedEntry
    ? getInternalDecisionCalibrationAdjustment(decisionCalibration, selectedEntry.decisionKind)
    : null;

  const retrospectiveMetrics = useCallback((admissionKind: InternalOperatorDecisionKind): InternalDecisionRetrospectiveMetrics | null => {
    if (!adaptiveRun || !triage || !timeline || !admissionSet) return null;
    const routing = adaptiveRun.routingPortfolio;
    const bestRoute = routing?.routes[0] ?? null;
    const temporal = bestRoute ? analyzeInternalRouteTemporalCoherence(bestRoute) : null;
    const calibrationAdjustment = getInternalDecisionCalibrationAdjustment(decisionCalibration, admissionKind);
    return {
      healthScore: adaptiveRun.epistemicHealth.score,
      verifiedRatio: adaptiveRun.epistemicHealth.verifiedEdgeRatio,
      ambiguousRatio: adaptiveRun.epistemicHealth.ambiguousEdgeRatio,
      freshRatio: adaptiveRun.epistemicHealth.freshEdgeRatio,
      repeatedRatio: adaptiveRun.epistemicHealth.repeatedEvidenceRatio,
      routeDiversity: routing ? routing.routeDiversity : null,
      routeCount: routing?.routes.length ?? 0,
      sharedBottlenecks: routing?.structuralSinglePointNodeIds.length ?? 0,
      temporalOverlap: temporal?.overlapScore ?? null,
      chronologyGaps: timeline.chronologyGapCount,
      openIncidents: triage.openIncidentCount,
      criticalIncidents: triage.criticalIncidentCount,
      calibrationPenalty: calibrationAdjustment.penalty,
    };
  }, [adaptiveRun, triage, timeline, admissionSet, decisionCalibration]);

  const save = async () => {
    if (!payload || !adaptiveRun || !selectedAdmission || !triage) return;
    if (title.trim().length < 3 || hypothesis.trim().length < 20 || disconfirmingCondition.trim().length < 12) {
      Alert.alert('Falsifiable hypothesis required', 'Add a title, a hypothesis of at least 20 characters, and a disconfirming condition of at least 12 characters.');
      return;
    }
    setSaving(true);
    try {
      const routing = adaptiveRun.routingPortfolio;
      const saved = await saveInternalDecisionJournal({
        eventId,
        decisionKind,
        title,
        hypothesis,
        disconfirmingCondition,
        graphVersion: payload.graphVersion,
        admissionState: selectedAdmission.state,
        admissionAuthority: selectedAdmission.authority,
        evidenceSummary: {
          schemaVersion: 'decision-evidence-v3-retrospective',
          graphVersion: payload.graphVersion,
          decisionKind,
          admissionState: selectedAdmission.state,
          admissionAuthority: selectedAdmission.authority,
          methodCalibration: selectedCalibrationBucket ? {
            resolvedCount: selectedCalibrationBucket.resolvedCount,
            maturity: selectedCalibrationBucket.maturity,
            conservativeSupportFloor: selectedCalibrationBucket.conservativeSupportFloor,
            calibrationGap: selectedCalibrationBucket.calibrationGap,
            penalty: selectedCalibrationAdjustment.penalty,
          } : null,
          epistemicHealth: {
            band: adaptiveRun.epistemicHealth.band,
            score: adaptiveRun.epistemicHealth.score,
            verifiedEdgeRatio: adaptiveRun.epistemicHealth.verifiedEdgeRatio,
            ambiguousEdgeRatio: adaptiveRun.epistemicHealth.ambiguousEdgeRatio,
            freshEdgeRatio: adaptiveRun.epistemicHealth.freshEdgeRatio,
            repeatedEvidenceRatio: adaptiveRun.epistemicHealth.repeatedEvidenceRatio,
          },
          watchtower: {
            openIncidentCount: triage.openIncidentCount,
            criticalIncidentCount: triage.criticalIncidentCount,
            topIncidentFamilies: triage.incidents.slice(0, 5).map((incident) => incident.family),
          },
          routing: routing ? {
            matchedTargetCount: routing.matchedTargetCount,
            candidatePathCount: routing.candidatePathCount,
            routeCount: routing.routes.length,
            routeDiversity: routing.routeDiversity,
            structuralSinglePointCount: routing.structuralSinglePointNodeIds.length,
            bestConfidenceFloor: routing.routes[0]?.confidenceFloor ?? null,
            bestVerifiedEdgeRatio: routing.routes[0]?.verifiedEdgeRatio ?? null,
          } : null,
          effectiveCapabilities: {
            manage: operator.manage,
            restricted: operator.restricted,
            export: operator.export,
          },
        },
      });
      const metrics = retrospectiveMetrics(decisionKind);
      if (metrics) {
        await recordInternalDecisionContext({
          journalId: saved.id,
          phase: 'created',
          graphVersion: payload.graphVersion,
          metrics,
        });
      }
      setTitle('');
      setHypothesis('');
      setDisconfirmingCondition('');
      await load();
    } catch (error) {
      Alert.alert('Unable to seal hypothesis', error instanceof Error ? error.message : 'Decision Journal write failed.');
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (status: Exclude<InternalDecisionJournalStatus, 'open'>) => {
    if (!selectedEntry || conclusionNote.trim().length < 3) {
      Alert.alert('Conclusion required', 'Select an open hypothesis and add a conclusion note before resolving it.');
      return;
    }
    setResolving(true);
    try {
      const metrics = retrospectiveMetrics(selectedEntry.decisionKind);
      if (metrics && payload) {
        try {
          await recordInternalDecisionContext({
            journalId: selectedEntry.id,
            phase: 'resolved',
            graphVersion: payload.graphVersion,
            metrics,
          });
        } catch (contextError) {
          // Legacy hypotheses may predate migration 073 and therefore have no
          // truthful decision-time context to compare against. Do not fabricate it.
          console.warn('[DecisionJournal] retrospective context unavailable for legacy entry:', contextError);
        }
      }
      await resolveInternalDecisionJournal({ journalId: selectedEntry.id, status, conclusionNote });
      setSelectedEntryId(null);
      setConclusionNote('');
      await load();
    } catch (error) {
      Alert.alert('Unable to resolve hypothesis', error instanceof Error ? error.message : 'Decision Journal resolution failed.');
    } finally {
      setResolving(false);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>LOADING DECISION MEMORY</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="DECISION JOURNAL · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }
  if (!payload || !adaptiveRun || !admissionSet || !selectedAdmission || !triage || !timeline) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · FALSIFIABLE DECISION MEMORY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Decision Journal</NeonText>
              <NeonText variant="bodyMuted">Hypothesis → calibrated authority → decision-time metrics → disconfirming condition → resolution-time metrics → later outcome. Historical context can only calibrate the analytical method.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.card}>
            <Pill label="CURRENT CALIBRATED EVIDENCE ENVELOPE" tone="neutral" dot />
            <View style={styles.metricRow}>
              <Metric label="HEALTH" value={`${Math.round(adaptiveRun.epistemicHealth.score * 100)}%`} />
              <Metric label="ADMISSION" value={selectedAdmission.state.replaceAll('_', ' ').toUpperCase()} />
              <Metric label="AUTHORITY" value={`${Math.round(selectedAdmission.authority * 100)}%`} />
              <Metric label="CALIBRATION PENALTY" value={`${Math.round(selectedCalibrationAdjustment.penalty * 100)}%`} />
              <Metric label="CHRONOLOGY GAPS" value={`${timeline.chronologyGapCount}`} />
            </View>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{selectedAdmission.operatingRule}</NeonText>
          </Surface>

          <Section title="NEW HYPOTHESIS" subtitle="Write what you currently believe and, before saving it, what evidence would prove the belief too weak or wrong">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
              {DECISION_KINDS.map((item) => (
                <Pressable key={item.kind} onPress={() => setDecisionKind(item.kind)} style={[styles.kindChip, decisionKind === item.kind && styles.kindChipActive]}>
                  <NeonText variant="label" tone={decisionKind === item.kind ? 'accent' : 'muted'}>{item.label}</NeonText>
                </Pressable>
              ))}
            </ScrollView>
            {(decisionKind === 'target_route_review' || decisionKind === 'intervention_review') ? <TextInput value={targetQuery} onChangeText={setTargetQuery} placeholder="Optional target ecosystem used for current route evidence" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" /> : null}
            <TextInput value={title} onChangeText={setTitle} placeholder="Short hypothesis title" placeholderTextColor="#64748B" style={styles.input} />
            <TextInput value={hypothesis} onChangeText={setHypothesis} placeholder="What does the current graph evidence support believing?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <TextInput value={disconfirmingCondition} onChangeText={setDisconfirmingCondition} placeholder="What future evidence would weaken or invalidate this hypothesis?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <Surface padded style={styles.smallCard}>
              <NeonText variant="label" tone="accent">CALIBRATED ADMISSION SNAPSHOT · {selectedAdmission.state.replaceAll('_', ' ').toUpperCase()}</NeonText>
              {selectedAdmission.reasons.slice(0, 5).map((reason, index) => <NeonText key={`reason-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
              {selectedAdmission.requiredRemediation.slice(0, 3).map((item, index) => <NeonText key={`remediation-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• remediation: {item}</NeonText>)}
            </Surface>
            <GlowButton label={saving ? 'Sealing…' : 'Seal hypothesis + retrospective baseline'} disabled={saving} onPress={() => void save()} />
          </Section>

          <Section title="HYPOTHESIS LEDGER" subtitle={`${entries.filter((entry) => entry.status === 'open').length} open · ${entries.length} retained in this private scope`}>
            {entries.map((entry) => (
              <Pressable key={entry.id} onPress={() => setSelectedEntryId(entry.id)}>
                <Surface elevated padded style={[styles.entryCard, selectedEntryId === entry.id && styles.selectedBorder]}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}><Pill label={`${entry.status.toUpperCase()} · ${entry.decisionKind.replaceAll('_', ' ').toUpperCase()}`} tone={statusTone(entry.status)} dot={entry.status === 'open'} /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{entry.title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{entry.hypothesis}</NeonText></View>
                    <NeonText variant="mono" tone="accent">A{Math.round(entry.admissionAuthority * 100)}</NeonText>
                  </View>
                  <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>WOULD BE DISCONFIRMED BY</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{entry.disconfirmingCondition}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>graph {entry.graphVersion.slice(0, 16)}… · evidence {entry.evidenceDigest.slice(0, 12)}… · {new Date(entry.createdAt).toLocaleString()}</NeonText>
                  {entry.conclusionNote ? <NeonText variant="body" style={{ marginTop: spacing.sm }}>Conclusion: {entry.conclusionNote}</NeonText> : null}
                </Surface>
              </Pressable>
            ))}
            {entries.length === 0 ? <NeonText variant="bodyMuted">No hypotheses sealed in this scope yet.</NeonText> : null}
          </Section>

          {selectedEntry?.status === 'open' ? (
            <Section title="RESOLVE SELECTED HYPOTHESIS" subtitle="Resolution records current analytical-state metrics before recalibrating the method; it never mutates graph evidence automatically">
              {resolutionAdmission ? <NeonText variant="bodyMuted">Current {selectedEntry.decisionKind.replaceAll('_', ' ')} authority: {Math.round(resolutionAdmission.authority * 100)}% · calibration penalty {Math.round((resolutionCalibrationAdjustment?.penalty ?? 0) * 100)}%</NeonText> : null}
              <TextInput value={conclusionNote} onChangeText={setConclusionNote} placeholder="What changed, held, or failed?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
              <View style={styles.actionRow}>
                <GlowButton label="Supported" variant="ghost" disabled={resolving} onPress={() => void resolve('supported')} />
                <GlowButton label="Weakened" variant="ghost" disabled={resolving} onPress={() => void resolve('weakened')} />
                <GlowButton label="Invalidated" variant="ghost" disabled={resolving} onPress={() => void resolve('invalidated')} />
                <GlowButton label="Close" variant="ghost" disabled={resolving} onPress={() => void resolve('closed')} />
              </View>
            </Section>
          ) : null}

          <Surface padded style={styles.card}>
            <Pill label="MEMORY BOUNDARY" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>The database stores bounded hypothesis metadata, an evidence digest, and a strict metrics-only retrospective envelope. It does not retain the graph payload, target query, person ids, contact data, or movement. Historical overconfidence may reduce later analytical authority; historical underconfidence never grants more authority automatically.</NeonText>
          </Surface>
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
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  metricRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 128, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  kindRow: { gap: spacing.sm },
  kindChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairline },
  kindChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  entryCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  selectedBorder: { borderColor: palette.accent },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});