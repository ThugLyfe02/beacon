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
import {
  analyzeInternalGraph,
  type InternalGraphPayload,
} from '../admin/InternalGraphEngine';
import {
  analyzeInternalGraphDrift,
  findPathsToTargetEcosystem,
  rankInternalGraphInterventions,
  runInternalGraphAgentOrchestrator,
} from '../admin/InternalGraphStrategyEngine';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import { exportInternalGraph } from '../admin/InternalGraphExportService';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type StrategyRoute = {
  InternalStrategyLab: { eventId?: string } | undefined;
};

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function eventTime(event: InternalGraphEventSummary): number {
  const candidate = event.endsAt ?? event.startsAt;
  const parsed = candidate ? Date.parse(candidate) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function InternalStrategyLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<StrategyRoute, 'InternalStrategyLab'>>();
  const operator = useInternalOperator();
  const requestedEventId = route.params?.eventId ?? null;

  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(requestedEventId);
  const [current, setCurrent] = useState<InternalGraphPayload | null>(null);
  const [previous, setPrevious] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [sequence, patternCalibration, safeSuppressions] = await Promise.all([
        loadInternalGraphEventSequence(48),
        operator.has('graph_manage')
          ? loadInternalBridgePatternCalibration()
          : Promise.resolve({ generatedAt: new Date().toISOString(), patterns: [], attributionNote: '' }),
        operator.has('graph_manage') ? getInternalBridgeSuppressions() : Promise.resolve(new Set<string>()),
      ]);
      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedId = currentEventId ?? requestedEventId ?? ordered[0]?.eventId ?? null;
      setEvents(ordered);
      setCurrentEventId(selectedId);
      setPatterns(patternCalibration.patterns);
      setSuppressions(safeSuppressions);

      if (!selectedId) {
        setCurrent(await loadInternalIntelligenceGraph({ includeRestricted: false, limit: 1400 }));
        setPrevious(null);
        return;
      }

      const currentIndex = ordered.findIndex((event) => event.eventId === selectedId);
      const previousId = currentIndex >= 0 ? ordered[currentIndex + 1]?.eventId ?? null : null;
      const [nextCurrent, nextPrevious] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId: selectedId, includeRestricted: false, limit: 1400 }),
        previousId
          ? loadInternalIntelligenceGraph({ eventId: previousId, includeRestricted: false, limit: 1400 })
          : Promise.resolve(null),
      ]);
      setCurrent(nextCurrent);
      setPrevious(nextPrevious);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Strategy Lab unavailable', error instanceof Error ? error.message : 'Unable to assemble strategy evidence.');
    } finally {
      setLoading(false);
    }
  }, [operator, currentEventId, requestedEventId]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    const timer = setInterval(load, 45_000);
    return () => clearInterval(timer);
  }, [operator, load]);

  const currentAnalysis = useMemo(() => current ? analyzeInternalGraph(current) : null, [current]);
  const drift = useMemo(
    () => current && previous ? analyzeInternalGraphDrift(previous, current) : null,
    [previous, current],
  );

  useEffect(() => {
    if (!currentAnalysis || !current) return;
    if (sourceNodeId && current.nodes.some((node) => node.id === sourceNodeId)) return;
    setSourceNodeId(currentAnalysis.brokerNodeIds[0] ?? currentAnalysis.hubNodeIds[0] ?? current.nodes.find((node) => node.kind === 'person')?.id ?? null);
  }, [currentAnalysis, current, sourceNodeId]);

  const interventions = useMemo(
    () => current && suppressions
      ? rankInternalGraphInterventions({ payload: current, patterns, suppressions, drift })
      : [],
    [current, patterns, suppressions, drift],
  );

  const targetPaths = useMemo(
    () => current && sourceNodeId && targetQuery.trim()
      ? findPathsToTargetEcosystem(current, sourceNodeId, targetQuery, 6)
      : [],
    [current, sourceNodeId, targetQuery],
  );

  const agentRun = useMemo(
    () => current && suppressions
      ? runInternalGraphAgentOrchestrator({
          current,
          previous,
          patterns,
          suppressions,
          targetQuery: targetQuery.trim() || null,
          sourceNodeId,
        })
      : null,
    [current, previous, patterns, suppressions, targetQuery, sourceNodeId],
  );

  const doExport = async (format: 'graphml' | 'cypher') => {
    if (!operator.has('graph_export')) return;
    setExporting(true);
    try {
      const result = await exportInternalGraph({
        format,
        eventId: currentEventId,
        includeRestricted: false,
      });
      Alert.alert(
        'Constellation export ready',
        `${format.toUpperCase()} · ${result.nodeCount} nodes · ${result.edgeCount} edges · ${result.bytes.toLocaleString()} bytes`,
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Unable to export graph.');
    } finally {
      setExporting(false);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          RUNNING CONSTELLATION AGENTS
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="STRATEGY LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  if (!current || !currentAnalysis || !suppressions || !agentRun) return null;

  const selectedEvent = events.find((event) => event.eventId === currentEventId) ?? null;
  const previousEvent = currentEventId
    ? events[events.findIndex((event) => event.eventId === currentEventId) + 1] ?? null
    : null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.14} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · STRATEGY ORCHESTRATOR" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Strategy Lab</NeonText>
              <NeonText variant="bodyMuted">
                Temporal graph drift · broker intelligence · target-ecosystem paths · human-approved agent missions
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
            {events.slice(0, 16).map((event) => (
              <Pressable
                key={event.eventId}
                onPress={() => setCurrentEventId(event.eventId)}
                style={[styles.eventChip, currentEventId === event.eventId && styles.eventChipActive]}
              >
                <NeonText variant="label" tone={currentEventId === event.eventId ? 'accent' : 'muted'}>
                  {event.name.toUpperCase()}
                </NeonText>
                <NeonText variant="bodyMuted">{event.participantCount} people · {event.mutualCount} mutuals</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <GlowButton label="Open Constellation" variant="ghost" onPress={() => navigation.navigate('InternalGraph', { eventId: currentEventId ?? undefined })} />
            {operator.has('graph_manage') ? (
              <GlowButton label="Bridge Lab" variant="ghost" onPress={() => navigation.navigate('InternalBridgeLab', { eventId: currentEventId ?? undefined })} />
            ) : null}
            {operator.has('graph_export') ? (
              <>
                <GlowButton label={exporting ? 'Exporting…' : 'GraphML'} variant="ghost" disabled={exporting} onPress={() => doExport('graphml')} />
                <GlowButton label={exporting ? 'Exporting…' : 'Neo4j Cypher'} variant="ghost" disabled={exporting} onPress={() => doExport('cypher')} />
              </>
            ) : null}
          </View>

          <View style={styles.metricRow}>
            <Metric label="NODES" value={`${current.nodeCount}`} />
            <Metric label="EDGES" value={`${current.edgeCount}`} />
            <Metric label="COMMUNITIES" value={`${currentAnalysis.communities.length}`} />
            <Metric label="MISSIONS" value={`${agentRun.missionCount}`} />
          </View>

          <Surface padded style={styles.agentRule}>
            <Pill label="AUTONOMY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              {agentRun.operatingRule}
            </NeonText>
          </Surface>

          <Section title="AGENT MISSION QUEUE" subtitle="Continuously re-ranked evidence missions; every social intervention requires operator approval">
            {agentRun.missions.map((mission) => (
              <Surface key={mission.id} elevated padded style={styles.missionCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={mission.agent.toUpperCase()} tone="accent" dot />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{mission.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{mission.thesis}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">P{mission.priority.toFixed(1)}</NeonText>
                </View>
                {mission.evidence.map((evidence, index) => (
                  <NeonText key={`${mission.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {evidence}</NeonText>
                ))}
                <NeonText variant="body" style={{ marginTop: spacing.sm }}>{mission.recommendedAction}</NeonText>
                <Pill label="HUMAN APPROVAL REQUIRED" tone="neutral" />
              </Surface>
            ))}
          </Section>

          <Section
            title="EVENT-TO-EVENT GRAPH DRIFT"
            subtitle={selectedEvent && previousEvent ? `${previousEvent.name} → ${selectedEvent.name}` : 'A prior event is required for drift analysis'}
          >
            {drift ? (
              <>
                <View style={styles.metricRow}>
                  <Metric label="NEW BROKERS" value={`${drift.newBrokerIds.length}`} />
                  <Metric label="CONVERGENCE" value={`${Math.round(drift.convergenceScore * 100)}%`} />
                  <Metric label="SPLITS" value={`${drift.splits.length}`} />
                  <Metric label="NEW BRIDGES" value={`${drift.newBridgeKeys.length}`} />
                </View>
                {drift.movements.filter((movement) => movement.status !== 'stable').slice(0, 10).map((movement) => (
                  <Surface key={`movement-${movement.currentCommunityId}`} padded style={styles.smallCard}>
                    <NeonText variant="h2">{movement.currentLabel}</NeonText>
                    <NeonText variant="bodyMuted">
                      {movement.status.toUpperCase()} · prior communities {movement.previousCommunityIds.join(', ') || 'none'} · retained {Math.round(movement.retainedRatio * 100)}%
                    </NeonText>
                  </Surface>
                ))}
                {drift.splits.slice(0, 8).map((split) => (
                  <Surface key={`split-${split.previousCommunityId}`} padded style={styles.smallCard}>
                    <NeonText variant="h2">Split: {split.previousLabel}</NeonText>
                    <NeonText variant="bodyMuted">Now spans communities {split.currentCommunityIds.join(', ')} · shared nodes {split.sharedNodeCount}</NeonText>
                  </Surface>
                ))}
              </>
            ) : <NeonText variant="bodyMuted">No previous event graph is available for this selection.</NeonText>}
          </Section>

          <Section title="TARGET ECOSYSTEM PATHFINDER" subtitle="Ask where the current graph can credibly reach; paths are evidence chains, not contact recommendations">
            <TextInput
              value={targetQuery}
              onChangeText={setTargetQuery}
              placeholder="e.g. fintech, investor, climate, defense, university…"
              placeholderTextColor="#64748B"
              style={styles.input}
              autoCapitalize="none"
            />
            {sourceNodeId ? (
              <NeonText variant="bodyMuted">Starting from broker: {nodeLabel(current, sourceNodeId)}</NeonText>
            ) : null}
            {targetPaths.map((result) => (
              <Surface key={result.targetNodeId} padded style={styles.smallCard}>
                <NeonText variant="h2">{result.targetLabel} · {result.targetKind}</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                  {result.path.nodeIds.map((nodeId) => nodeLabel(current, nodeId)).join(' → ')}
                </NeonText>
                <NeonText variant="label" tone="muted">COST {result.path.cost.toFixed(3)} · {result.path.edgeIds.length} HOPS</NeonText>
              </Surface>
            ))}
            {targetQuery.trim() && targetPaths.length === 0 ? (
              <NeonText variant="bodyMuted">No explainable route reaches that ecosystem in this event graph.</NeonText>
            ) : null}
          </Section>

          <Section title="OPERATOR INTERVENTION FRONTIER" subtitle="Where a human action may improve useful network formation without inventing intent">
            {interventions.slice(0, 16).map((opportunity, index) => (
              <Surface key={opportunity.id} padded style={styles.interventionCard}>
                <View style={styles.rank}><NeonText variant="mono" tone="accent">{index + 1}</NeonText></View>
                <View style={{ flex: 1 }}>
                  <NeonText variant="label" tone="accent">{opportunity.kind.replaceAll('_', ' ').toUpperCase()}</NeonText>
                  <NeonText variant="h2" style={{ marginTop: 3 }}>{opportunity.title}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{opportunity.rationale.join(' · ')}</NeonText>
                  <NeonText variant="mono" tone="muted" style={{ marginTop: 4 }}>SCORE {opportunity.score.toFixed(2)}</NeonText>
                </View>
              </Surface>
            ))}
          </Section>

          {patterns.length > 0 ? (
            <Section title="BRIDGE PATTERN MEMORY" subtitle="Observed chronology by connector archetype; never interpreted as causal lift">
              {patterns.slice(0, 10).map((pattern) => (
                <Surface key={pattern.connectorKind} padded style={styles.smallCard}>
                  <View style={styles.rowBetween}>
                    <NeonText variant="h2">{pattern.connectorKind}</NeonText>
                    <Pill label={`n=${pattern.sampleSize}`} tone="neutral" />
                  </View>
                  <NeonText variant="bodyMuted">
                    mutual+ {Math.round(pattern.mutualRate * 100)}% · Office Hours+ {Math.round(pattern.officeHoursRate * 100)}% · outcome+ {Math.round(pattern.outcomeRate * 100)}% · confidence {Math.round(pattern.confidence * 100)}%
                  </NeonText>
                </Surface>
              ))}
            </Section>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.metric}>
      <NeonText variant="h1" tone="accent" glow>{value}</NeonText>
      <NeonText variant="label" tone="muted">{label}</NeonText>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <View style={styles.section}>
      <View>
        <NeonText variant="label" tone="accent">{title}</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030611' },
  centered: { flex: 1, backgroundColor: '#030611', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  eventRow: { gap: spacing.sm },
  eventChip: { minWidth: 180, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.66)' },
  eventChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  metric: { flex: 1, minWidth: 82, minHeight: 72, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.72)', alignItems: 'center', justifyContent: 'center' },
  agentRule: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  missionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  interventionCard: { borderRadius: radii.lg, borderColor: palette.hairline, flexDirection: 'row', gap: spacing.md },
  rank: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
});
