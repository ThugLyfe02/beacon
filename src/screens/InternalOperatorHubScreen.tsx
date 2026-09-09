import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

interface LabDefinition {
  route: string;
  title: string;
  code: string;
  description: string;
  capability: 'graph_read' | 'graph_manage' | 'graph_restricted' | 'graph_export';
  accent: 'accent' | 'neutral';
}

const LABS: LabDefinition[] = [
  {
    route: 'InternalGraph',
    title: 'Constellation',
    code: 'GRAPH',
    description: '3D evidence graph, communities, explainable paths, structural holes, surprising edges and Bridge Builder.',
    capability: 'graph_read',
    accent: 'accent',
  },
  {
    route: 'InternalForensicsLab',
    title: 'Forensics Lab',
    code: 'FORENSICS',
    description: 'Articulation points, graph bridges, effective size, participation coefficient and unexpected-edge surprisal.',
    capability: 'graph_read',
    accent: 'accent',
  },
  {
    route: 'InternalTransformLab',
    title: 'Transform Lab',
    code: 'PIVOT',
    description: 'Maltego-style first-party transforms, reverse pivots, provenance timelines and bounded multi-hop expansion.',
    capability: 'graph_read',
    accent: 'accent',
  },
  {
    route: 'InternalStrategyLab',
    title: 'Strategy Lab',
    code: 'ORCHESTRATE',
    description: 'Event drift, target-ecosystem pathfinder, intervention frontier and analysis-agent mission queue.',
    capability: 'graph_read',
    accent: 'accent',
  },
  {
    route: 'InternalSimulationLab',
    title: 'Simulation Lab',
    code: 'WHAT IF',
    description: 'Non-persistent hypothetical bridge and node-removal scenarios for topology leverage and resilience.',
    capability: 'graph_read',
    accent: 'neutral',
  },
  {
    route: 'InternalEpochLab',
    title: 'Epoch Lab',
    code: 'LINEAGE',
    description: 'Durable finalized-event checkpoints, community lineage, broker trajectories and motif evolution.',
    capability: 'graph_read',
    accent: 'accent',
  },
  {
    route: 'InternalCasebook',
    title: 'Casebook',
    code: 'CASES',
    description: 'Saved investigations with erasable graph pins, target ecosystems and agent-refreshable internal findings.',
    capability: 'graph_manage',
    accent: 'accent',
  },
  {
    route: 'InternalBridgeLab',
    title: 'Bridge Lab',
    code: 'INTERVENE',
    description: 'Block-safe structural-hole watches, introduction marking and downstream evidence calibration.',
    capability: 'graph_manage',
    accent: 'accent',
  },
  {
    route: 'InternalPatternLab',
    title: 'Pattern Lab',
    code: 'CALIBRATE',
    description: 'Empirical-Bayes bridge archetypes with shrinkage, conservative evidence floors and anti-overfitting safeguards.',
    capability: 'graph_manage',
    accent: 'accent',
  },
];

export default function InternalOperatorHubScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="CONSTELLATION OPS · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator capability required.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            This control surface cannot be enabled by client state and is absent from normal Beacon accounts.
          </NeonText>
        </Surface>
      </View>
    );
  }

  const availableLabs = LABS.filter((lab) => operator.has(lab.capability));

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · OPERATOR CONTROL DECK" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Constellation Ops</NeonText>
              <NeonText variant="bodyMuted">
                Evidence graph · forensic pivots · longitudinal memory · calibrated strategy · human-approved intervention
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.capabilityCard}>
            <Pill label="CAPABILITY ENVELOPE" tone="neutral" dot />
            <View style={styles.capabilityRow}>
              {operator.context.capabilities.map((capability) => (
                <Pill key={capability} label={capability.replaceAll('_', ' ').toUpperCase()} tone="accent" />
              ))}
            </View>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
              {operator.context.expiresAt
                ? `Access expires ${new Date(operator.context.expiresAt).toLocaleString()}.`
                : 'No client-side privilege escalation path exists; every lab rechecks its required capability server-side.'}
            </NeonText>
          </Surface>

          <View style={styles.grid}>
            {availableLabs.map((lab) => (
              <Pressable key={lab.route} onPress={() => navigation.navigate(lab.route)} style={styles.labPressable}>
                <Surface elevated padded style={styles.labCard}>
                  <Pill label={lab.code} tone={lab.accent} dot={lab.accent === 'accent'} />
                  <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{lab.title}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 5, lineHeight: 19 }}>{lab.description}</NeonText>
                  <View style={styles.cardFooter}>
                    <NeonText variant="label" tone="muted">REQUIRES {lab.capability.toUpperCase()}</NeonText>
                    <NeonText variant="label" tone="accent">OPEN →</NeonText>
                  </View>
                </Surface>
              </Pressable>
            ))}
          </View>

          {operator.has('graph_restricted') ? (
            <Surface padded style={styles.restrictedCard}>
              <Pill label="RESTRICTED FORENSICS AVAILABLE" tone="accent" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
                Your capability envelope permits safety topology where a specific lab exposes it. Block suppression still governs bridge eligibility even when restricted edges are visually hidden.
              </NeonText>
            </Surface>
          ) : null}

          {operator.has('graph_export') ? (
            <Surface padded style={styles.exportCard}>
              <Pill label="EXPORT CAPABILITY ACTIVE" tone="neutral" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
                Strategy Lab can generate sanitized GraphML and deterministic Neo4j Cypher artifacts. Export remains a separate privilege from graph management.
              </NeonText>
            </Surface>
          ) : null}

          <Surface padded style={styles.autonomyCard}>
            <Pill label="AUTONOMY BOUNDARY" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Constellation agents may analyze, diff, checkpoint finalized topology and refresh internal findings. They cannot message attendees, manufacture relationships, bypass blocks, or execute social interventions without explicit human approval.
            </NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  capabilityCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  capabilityRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grid: { gap: spacing.sm },
  labPressable: { width: '100%' },
  labCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  cardFooter: { marginTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  restrictedCard: { borderRadius: radii.xl, borderColor: palette.accent },
  exportCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  autonomyCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
