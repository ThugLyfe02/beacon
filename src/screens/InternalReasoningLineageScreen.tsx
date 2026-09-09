import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { analyzeInternalReasoningLineage } from '../admin/InternalReasoningLineageEngine';
import {
  loadInternalDecisionEvidenceRefs,
  recordInternalDecisionEvidenceRefs,
} from '../admin/internalDecisionEvidenceRefs.service';
import { loadInternalDecisionJournal } from '../admin/internalDecisionJournal.service';
import { loadInternalEvidenceConflicts } from '../admin/internalEvidenceConflict.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type LineageRoute = { InternalReasoningLineage: { eventId?: string } | undefined };

function nodeLabel(graph: Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null, id: string): string {
  return graph?.nodes.find((node) => node.id === id)?.label ?? id;
}

function edgeLabel(graph: Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null, edgeId: string): string {
  const edge = graph?.edges.find((item) => item.id === edgeId);
  if (!edge) return edgeId;
  return `${nodeLabel(graph, edge.source)} → ${nodeLabel(graph, edge.target)} · ${edge.relation.replaceAll('_', ' ')} · ${edge.confidence}`;
}

export default function InternalReasoningLineageScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<LineageRoute, 'InternalReasoningLineage'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [graph, setGraph] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [journal, setJournal] = useState<Awaited<ReturnType<typeof loadInternalDecisionJournal>>['entries']>([]);
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof loadInternalDecisionEvidenceRefs>>>([]);
  const [conflicts, setConflicts] = useState<Awaited<ReturnType<typeof loadInternalEvidenceConflicts>>['conflicts']>([]);
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [payload, journalState, decisionRefs, conflictState] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 2000 }),
        loadInternalDecisionJournal(eventId),
        loadInternalDecisionEvidenceRefs({ eventId, openOnly: true, limit: 2400 }),
        loadInternalEvidenceConflicts({ eventId, includeClosed: false, limit: 400 }),
      ]);
      setGraph(payload);
      setJournal(journalState.entries);
      setRefs(decisionRefs);
      setConflicts(conflictState.conflicts);
    } catch (error) {
      Alert.alert('Reasoning Lineage unavailable', error instanceof Error ? error.message : 'Unable to assemble decision provenance.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const report = useMemo(
    () => graph ? analyzeInternalReasoningLineage({ graph, journal, refs, conflicts }) : null,
    [graph, journal, refs, conflicts],
  );
  const selectedDecision = report?.decisions.find((item) => item.journalId === selectedJournalId) ?? null;
  const selectedConflict = conflicts.find((item) => item.id === selectedConflictId) ?? null;
  const selectedJournal = journal.find((item) => item.id === selectedJournalId) ?? null;
  const canBind = Boolean(
    graph
    && selectedJournal
    && selectedConflict
    && selectedJournal.status === 'open'
    && selectedJournal.graphVersion === graph.graphVersion,
  );

  const bind = async (which: 'left' | 'right' | 'both') => {
    if (!graph || !selectedJournal || !selectedConflict || !canBind) {
      Alert.alert('Dependency cannot be recorded', 'Select an open hypothesis and conflict from the same current canonical graph version. Beacon will not bind stale evidence by guesswork.');
      return;
    }
    const edgeIds = which === 'both'
      ? [selectedConflict.leftEdgeId, selectedConflict.rightEdgeId]
      : [which === 'left' ? selectedConflict.leftEdgeId : selectedConflict.rightEdgeId];
    setSaving(true);
    try {
      const count = await recordInternalDecisionEvidenceRefs({
        journalId: selectedJournal.id,
        graphVersion: graph.graphVersion,
        edgeIds,
        refKind: 'manual_review',
      });
      Alert.alert('Dependency recorded', `${count} new exact evidence reference${count === 1 ? '' : 's'} attached. No graph evidence or hypothesis outcome changed.`);
      await load();
    } catch (error) {
      Alert.alert('Dependency not recorded', error instanceof Error ? error.message : 'Unable to attach exact evidence refs.');
    } finally {
      setSaving(false);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>ASSEMBLING REASONING LINEAGE</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage') || !graph || !report) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="REASONING LINEAGE · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · ANALYTICAL PROVENANCE" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Reasoning Lineage</NeonText>
              <NeonText variant="bodyMuted">Hypothesis → exact evidence refs → conflict intersection → targeted revalidation. Dependencies are recorded, never inferred.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metrics}>
            <Metric label="OPEN DECISIONS" value={`${report.openDecisionCount}`} />
            <Metric label="BOUND" value={`${report.boundDecisionCount}`} />
            <Metric label="CONFLICTED" value={`${report.conflictedDecisionCount}`} />
            <Metric label="ORPHANED" value={`${report.orphanedDecisionCount}`} />
            <Metric label="UNBOUND" value={`${report.unboundDecisionCount}`} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="LINEAGE CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{report.operatingRule}</NeonText>
          </Surface>

          <Section title="CONFLICT BLAST RADIUS" subtitle="Only hypotheses with explicit evidence refs can appear here. Unbound legacy hypotheses are never guessed into impact.">
            {report.conflictBlastRadius.map((item) => (
              <Pressable key={item.conflictId} onPress={() => setSelectedConflictId(item.conflictId)}>
                <Surface elevated padded style={[styles.card, selectedConflictId === item.conflictId && styles.selected]}>
                  <View style={styles.rowBetween}><Pill label={`P${item.reviewPriority} · ${item.impactedCount} IMPACTED`} tone={item.impactedCount > 0 ? 'accent' : 'neutral'} dot={item.impactedCount > 0} /><NeonText variant="mono" tone="muted">{item.conflictId.slice(0, 8)}…</NeonText></View>
                  <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{edgeLabel(graph, item.edgeIds[0])}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{edgeLabel(graph, item.edgeIds[1])}</NeonText>
                  {item.impactedDecisionKinds.length > 0 ? <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>{item.impactedDecisionKinds.map((kind) => kind.replaceAll('_', ' ')).join(' · ')}</NeonText> : null}
                </Surface>
              </Pressable>
            ))}
            {report.conflictBlastRadius.length === 0 ? <NeonText variant="bodyMuted">No open conflicts in this scope.</NeonText> : null}
          </Section>

          <Section title="DECISION DEPENDENCY LEDGER" subtitle="Conflicted/orphaned/unbound hypotheses sort first so revalidation work is visible before clean lineage.">
            {report.decisions.map((decision) => (
              <Pressable key={decision.journalId} onPress={() => setSelectedJournalId(decision.journalId)}>
                <Surface elevated padded style={[styles.card, selectedJournalId === decision.journalId && styles.selected, decision.dependencyState === 'conflicted' || decision.dependencyState === 'orphaned' ? styles.warning : null]}>
                  <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={`${decision.dependencyState.toUpperCase()} · ${decision.decisionKind.replaceAll('_', ' ').toUpperCase()}`} tone={decision.dependencyState === 'bound' ? 'neutral' : 'accent'} dot={decision.dependencyState !== 'bound'} /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{decision.title}</NeonText></View><NeonText variant="mono" tone="accent">{decision.refCount} REF</NeonText></View>
                  {decision.reasons.map((reason, index) => <NeonText key={`${decision.journalId}-reason-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                  {decision.relationFamilies.length > 0 ? <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>{decision.relationFamilies.join(' · ')}</NeonText> : null}
                  {decision.edgeIds.slice(0, 8).map((edgeId) => <NeonText key={`${decision.journalId}-${edgeId}`} variant="bodyMuted" style={{ marginTop: 2 }}>↳ {edgeLabel(graph, edgeId)}</NeonText>)}
                </Surface>
              </Pressable>
            ))}
          </Section>

          {selectedDecision && selectedConflict ? (
            <Section title="EXPLICIT LEGACY BINDING" subtitle="Use only when you can affirm the selected conflict edge was actually part of this hypothesis's evidence. No automatic inference.">
              <Surface padded style={styles.card}>
                <Pill label={canBind ? 'CURRENT GRAPH VERSION · BINDABLE' : 'STALE/INCOMPATIBLE · BLOCKED'} tone={canBind ? 'accent' : 'neutral'} dot={canBind} />
                <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{selectedDecision.title}</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>decision graph {selectedDecision.graphVersion.slice(0, 20)}… · current {graph.graphVersion.slice(0, 20)}…</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>LEFT · {edgeLabel(graph, selectedConflict.leftEdgeId)}</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>RIGHT · {edgeLabel(graph, selectedConflict.rightEdgeId)}</NeonText>
                <View style={styles.actions}>
                  <GlowButton label="Bind left edge" variant="ghost" disabled={!canBind || saving} onPress={() => void bind('left')} />
                  <GlowButton label="Bind right edge" variant="ghost" disabled={!canBind || saving} onPress={() => void bind('right')} />
                  <GlowButton label="Bind both exact edges" variant="ghost" disabled={!canBind || saving} onPress={() => void bind('both')} />
                </View>
              </Surface>
            </Section>
          ) : null}

          <View style={styles.actions}>
            <GlowButton label="Conflict Review" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceConflicts', { eventId: eventId ?? undefined })} />
            <GlowButton label="Assumption Staleness" variant="ghost" onPress={() => navigation.navigate('InternalAssumptionStaleness', { eventId: eventId ?? undefined })} />
            <GlowButton label="Decision Journal" variant="ghost" onPress={() => navigation.navigate('InternalDecisionJournal', { eventId: eventId ?? undefined })} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></Surface>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 112, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  selected: { borderColor: palette.accent },
  warning: { borderColor: '#F59E0B' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
