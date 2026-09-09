import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  rankCounterfactualBridgeSimulations,
  rankInternalGraphResilienceRisks,
} from '../admin/InternalGraphSimulationEngine';
import {
  getInternalBridgeSuppressions,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';

type SimulationRoute = {
  InternalSimulationLab: { eventId?: string; nodeId?: string } | undefined;
};

function nodeLabel(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalSimulationLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<SimulationRoute, 'InternalSimulationLab'>>();
  const eventId = route.params?.eventId ?? null;
  const requestedNodeId = route.params?.nodeId ?? null;
  const operator = useInternalOperator();
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [nextPayload, nextSuppressions] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1400 }),
        operator.has('graph_manage') ? getInternalBridgeSuppressions() : Promise.resolve(new Set<string>()),
      ]);
      setPayload(nextPayload);
      setSuppressions(nextSuppressions);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Simulation Lab sealed', error instanceof Error ? error.message : 'Unable to establish safe simulation context.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const bridgeSimulations = useMemo(
    () => payload && suppressions && operator.has('graph_manage')
      ? rankCounterfactualBridgeSimulations(payload, suppressions, 14)
      : [],
    [payload, suppressions, operator],
  );
  const resilience = useMemo(
    () => payload ? rankInternalGraphResilienceRisks(payload, 24) : [],
    [payload],
  );
  const focusedRisk = useMemo(
    () => requestedNodeId ? resilience.find((risk) => risk.nodeId === requestedNodeId) ?? null : null,
    [requestedNodeId, resilience],
  );

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          RUNNING COUNTERFACTUAL TOPOLOGY
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface padded style={styles.lockedCard}>
          <Pill label="SIMULATION LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  if (!payload || !suppressions) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · COUNTERFACTUAL SANDBOX" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Simulation Lab</NeonText>
              <NeonText variant="bodyMuted">
                Model topology changes without writing hypothetical relationships into Beacon evidence.
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="COUNTERFACTUAL CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Simulations recompute graph structure in memory only. They do not predict consent, compatibility, outcomes or human importance, and they never create a relationship edge in the source graph.
            </NeonText>
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label="Strategy Lab" variant="ghost" onPress={() => navigation.navigate('InternalStrategyLab', { eventId: eventId ?? undefined })} />
            <GlowButton label="Constellation" variant="ghost" onPress={() => navigation.navigate('InternalGraph', { eventId: eventId ?? undefined })} />
            {requestedNodeId ? <GlowButton label="Transform focus" variant="ghost" onPress={() => navigation.navigate('InternalTransformLab', { eventId: eventId ?? undefined, nodeId: requestedNodeId })} /> : null}
          </View>

          {focusedRisk ? (
            <Surface elevated padded glow style={styles.focusCard}>
              <Pill label="FOCUSED RESILIENCE SCENARIO" tone="accent" dot />
              <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{nodeLabel(payload, focusedRisk.nodeId)}</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                Direct forensic deep-link · risk {focusedRisk.riskScore.toFixed(2)} · this models structural absence only.
              </NeonText>
              <View style={styles.metricRow}>
                <Metric label="COMPONENT +" value={`${Math.max(0, focusedRisk.componentIncrease)}`} />
                <Metric label="REACH LOSS" value={`${Math.round(focusedRisk.largestComponentLoss * 100)}%`} />
                <Metric label="EDGES" value={`${focusedRisk.removedEdgeCount}`} />
                <Metric label="BROKER" value={focusedRisk.brokerScore.toFixed(1)} />
              </View>
              {focusedRisk.interpretation.map((line, index) => (
                <NeonText key={`focus-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>
              ))}
            </Surface>
          ) : requestedNodeId ? (
            <Surface padded style={styles.focusCard}>
              <Pill label="FOCUSED NODE" tone="neutral" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                The requested node does not rank among the current top resilience risks in this graph scope.
              </NeonText>
            </Surface>
          ) : null}

          {operator.has('graph_manage') ? (
            <Section title="HYPOTHETICAL BRIDGE IMPACT" subtitle="Which safe structural holes would change topology most if a relationship eventually formed?">
              {bridgeSimulations.map((simulation, index) => (
                <Surface key={`${simulation.candidate.source}-${simulation.candidate.target}-${simulation.candidate.via}`} padded style={styles.simCard}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="label" tone="accent">#{index + 1} · IMPACT {simulation.impactScore.toFixed(2)}</NeonText>
                      <NeonText variant="h2" style={{ marginTop: 3 }}>
                        {nodeLabel(payload, simulation.candidate.source)} ↔ {nodeLabel(payload, simulation.candidate.target)}
                      </NeonText>
                      <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                        via {nodeLabel(payload, simulation.candidate.via)}
                      </NeonText>
                    </View>
                    <Pill label="WHAT IF" tone="neutral" />
                  </View>
                  <View style={styles.metricRow}>
                    <Metric label="COMPONENT Δ" value={`${simulation.componentDelta}`} />
                    <Metric label="COMMUNITY Δ" value={`${simulation.communityDelta}`} />
                    <Metric label="HOLE Δ" value={`${simulation.bridgeCandidateDelta}`} />
                    <Metric label="NEW BROKERS" value={`${simulation.newBrokerIds.length}`} />
                  </View>
                  {simulation.interpretation.map((line, lineIndex) => (
                    <NeonText key={`${simulation.candidate.source}-${lineIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>
                  ))}
                </Surface>
              ))}
              {bridgeSimulations.length === 0 ? (
                <NeonText variant="bodyMuted">No safe structural-hole simulation is available in this scope.</NeonText>
              ) : null}
            </Section>
          ) : null}

          <Section title="NETWORK RESILIENCE / SINGLE-POINT DEPENDENCE" subtitle="Topology brittleness if a hub or broker is absent; this is not a ranking of people">
            {resilience.slice(0, 16).map((risk, index) => (
              <Surface key={risk.nodeId} padded style={[styles.riskCard, requestedNodeId === risk.nodeId && styles.riskCardFocused]}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="label" tone="accent">#{index + 1} · RISK {risk.riskScore.toFixed(2)}</NeonText>
                    <NeonText variant="h2" style={{ marginTop: 3 }}>{nodeLabel(payload, risk.nodeId)}</NeonText>
                  </View>
                  <Pill label={risk.componentIncrease > 0 ? 'CUT POINT RISK' : 'CONCENTRATION'} tone={risk.componentIncrease > 0 ? 'danger' : 'neutral'} />
                </View>
                <View style={styles.metricRow}>
                  <Metric label="COMPONENT +" value={`${Math.max(0, risk.componentIncrease)}`} />
                  <Metric label="REACH LOSS" value={`${Math.round(risk.largestComponentLoss * 100)}%`} />
                  <Metric label="EDGES" value={`${risk.removedEdgeCount}`} />
                  <Metric label="BROKER" value={risk.brokerScore.toFixed(1)} />
                </View>
                {risk.interpretation.map((line, lineIndex) => (
                  <NeonText key={`${risk.nodeId}-${lineIndex}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>
                ))}
              </Surface>
            ))}
          </Section>
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
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  focusCard: { borderRadius: radii.xl, borderColor: palette.accent },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  simCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  riskCard: { borderRadius: radii.xl, borderColor: palette.hairline },
  riskCardFocused: { borderColor: palette.accent },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  metric: { flex: 1, minWidth: 78, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: 'rgba(15,23,42,0.68)' },
});
