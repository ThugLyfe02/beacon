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
  INTERNAL_GRAPH_MACHINES,
  runInternalGraphMachine,
  type InternalGraphMachineDefinition,
  type InternalGraphMachineRun,
} from '../admin/InternalGraphMachineEngine';
import {
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import { analyzeInternalGraph, type InternalGraphPayload } from '../admin/InternalGraphEngine';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type MachineRoute = {
  InternalMachineLab: { eventId?: string; nodeId?: string; machineId?: string } | undefined;
};

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function machineReady(machine: InternalGraphMachineDefinition, input: {
  seedNodeId: string | null;
  targetQuery: string;
  previous: InternalGraphPayload | null;
}): boolean {
  if (machine.requiresSeed && !input.seedNodeId) return false;
  if (machine.requiresTargetQuery && !input.targetQuery.trim()) return false;
  if (machine.requiresPreviousGraph && !input.previous) return false;
  return true;
}

export default function InternalMachineLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<MachineRoute, 'InternalMachineLab'>>();
  const operator = useInternalOperator();
  const requestedEventId = route.params?.eventId ?? null;
  const requestedNodeId = route.params?.nodeId ?? null;
  const requestedMachineId = route.params?.machineId ?? null;

  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(requestedEventId);
  const [current, setCurrent] = useState<InternalGraphPayload | null>(null);
  const [previous, setPrevious] = useState<InternalGraphPayload | null>(null);
  const [machineId, setMachineId] = useState(
    INTERNAL_GRAPH_MACHINES.some((machine) => machine.id === requestedMachineId)
      ? requestedMachineId!
      : 'broker-xray',
  );
  const [seedNodeId, setSeedNodeId] = useState<string | null>(requestedNodeId);
  const [seedQuery, setSeedQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const sequence = await loadInternalGraphEventSequence(48);
      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedId = currentEventId ?? requestedEventId ?? ordered[0]?.eventId ?? null;
      setEvents(ordered);
      setCurrentEventId(selectedId);
      const selectedIndex = selectedId ? ordered.findIndex((event) => event.eventId === selectedId) : -1;
      const previousId = selectedIndex >= 0 ? ordered[selectedIndex + 1]?.eventId ?? null : null;
      const [nextCurrent, nextPrevious] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId: selectedId, includeRestricted: false, limit: 1600 }),
        previousId
          ? loadInternalIntelligenceGraph({ eventId: previousId, includeRestricted: false, limit: 1600 })
          : Promise.resolve(null),
      ]);
      setCurrent(nextCurrent);
      setPrevious(nextPrevious);
      setLastRefreshAt(new Date().toISOString());

      const validRequested = requestedNodeId && nextCurrent.nodes.some((node) => node.id === requestedNodeId)
        ? requestedNodeId
        : null;
      setSeedNodeId((existing) => {
        if (existing && nextCurrent.nodes.some((node) => node.id === existing)) return existing;
        if (validRequested) return validRequested;
        const analysis = analyzeInternalGraph(nextCurrent);
        return analysis.brokerNodeIds[0]
          ?? nextCurrent.nodes.find((node) => node.kind === 'person')?.id
          ?? nextCurrent.nodes[0]?.id
          ?? null;
      });
    } catch (error) {
      if (!quiet) {
        Alert.alert('Machine Lab unavailable', error instanceof Error ? error.message : 'Unable to load machine evidence.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [operator, currentEventId, requestedEventId, requestedNodeId]);

  useEffect(() => {
    if (!operator.loading) load(false);
  }, [operator.loading, load]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    const timer = setInterval(() => load(true), 30_000);
    return () => clearInterval(timer);
  }, [operator, load]);

  const selectedMachine = useMemo(
    () => INTERNAL_GRAPH_MACHINES.find((machine) => machine.id === machineId) ?? INTERNAL_GRAPH_MACHINES[0],
    [machineId],
  );

  const seedResults = useMemo(() => {
    if (!current) return [];
    const query = seedQuery.trim().toLowerCase();
    const rows = query
      ? current.nodes.filter((node) => node.label.toLowerCase().includes(query) || node.kind.toLowerCase().includes(query))
      : current.nodes.filter((node) => node.kind === 'person');
    return rows.slice(0, 18);
  }, [current, seedQuery]);

  const run = useMemo<InternalGraphMachineRun | null>(() => {
    if (!current || !selectedMachine) return null;
    if (!machineReady(selectedMachine, { seedNodeId, targetQuery, previous })) return null;
    try {
      return runInternalGraphMachine(selectedMachine.id, {
        current,
        previous,
        seedNodeId,
        targetQuery,
      });
    } catch {
      return null;
    }
  }, [current, previous, selectedMachine, seedNodeId, targetQuery]);

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          COMPOSING GRAPH MACHINES
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read') || !current) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="MACHINE LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · COMPOSABLE GRAPH MACHINES" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Machine Lab</NeonText>
              <NeonText variant="bodyMuted">
                Repeatable transform pipelines · structural impact · forensics · motifs · drift · target-path questions
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="MACHINE AUTONOMY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Machines re-run deterministic analysis when the authorized graph changes. They can compose transforms and produce questions, but cannot fetch external identity data, message users, create relationships, bypass blocks, or persist hypothetical results as evidence.
            </NeonText>
          </Surface>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
            {events.slice(0, 16).map((event) => (
              <Pressable
                key={event.eventId}
                onPress={() => setCurrentEventId(event.eventId)}
                style={[styles.eventChip, currentEventId === event.eventId && styles.eventChipActive]}
              >
                <NeonText variant="label" tone={currentEventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText>
                <NeonText variant="bodyMuted">{event.participantCount} people · {event.mutualCount} mutuals</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <GlowButton label="Ops" variant="ghost" onPress={() => navigation.navigate('InternalOperatorHub')} />
            <GlowButton label="Transform Lab" variant="ghost" onPress={() => navigation.navigate('InternalTransformLab', { eventId: currentEventId ?? undefined, nodeId: seedNodeId ?? undefined })} />
            <GlowButton label="Mission Ledger" variant="ghost" onPress={() => navigation.navigate('InternalMissionLedger', { eventId: currentEventId ?? undefined })} />
            <GlowButton label={refreshing ? 'Refreshing…' : 'Refresh now'} variant="ghost" disabled={refreshing} onPress={() => load(true)} />
          </View>

          <Section title="MACHINES" subtitle="Built-in deterministic playbooks; every step remains inspectable">
            <View style={styles.machineGrid}>
              {INTERNAL_GRAPH_MACHINES.map((machine) => (
                <Pressable
                  key={machine.id}
                  onPress={() => setMachineId(machine.id)}
                  style={[styles.machineButton, machine.id === selectedMachine.id && styles.machineButtonActive]}
                >
                  <NeonText variant="label" tone={machine.id === selectedMachine.id ? 'accent' : 'muted'}>{machine.title.toUpperCase()}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{machine.steps.length} steps</NeonText>
                </Pressable>
              ))}
            </View>
          </Section>

          <Surface elevated padded style={styles.machineCard}>
            <Pill label={selectedMachine.id.toUpperCase().replaceAll('-', ' ')} tone="accent" dot />
            <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selectedMachine.title}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 5, lineHeight: 19 }}>{selectedMachine.purpose}</NeonText>
            <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>
              LIVE GRAPH {current.graphVersion.slice(0, 18)} · {lastRefreshAt ? `REFRESHED ${new Date(lastRefreshAt).toLocaleTimeString()}` : 'CURRENT'}
            </NeonText>
          </Surface>

          {selectedMachine.requiresSeed ? (
            <Section title="SEED ENTITY" subtitle="Choose the graph node where this Machine begins">
              <TextInput
                value={seedQuery}
                onChangeText={setSeedQuery}
                placeholder="Search person, event, role, organization, project…"
                placeholderTextColor="#64748B"
                style={styles.input}
                autoCapitalize="none"
              />
              <View style={styles.seedGrid}>
                {seedResults.map((node) => (
                  <Pressable
                    key={node.id}
                    onPress={() => {
                      setSeedNodeId(node.id);
                      setSeedQuery('');
                    }}
                    style={[styles.seedButton, seedNodeId === node.id && styles.seedButtonActive]}
                  >
                    <NeonText variant="body">{node.label}</NeonText>
                    <NeonText variant="label" tone="muted">{node.kind.toUpperCase()}</NeonText>
                  </Pressable>
                ))}
              </View>
            </Section>
          ) : null}

          {selectedMachine.requiresTargetQuery ? (
            <Section title="TARGET ECOSYSTEM" subtitle="A query guides path analysis; it is not external enrichment">
              <TextInput
                value={targetQuery}
                onChangeText={setTargetQuery}
                placeholder="e.g. defense, fintech, university, climate…"
                placeholderTextColor="#64748B"
                style={styles.input}
                autoCapitalize="none"
              />
            </Section>
          ) : null}

          {selectedMachine.requiresPreviousGraph && !previous ? (
            <Surface padded style={styles.warningCard}>
              <Pill label="PREVIOUS GRAPH REQUIRED" tone="neutral" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                Select an event that has an earlier event in the retained event sequence to run this Machine.
              </NeonText>
            </Surface>
          ) : null}

          {run ? (
            <>
              <View style={styles.metricRow}>
                <Metric label="STEPS" value={`${run.trace.length}`} />
                <Metric label="NODES" value={`${run.finalNodeIds.length}`} />
                <Metric label="EDGES" value={`${run.finalEdgeIds.length}`} />
                <Metric label="QUESTIONS" value={`${run.questions.length}`} />
              </View>

              <Section title="MACHINE TRACE" subtitle="Every transform and structural inference remains inspectable">
                {run.trace.map((step, index) => (
                  <Surface key={step.stepId} padded style={styles.traceCard}>
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <NeonText variant="label" tone="accent">STEP {index + 1} · {step.kind.toUpperCase()}</NeonText>
                        <NeonText variant="h2" style={{ marginTop: 3 }}>{step.title}</NeonText>
                      </View>
                      <Pill label={`${step.outputNodeIds.length} NODES`} tone="neutral" />
                    </View>
                    <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>
                      input {step.inputNodeIds.length} · output {step.outputNodeIds.length} · edges {step.edgeIds.length}
                    </NeonText>
                    {Object.entries(step.metrics).slice(0, 8).map(([key, value]) => (
                      <NeonText key={`${step.stepId}-${key}`} variant="bodyMuted" style={{ marginTop: 2 }}>
                        {key.replaceAll('_', ' ')}: {typeof value === 'number' ? Number(value.toFixed(4)) : String(value)}
                      </NeonText>
                    ))}
                    {step.evidence.slice(0, 8).map((item, evidenceIndex) => (
                      <NeonText key={`${step.stepId}-e-${evidenceIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {item}</NeonText>
                    ))}
                  </Surface>
                ))}
              </Section>

              <Section title="MACHINE QUESTIONS" subtitle="Graphify-style question generation translated into operator investigation prompts">
                {run.questions.map((question, index) => (
                  <Surface key={`${run.machineId}-q-${index}`} padded style={styles.questionCard}>
                    <NeonText variant="body">{question}</NeonText>
                  </Surface>
                ))}
                {run.questions.length === 0 ? <NeonText variant="bodyMuted">No additional investigation question was triggered by this run.</NeonText> : null}
              </Section>

              <Surface padded style={styles.operatingCard}>
                <Pill label="OPERATING RULE" tone="neutral" dot />
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{run.operatingRule}</NeonText>
              </Surface>
            </>
          ) : (
            <Surface padded style={styles.warningCard}>
              <Pill label="MACHINE WAITING" tone="neutral" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                Complete the required seed / target / previous-event inputs. The Machine will run automatically and will re-run when the graph refreshes.
              </NeonText>
            </Surface>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.metric}>
      <NeonText variant="h2" tone="accent">{value}</NeonText>
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
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  eventRow: { gap: spacing.sm, paddingRight: spacing.lg },
  eventChip: { minWidth: 180, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.62)' },
  eventChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.88)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  machineGrid: { gap: spacing.sm },
  machineButton: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.62)' },
  machineButtonActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.88)' },
  machineCard: { borderRadius: radii.xl },
  input: { minHeight: 46, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, color: palette.text, paddingHorizontal: spacing.md, backgroundColor: 'rgba(15,23,42,0.72)' },
  seedGrid: { gap: spacing.xs },
  seedButton: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.58)' },
  seedButtonActive: { borderColor: palette.accent },
  warningCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 76, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.7)' },
  traceCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  questionCard: { borderRadius: radii.lg, borderColor: palette.accent },
  operatingCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
