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
  { route: 'InternalAdaptiveCommand', title: 'Operator Command', code: 'COMMAND', description: 'Adaptive command layer combining bounded attention, next-best analysis, Watchtower triage, evidence debt, calibrated decision admission, temporal coherence, diversified routing and health-calibrated agents.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalDecisionJournal', title: 'Decision Journal', code: 'HYPOTHESIS', description: 'Falsifiable operator hypotheses sealed against calibrated evidence authority, then resolved as supported, weakened or invalidated to improve future method calibration.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalDecisionCalibration', title: 'Decision Calibration', code: 'METHOD', description: 'Shrinkage-aware memory of where analytical admission authority historically aligned with—or ran ahead of—later disconfirming evidence.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalCollaborativeCaseMemory', title: 'Collaborative Case Memory', code: 'SHARED MEMORY', description: 'Durable Casebook chronology for assignment, verification checkpoints, falsifiable questions, decision notes, timeline findings and handoff continuity—canonical-version and evidence-digest bound.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalHandoffLab', title: 'Handoff Lab', code: 'HANDOFF', description: 'Bounded operator-to-operator investigation capsules carrying case, canonical graph version, Perspective, evidence digest and a falsifiable next question without duplicating graph payloads.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalAgenticTimeline', title: 'Agentic Timeline', code: 'TIMELINE', description: 'Evidence chronology, observation episodes, relationship ladders, chronology gaps and route temporal-coherence boundaries without causal inference.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalPerspectiveLab', title: 'Lens Workbench', code: 'PERSPECTIVE', description: 'Reproducible task-specific graph views with evidence floors, recency, repetition, context focus and agent Scene Director recommendations.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalPatternQueryLab', title: 'Pattern Grammar', code: 'PATTERN', description: 'Bloom-style bounded structural graph search with proactive schema-derived suggestions and no arbitrary Cypher or enrichment.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalEvidenceDebt', title: 'Evidence Debt', code: 'VERIFY', description: 'Self-healing verification queue that ranks ambiguous, stale, one-shot, weak-context and route-bottleneck uncertainty by expected analytical-authority gain.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalOntologyObservatory', title: 'Ontology Observatory', code: 'META-GRAPH', description: 'Data-model self-awareness: entity kinds, relation signatures, confidence/repetition coverage, schema entropy and event-to-event ontology drift.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalPrivateAccess', title: 'Private Access', code: 'ACCESS', description: 'Standing privileges, active JIT restricted/export leases, server truth and immediate self-revocation with no client self-elevation path.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalWatchtower', title: 'Watchtower', code: 'WATCH', description: 'Event-driven monitoring of canonical topology, motifs, broker emergence and private Machine result changes.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalTargetRouting', title: 'Target Routing', code: 'ROUTE', description: 'Diverse block-safe routes into target ecosystems with confidence floors, provenance, bottleneck risk, route redundancy and temporal-coherence review.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalGraphHealth', title: 'Evidence Health', code: 'HEALTH', description: 'Epistemic quality of the canonical graph: verified/ambiguous mix, freshness, repetition, weak contexts and canonicalization hygiene.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalGraph', title: 'Constellation', code: 'GRAPH', description: '3D evidence graph, communities, explainable paths, structural holes, surprising edges and Bridge Builder.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalForensicsLab', title: 'Forensics Lab', code: 'FORENSICS', description: 'Articulation points, graph bridges, effective size, participation coefficient and unexpected-edge surprisal.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalTransformLab', title: 'Transform Lab', code: 'PIVOT', description: 'Maltego-style first-party transforms, reverse pivots, provenance timelines and bounded multi-hop expansion.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalEntityResolutionLab', title: 'Entity Resolution Lab', code: 'CANONICALIZE', description: 'Operator-approved non-person duplicate resolution so organizations, domains, projects, topics, venues and roles stop fragmenting graph truth.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalMachineLab', title: 'Machine Lab', code: 'MACHINES', description: 'Composable deterministic playbooks combining transforms, blast-radius traversal, forensics, motifs, drift and target-path analysis.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalMachineRegistry', title: 'Machine Registry', code: 'RECIPES', description: 'Private ordered Machine pipelines, deterministic replay and digest-only run manifests for graph-version comparison.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalStrategyLab', title: 'Strategy Lab', code: 'ORCHESTRATE', description: 'Event drift, target-ecosystem pathfinder, intervention frontier and analysis-agent mission queue.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalMissionLedger', title: 'Mission Ledger', code: 'MEMORY', description: 'Persistent agent memory that distinguishes new, persistent, revised, reopened and resolved strategic conditions.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalSimulationLab', title: 'Simulation Lab', code: 'WHAT IF', description: 'Non-persistent hypothetical bridge and node-removal scenarios for topology leverage and resilience.', capability: 'graph_read', accent: 'neutral' },
  { route: 'InternalEpochLab', title: 'Epoch Lab', code: 'LINEAGE', description: 'Durable finalized-event checkpoints, community lineage, broker trajectories and motif evolution.', capability: 'graph_read', accent: 'accent' },
  { route: 'InternalCasebook', title: 'Casebook', code: 'CASES', description: 'Saved investigations with erasable graph pins, target ecosystems and agent-refreshable internal findings.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalBridgeLab', title: 'Bridge Lab', code: 'INTERVENE', description: 'Block-safe structural-hole watches, introduction marking and downstream evidence calibration.', capability: 'graph_manage', accent: 'accent' },
  { route: 'InternalPatternLab', title: 'Pattern Lab', code: 'CALIBRATE', description: 'Empirical-Bayes bridge archetypes with shrinkage, conservative evidence floors and anti-overfitting safeguards.', capability: 'graph_manage', accent: 'accent' },
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
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>This control surface cannot be enabled by client state and is absent from normal Beacon accounts.</NeonText>
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
              <Pill label="INTERNAL · OPERATOR CONTROL DECK · ADAPTIVE OS" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Constellation Ops</NeonText>
              <NeonText variant="bodyMuted">Adaptive command · calibrated decision memory · collaborative Casebook memory · temporal coherence · Perspectives · pattern grammar · evidence debt · ontology drift · Watchtower · routing · forensic pivots · Machines · longitudinal memory</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.capabilityCard}>
            <Pill label="CAPABILITY ENVELOPE · SERVER VERIFIED" tone="neutral" dot />
            <View style={styles.capabilityRow}>{operator.capabilities.map((capability) => <Pill key={capability} label={capability.replaceAll('_', ' ').toUpperCase()} tone="accent" />)}</View>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{operator.expiresAt ? `Access expires ${new Date(operator.expiresAt).toLocaleString()}.` : 'Access has no configured expiry.'}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{operator.leastPrivilegeRule}</NeonText>
            <View style={styles.capabilityMatrix}>
              <Pill label={`READ ${operator.read ? 'YES' : 'NO'}`} tone={operator.read ? 'accent' : 'neutral'} />
              <Pill label={`MANAGE ${operator.manage ? 'YES' : 'NO'}`} tone={operator.manage ? 'accent' : 'neutral'} />
              <Pill label={`RESTRICTED ${operator.restricted ? 'YES' : 'NO'}`} tone={operator.restricted ? 'accent' : 'neutral'} />
              <Pill label={`EXPORT ${operator.export ? 'YES' : 'NO'}`} tone={operator.export ? 'accent' : 'neutral'} />
            </View>
            {operator.activeLeases.length > 0 ? <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{operator.activeLeases.length} temporary sensitive-capability lease{operator.activeLeases.length === 1 ? '' : 's'} active.</NeonText> : null}
          </Surface>

          <View style={styles.grid}>
            {availableLabs.map((lab) => (
              <Pressable key={lab.route} onPress={() => navigation.navigate(lab.route)} style={styles.labPressable}>
                <Surface elevated padded style={styles.labCard}>
                  <Pill label={lab.code} tone={lab.accent} dot={lab.accent === 'accent'} />
                  <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{lab.title}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 5, lineHeight: 19 }}>{lab.description}</NeonText>
                  <View style={styles.cardFooter}><NeonText variant="label" tone="muted">REQUIRES {lab.capability.toUpperCase()}</NeonText><NeonText variant="label" tone="accent">OPEN →</NeonText></View>
                </Surface>
              </Pressable>
            ))}
          </View>

          {operator.has('graph_restricted') ? <Surface padded style={styles.restrictedCard}><Pill label="RESTRICTED FORENSICS AVAILABLE" tone="accent" dot /><NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>Your exact server capability permits safety topology where a specific lab exposes it. Block suppression still governs bridge/routing eligibility even when restricted edges are visually hidden.</NeonText></Surface> : null}
          {operator.has('graph_export') ? <Surface padded style={styles.exportCard}><Pill label="EXPORT CAPABILITY ACTIVE" tone="neutral" dot /><NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>Sanitized GraphML and deterministic Neo4j Cypher artifacts require this independent capability. Graph management alone cannot export.</NeonText></Surface> : null}

          <Surface padded style={styles.autonomyCard}>
            <Pill label="AUTONOMY BOUNDARY" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>Constellation may detect, diff, route, recommend analytical Perspectives and structural pattern queries, rank graph-level evidence debt, observe ontology/schema drift, test temporal coherence, assess evidence health, checkpoint canonical topology, maintain bounded collaborative Casebook memory, monitor structural conditions, reconcile mission memory, replay private recipes, and calibrate its analytical method. Current evidence always sets the authority ceiling; calibration and timeline history may only reduce authority. None of these systems may message attendees, manufacture relationships, bypass blocks, or execute social interventions without explicit human approval.</NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 40 }, capabilityCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, capabilityRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, capabilityMatrix: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, grid: { gap: spacing.sm }, labPressable: { width: '100%' }, labCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, cardFooter: { marginTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, restrictedCard: { borderRadius: radii.xl, borderColor: palette.accent }, exportCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, autonomyCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});