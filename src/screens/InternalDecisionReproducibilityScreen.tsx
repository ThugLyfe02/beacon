import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  compareInternalDecisionReproducibilityReceipt,
  loadInternalDecisionReproducibilityReceipts,
  sealInternalDecisionReproducibilityReceipt,
  type InternalDecisionReproducibilityComparison,
  type InternalDecisionReproducibilityReceipt,
} from '../admin/internalDecisionReproducibility.service';
import {
  loadInternalDecisionJournal,
  loadInternalDecisionRetrospectives,
  type InternalDecisionJournalEntry,
  type InternalDecisionRetrospectiveRow,
} from '../admin/internalDecisionJournal.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type ReceiptRoute = { InternalDecisionReproducibility: { eventId?: string } | undefined };
const POLICY_VERSION = 'operator-decision-admission-v3';

export default function InternalDecisionReproducibilityScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<ReceiptRoute, 'InternalDecisionReproducibility'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [graphVersion, setGraphVersion] = useState<string | null>(null);
  const [journal, setJournal] = useState<InternalDecisionJournalEntry[]>([]);
  const [retrospectives, setRetrospectives] = useState<InternalDecisionRetrospectiveRow[]>([]);
  const [receipts, setReceipts] = useState<InternalDecisionReproducibilityReceipt[]>([]);
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<InternalDecisionReproducibilityComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [graph, journalState, history, receiptRows] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 2000 }),
        loadInternalDecisionJournal(eventId),
        loadInternalDecisionRetrospectives(eventId),
        loadInternalDecisionReproducibilityReceipts(eventId),
      ]);
      setGraphVersion(graph.graphVersion);
      setJournal(journalState.entries);
      setRetrospectives(history);
      setReceipts(receiptRows);
    } catch (error) {
      Alert.alert('Decision Reproducibility unavailable', error instanceof Error ? error.message : 'Unable to assemble reproducibility state.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);

  const selectedJournal = journal.find((entry) => entry.id === selectedJournalId) ?? null;
  const baseline = useMemo(
    () => selectedJournalId ? retrospectives.find((row) => row.journalId === selectedJournalId) ?? null : null,
    [retrospectives, selectedJournalId],
  );
  const selectedReceipt = receipts.find((receipt) => receipt.id === selectedReceiptId) ?? null;
  const receiptCountByJournal = useMemo(() => {
    const map = new Map<string, number>();
    for (const receipt of receipts) map.set(receipt.journalId, (map.get(receipt.journalId) ?? 0) + 1);
    return map;
  }, [receipts]);
  const canSeal = Boolean(selectedJournal && graphVersion && selectedJournal.graphVersion === graphVersion);

  const seal = async () => {
    if (!selectedJournal || !graphVersion || !canSeal) {
      Alert.alert('Receipt cannot be sealed', 'The hypothesis must still match the current canonical graph version. Reproducibility cannot be manufactured after the evidence envelope changed.');
      return;
    }
    setSaving(true);
    try {
      const receipt = await sealInternalDecisionReproducibilityReceipt({
        journalId: selectedJournal.id,
        graphVersion,
        policyVersion: POLICY_VERSION,
        calibrationPenalty: baseline?.createdCalibrationPenalty ?? 0,
        temporalOverlap: baseline?.createdTemporalOverlap ?? null,
        routeDiversity: baseline?.createdRouteDiversity ?? null,
        routeCount: baseline?.createdRouteCount ?? 0,
      });
      Alert.alert('Reproducibility receipt sealed', `${receipt.evidenceRefCount} exact evidence ref${receipt.evidenceRefCount === 1 ? '' : 's'} hashed into receipt ${receipt.receiptDigest.slice(0, 12)}….`);
      await load();
    } catch (error) {
      Alert.alert('Receipt not sealed', error instanceof Error ? error.message : 'Unable to seal analytical receipt.');
    } finally {
      setSaving(false);
    }
  };

  const compare = async (receipt: InternalDecisionReproducibilityReceipt) => {
    setSelectedReceiptId(receipt.id);
    setComparison(null);
    try {
      setComparison(await compareInternalDecisionReproducibilityReceipt(receipt.id));
    } catch (error) {
      Alert.alert('Comparison unavailable', error instanceof Error ? error.message : 'Unable to compare receipt.');
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>VERIFYING ANALYTICAL ENVELOPES</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage') || !graphVersion) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="DECISION REPRODUCIBILITY · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · REPRODUCIBLE ANALYTICAL ENVELOPES" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Decision Reproducibility</NeonText>
              <NeonText variant="bodyMuted">Seal a server receipt for canonical graph version + exact evidence refs + bounded policy context, then test whether that same evidence envelope still exists later.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="REPRODUCIBILITY ≠ TRUTH" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>A matching receipt means the canonical graph version and exact dependency set remain present with no open confirmed conflict intersection. It does not certify the hypothesis, relationship, person, or organization as true/correct.</NeonText>
          </Surface>

          <Section title="HYPOTHESES" subtitle={`Current canonical graph ${graphVersion.slice(0, 20)}… · receipt sealing is blocked once a hypothesis graph version becomes stale`}>
            {journal.map((entry) => (
              <Pressable key={entry.id} onPress={() => setSelectedJournalId(entry.id)}>
                <Surface elevated padded style={[styles.card, selectedJournalId === entry.id && styles.selected, entry.graphVersion !== graphVersion ? styles.warning : null]}>
                  <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={`${entry.status.toUpperCase()} · ${entry.decisionKind.replaceAll('_', ' ').toUpperCase()}`} tone={entry.graphVersion === graphVersion ? 'neutral' : 'accent'} /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{entry.title}</NeonText></View><NeonText variant="mono" tone="muted">{receiptCountByJournal.get(entry.id) ?? 0} RCT</NeonText></View>
                  <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>graph {entry.graphVersion.slice(0, 20)}… · admission A{Math.round(entry.admissionAuthority * 100)}</NeonText>
                </Surface>
              </Pressable>
            ))}
          </Section>

          {selectedJournal ? (
            <Surface elevated padded style={styles.selectedCard}>
              <Pill label={canSeal ? 'CURRENT ENVELOPE · SEALABLE' : 'GRAPH VERSION CHANGED · SEAL BLOCKED'} tone={canSeal ? 'accent' : 'neutral'} dot={canSeal} />
              <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{selectedJournal.title}</NeonText>
              <View style={styles.metrics}>
                <Metric label="AUTHORITY" value={`${Math.round(selectedJournal.admissionAuthority * 100)}%`} />
                <Metric label="CAL PENALTY" value={`${Math.round((baseline?.createdCalibrationPenalty ?? 0) * 100)}%`} />
                <Metric label="TEMPORAL" value={baseline?.createdTemporalOverlap == null ? 'N/A' : `${Math.round(baseline.createdTemporalOverlap * 100)}%`} />
                <Metric label="ROUTE DIVERSITY" value={baseline?.createdRouteDiversity == null ? 'N/A' : `${Math.round(baseline.createdRouteDiversity * 100)}%`} />
              </View>
              <GlowButton label={saving ? 'Sealing…' : 'Seal server reproducibility receipt'} disabled={!canSeal || saving} onPress={() => void seal()} />
            </Surface>
          ) : null}

          <Section title="RECEIPT LEDGER" subtitle={`${receipts.length} bounded receipt${receipts.length === 1 ? '' : 's'} · content is hashes/counts/policy context, not graph payload`}>
            {receipts.map((receipt) => (
              <Pressable key={receipt.id} onPress={() => void compare(receipt)}>
                <Surface elevated padded style={[styles.card, selectedReceiptId === receipt.id && styles.selected]}>
                  <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={`${receipt.policyVersion} · ${receipt.evidenceRefCount} REF`} tone="neutral" /><NeonText variant="h2" style={{ marginTop: spacing.sm }}>{journal.find((entry) => entry.id === receipt.journalId)?.title ?? `Hypothesis ${receipt.journalId.slice(0, 8)}…`}</NeonText></View><NeonText variant="mono" tone="accent">{receipt.receiptDigest.slice(0, 10)}…</NeonText></View>
                  <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>sealed {new Date(receipt.createdAt).toLocaleString()} · graph {receipt.graphVersion.slice(0, 16)}…</NeonText>
                </Surface>
              </Pressable>
            ))}
          </Section>

          {selectedReceipt && comparison ? (
            <Surface elevated padded style={[styles.compareCard, comparison.reproducibleNow ? styles.ok : styles.warning]}>
              <Pill label={comparison.reproducibleNow ? 'REPRODUCIBLE NOW' : 'ENVELOPE CHANGED · REVIEW'} tone={comparison.reproducibleNow ? 'accent' : 'neutral'} dot />
              <View style={styles.metrics}>
                <Metric label="SAME GRAPH" value={comparison.sameGraphVersion ? 'YES' : 'NO'} />
                <Metric label="SAME REFS" value={comparison.sameEvidenceRefDigest ? 'YES' : 'NO'} />
                <Metric label="LIVE REFS" value={`${comparison.liveRefCount}/${comparison.currentRefCount}`} />
                <Metric label="ORPHANED" value={`${comparison.orphanedRefCount}`} />
                <Metric label="CONFLICTS" value={`${comparison.openConflictCount}`} />
              </View>
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{comparison.operatingRule}</NeonText>
              <View style={styles.actions}>
                <GlowButton label="Reasoning Lineage" variant="ghost" onPress={() => navigation.navigate('InternalReasoningLineage', { eventId: selectedReceipt.eventId ?? eventId ?? undefined })} />
                <GlowButton label="Revalidation Queue" variant="ghost" onPress={() => navigation.navigate('InternalReasoningRevalidation', { eventId: selectedReceipt.eventId ?? eventId ?? undefined })} />
              </View>
            </Surface>
          ) : null}
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
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  selectedCard: { borderRadius: radii.xl, borderColor: palette.accent },
  selected: { borderColor: palette.accent },
  warning: { borderColor: '#F59E0B' },
  ok: { borderColor: palette.accent },
  compareCard: { borderRadius: radii.xl },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metric: { minWidth: 112, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
