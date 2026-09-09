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
import { analyzeInternalGraph } from '../admin/InternalGraphEngine';
import { analyzeInternalEvidenceDebt } from '../admin/InternalEvidenceDebtEngine';
import { buildInternalTargetRoutingPortfolio } from '../admin/InternalTargetRoutingEngine';
import { simulateInternalValueOfInformation } from '../admin/InternalValueOfInformationEngine';
import {
  loadInternalEvidenceConflicts,
  type InternalEvidenceConflict,
} from '../admin/internalEvidenceConflict.service';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type EvidenceDebtRoute = {
  InternalEvidenceDebt: { eventId?: string } | undefined;
};

function nodeLabel(payload: Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalEvidenceDebtScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<EvidenceDebtRoute, 'InternalEvidenceDebt'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [evidenceConflicts, setEvidenceConflicts] = useState<InternalEvidenceConflict[]>([]);
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [graph, calibration, safeSuppressions, conflictState] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1800 }),
        operator.has('graph_manage')
          ? loadInternalBridgePatternCalibration()
          : Promise.resolve({ generatedAt: new Date().toISOString(), patterns: [], attributionNote: '' }),
        operator.has('graph_manage') ? getInternalBridgeSuppressions() : Promise.resolve(new Set<string>()),
        operator.has('graph_manage')
          ? loadInternalEvidenceConflicts({ eventId, includeClosed: false, limit: 160 })
          : Promise.resolve({ generatedAt: new Date().toISOString(), conflicts: [], operatingRule: '' }),
      ]);
      setPayload(graph);
      setPatterns(calibration.patterns);
      setSuppressions(safeSuppressions);
      setEvidenceConflicts(conflictState.conflicts);
      const analysis = analyzeInternalGraph(graph);
      setSourceNodeId((current) => current && graph.nodes.some((node) => node.id === current)
        ? current
        : analysis.brokerNodeIds[0] ?? analysis.hubNodeIds[0] ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      setSuppressions(null);
      setEvidenceConflicts([]);
      Alert.alert('Evidence Debt unavailable', error instanceof Error ? error.message : 'Unable to assemble verification obligations.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const routing = useMemo(
    () => payload && suppressions && sourceNodeId && targetQuery.trim()
      ? buildInternalTargetRoutingPortfolio({
          payload,
          sourceNodeId,
          targetQuery: targetQuery.trim(),
          patterns,
          suppressions,
          maxHops: 6,
          maxRoutes: 8,
        })
      : null,
    [payload, suppressions, sourceNodeId, targetQuery, patterns],
  );

  const report = useMemo(
    () => payload ? analyzeInternalEvidenceDebt({ payload, routingPortfolio: routing, evidenceConflicts }) : null,
    [payload, routing, evidenceConflicts],
  );

  const selectedDebt = useMemo(
    () => report?.items.find((item) => item.id === selectedDebtId) ?? null,
    [report, selectedDebtId],
  );

  const informationValue = useMemo(
    () => payload && suppressions && selectedDebt
      ? simulateInternalValueOfInformation({
          payload,
          debt: selectedDebt,
          sourceNodeId,
          targetQuery: targetQuery.trim() || null,
          patterns,
          suppressions,
        })
      : null,
    [payload, suppressions, selectedDebt, sourceNodeId, targetQuery, patterns],
  );

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>CALCULATING EVIDENCE DEBT</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_read')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="EVIDENCE DEBT · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }
  if (!payload || !report || !suppressions) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · VERIFICATION QUEUE" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Evidence Debt</NeonText>
              <NeonText variant="bodyMuted">Rank uncertainty and explicit evidence conflicts by analytical leverage, then bracket valid counterfactuals before spending analyst time. No people are scored; no external enrichment is required.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metricRow}>
            <Metric label="HIGH PRIORITY" value={`${report.highPriorityCount}`} />
            <Metric label="DEBT ITEMS" value={`${report.items.length}`} />
            <Metric label="OPEN CONFLICTS" value={`${evidenceConflicts.filter((item) => item.status === 'open').length}`} />
            <Metric label="RECOVERABLE AUTHORITY" value={`~${Math.round(report.expectedRecoverableAuthority * 100)}%`} />
            <Metric label="TOTAL WEIGHT" value={report.totalDebt.toFixed(1)} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="SELF-HEALING CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{report.operatingRule}</NeonText>
          </Surface>

          <Surface padded style={styles.objectiveCard}>
            <Pill label="OPTIONAL TARGET-ROUTING DEBT" tone="neutral" />
            <TextInput
              value={targetQuery}
              onChangeText={setTargetQuery}
              placeholder="Add a target ecosystem to expose route-specific evidence debt"
              placeholderTextColor="#64748B"
              style={styles.input}
              autoCapitalize="none"
            />
            {routing ? <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{routing.routes.length} routes · {Math.round(routing.routeDiversity * 100)}% diversity · {routing.structuralSinglePointNodeIds.length} shared bottlenecks</NeonText> : null}
          </Surface>

          {selectedDebt && informationValue ? (
            <Surface elevated padded style={styles.voiCard}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Pill label="COUNTERFACTUAL · VALUE OF INFORMATION" tone="accent" dot />
                  <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selectedDebt.title}</NeonText>
                </View>
                <Pressable onPress={() => setSelectedDebtId(null)}><NeonText variant="label" tone="muted">CLEAR</NeonText></Pressable>
              </View>
              <View style={styles.metricRow}>
                <Metric label="INFO VALUE" value={`${Math.round(informationValue.informationValue * 100)}%`} />
                <Metric label="SENSITIVITY" value={`${Math.round(informationValue.sensitivitySpan * 100)}%`} />
                <Metric label="SIMULATABLE" value={informationValue.simulatable ? 'YES' : 'NO'} />
              </View>
              {informationValue.conclusionSensitivity.map((line, index) => <NeonText key={`voi-s-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>)}
              {informationValue.confirmation ? (
                <Surface padded style={styles.scenarioCard}>
                  <Pill label="IF FIRST-PARTY EVIDENCE CONFIRMS IT" tone="accent" />
                  {informationValue.confirmation.summary.map((line, index) => <NeonText key={`confirm-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>)}
                </Surface>
              ) : null}
              {informationValue.disconfirmation ? (
                <Surface padded style={styles.scenarioCard}>
                  <Pill label="IF THE WEAK EVIDENCE IS DISPROVED / REMOVED" tone="neutral" />
                  {informationValue.disconfirmation.summary.map((line, index) => <NeonText key={`disconfirm-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>)}
                </Surface>
              ) : null}
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{informationValue.operatingRule}</NeonText>
            </Surface>
          ) : null}

          <View style={styles.actionRow}>
            <GlowButton label="Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab', { eventId: eventId ?? undefined })} />
            <GlowButton label="Evidence Lens" variant="ghost" onPress={() => navigation.navigate('InternalPerspectiveLab', { eventId: eventId ?? undefined })} />
            {operator.has('graph_manage') ? <GlowButton label="Conflict Review" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceConflicts', { eventId: eventId ?? undefined })} /> : null}
            {operator.has('graph_manage') ? <GlowButton label="Target Routing" variant="ghost" onPress={() => navigation.navigate('InternalTargetRouting', { eventId: eventId ?? undefined })} /> : null}
            {operator.has('graph_manage') ? <GlowButton label="Decision Journal" variant="ghost" onPress={() => navigation.navigate('InternalDecisionJournal', { eventId: eventId ?? undefined })} /> : null}
          </View>

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">VERIFICATION PRIORITY QUEUE</NeonText>
            <NeonText variant="bodyMuted">Highest-leverage uncertainty first. Expected authority gain is a graph-method heuristic, not a guarantee. Counterfactual simulation is opt-in per item; evidence conflicts are reconciled directly rather than collapsed into fake binary scenarios.</NeonText>
            {report.items.map((item, index) => (
              <Surface key={item.id} elevated padded style={[styles.debtCard, selectedDebtId === item.id ? styles.selectedBorder : null]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={`P${index + 1} · ${item.kind.replaceAll('_', ' ').toUpperCase()}`} tone={item.priority >= 7 ? 'accent' : 'neutral'} dot={item.priority >= 7} />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{item.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{item.summary}</NeonText>
                  </View>
                  <View style={styles.scoreBlock}>
                    <NeonText variant="mono" tone="accent">{item.priority.toFixed(1)}</NeonText>
                    <NeonText variant="label" tone="muted">+~{Math.round(item.expectedAuthorityGain * 100)}%</NeonText>
                  </View>
                </View>
                {item.reasons.slice(0, 4).map((reason, reasonIndex) => <NeonText key={`${item.id}-r-${reasonIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                {item.remediation.slice(0, 4).map((step, stepIndex) => <NeonText key={`${item.id}-m-${stepIndex}`} variant="body" style={{ marginTop: 4 }}>→ {step}</NeonText>)}
                {item.nodeIds.length > 0 ? <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>{[...new Set(item.nodeIds)].slice(0, 6).map((id) => nodeLabel(payload, id)).join(' · ')}</NeonText> : null}
                <View style={styles.actionRow}>
                  <GlowButton label="Estimate information value" variant="ghost" onPress={() => setSelectedDebtId(item.id)} />
                  <GlowButton label="Open remediation surface" variant="ghost" onPress={() => navigation.navigate(item.recommendedSurface, { eventId: eventId ?? undefined })} />
                </View>
              </Surface>
            ))}
            {report.items.length === 0 ? <NeonText variant="bodyMuted">No meaningful evidence debt detected in the current authorized graph.</NeonText> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
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
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  objectiveCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong, gap: spacing.sm },
  voiCard: { borderRadius: radii.xl, borderColor: palette.accent, gap: spacing.sm },
  scenarioCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  debtCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong, gap: 3 },
  selectedBorder: { borderColor: palette.accent },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  scoreBlock: { alignItems: 'flex-end', gap: 2 },
});
