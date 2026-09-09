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
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { analyzeInternalGraph } from '../admin/InternalGraphEngine';
import { analyzeInternalGraphForensics } from '../admin/InternalGraphForensicsEngine';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

export default function InternalForensicsLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      setGraph(await loadInternalIntelligenceGraph({ includeRestricted: false, limit: 1800 }));
    } catch (error) {
      Alert.alert('Forensics Lab unavailable', error instanceof Error ? error.message : 'Unable to load forensic graph evidence.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const analysis = useMemo(() => graph ? analyzeInternalGraph(graph) : null, [graph]);
  const forensics = useMemo(() => graph && analysis ? analyzeInternalGraphForensics(graph, analysis) : null, [graph, analysis]);
  const nodeLabel = (nodeId: string) => graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>RUNNING STRUCTURAL FORENSICS</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read') || !graph || !forensics) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="FORENSICS LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.14} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · STRUCTURAL FORENSICS" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Forensics Lab</NeonText>
              <NeonText variant="bodyMuted">Genuine brokerage · articulation dependence · graph bridges · degree-baseline edge surprisal</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <GlowButton label="Refresh" onPress={load} variant="ghost" />
            <GlowButton label="Constellation" onPress={() => navigation.navigate('InternalGraph')} variant="ghost" />
            <GlowButton label="Simulation Lab" onPress={() => navigation.navigate('InternalSimulationLab')} variant="ghost" />
            <GlowButton label="Casebook" onPress={() => navigation.navigate('InternalCasebook')} variant="ghost" />
          </View>

          <View style={styles.metricRow}>
            <Metric label="ARTICULATION" value={`${forensics.articulationNodeIds.length}`} />
            <Metric label="GRAPH BRIDGES" value={`${forensics.bridgeEdgeIds.length}`} />
            <Metric label="DEPENDENCE" value={`${Math.round(forensics.structuralDependence * 100)}%`} />
            <Metric label="CRITICAL EDGES" value={`${forensics.criticalBridges.length}`} />
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="FORENSIC SEMANTICS" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              These scores describe structural position in Beacon's explainable graph. They are not rankings of human worth, trustworthiness, compatibility, or influence outside the observed network.
            </NeonText>
          </Surface>

          <Section title="GENUINE BROKERS" subtitle="Cross-community participation + low redundancy + articulation structure, not raw degree">
            {forensics.brokers.slice(0, 24).map((broker, index) => (
              <Surface key={broker.nodeId} elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={styles.rank}>{index + 1}</View>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{nodeLabel(broker.nodeId)}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                      forensic {broker.forensicScore.toFixed(2)} · participation {Math.round(broker.participationCoefficient * 100)}% · effective size {broker.effectiveSize.toFixed(1)} · redundancy {Math.round(broker.redundancyRatio * 100)}%
                    </NeonText>
                  </View>
                  {broker.articulation ? <Pill label="ARTICULATION" tone="accent" /> : null}
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                  {broker.reasons.join(' · ') || 'Cross-community brokerage evidence remains limited.'}
                </NeonText>
                <View style={styles.actionRow}>
                  <GlowButton label="Transform" onPress={() => navigation.navigate('InternalTransformLab', { nodeId: broker.nodeId })} variant="ghost" />
                  <GlowButton label="Simulate removal" onPress={() => navigation.navigate('InternalSimulationLab', { nodeId: broker.nodeId })} variant="ghost" />
                </View>
              </Surface>
            ))}
          </Section>

          <Section title="CRITICAL / UNEXPECTED EDGES" subtitle="Graph-theoretic bridges and edges surprising under a degree-preserving baseline">
            {forensics.criticalBridges.slice(0, 28).map((edge) => (
              <Surface key={edge.edgeId} padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{nodeLabel(edge.source)} ↔ {nodeLabel(edge.target)}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                      {edge.relation.replaceAll('_', ' ')} · surprisal {edge.edgeSurprisal.toFixed(2)} bits
                    </NeonText>
                  </View>
                  {edge.disconnectsGraph ? <Pill label="GRAPH BRIDGE" tone="accent" /> : <Pill label="UNEXPECTED" tone="neutral" />}
                </View>
                {edge.reasons.map((reason) => <NeonText key={reason} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
              </Surface>
            ))}
          </Section>

          <Surface padded style={styles.summaryCard}>
            <Pill label="STRUCTURAL READ" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{forensics.summary}</NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <View style={styles.metric}><NeonText variant="h1" tone="accent" glow>{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>;
}
function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={{ gap: spacing.sm }}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#040711' },
  centered: { flex: 1, backgroundColor: '#040711', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 84, minHeight: 74, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.74)' },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  summaryCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  card: { borderRadius: radii.xl },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.9)' },
});
