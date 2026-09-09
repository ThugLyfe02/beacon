import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { analyzeInternalDecisionCalibration } from '../admin/InternalDecisionCalibrationEngine';
import { loadInternalDecisionJournal, type InternalDecisionJournalEntry } from '../admin/internalDecisionJournal.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

export default function InternalDecisionCalibrationScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [entries, setEntries] = useState<InternalDecisionJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const state = await loadInternalDecisionJournal(null);
      setEntries(state.entries);
    } catch (error) {
      Alert.alert('Decision Calibration unavailable', error instanceof Error ? error.message : 'Unable to load hypothesis memory.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const report = useMemo(() => analyzeInternalDecisionCalibration(entries), [entries]);

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>CALIBRATING ANALYTICAL METHOD</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="DECISION CALIBRATION · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · METHOD CALIBRATION" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Decision Calibration</NeonText>
              <NeonText variant="bodyMuted">Which classes of operator/Beacon judgment later survived falsifying evidence—and where did admission authority run ahead of reality?</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="CALIBRATION CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{report.operatingRule}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{report.methodology}</NeonText>
          </Surface>

          <View style={styles.metricRow}>
            <Metric label="RESOLVED" value={`${report.resolvedCount}`} />
            <Metric label="OPEN" value={`${report.openCount}`} />
            <Metric label="METHOD CLASSES" value={`${report.byDecisionKind.length}`} />
          </View>

          <View style={styles.actionRow}>
            <GlowButton label="Decision Journal" variant="ghost" onPress={() => navigation.navigate('InternalDecisionJournal')} />
            <GlowButton label="Operator Command" variant="ghost" onPress={() => navigation.navigate('InternalAdaptiveCommand')} />
          </View>

          {report.largestOverconfidence && report.largestOverconfidence.calibrationGap > 0.08 ? (
            <Surface elevated padded style={styles.warningCard}>
              <Pill label="OVERCONFIDENCE SIGNAL" tone="neutral" dot />
              <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{report.largestOverconfidence.label}</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Admission authority exceeded later evidence by {Math.round(report.largestOverconfidence.calibrationGap * 100)} points across n={report.largestOverconfidence.resolvedCount} resolved hypotheses.</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{report.largestOverconfidence.interpretation}</NeonText>
            </Surface>
          ) : null}

          <Section title="BY DECISION CLASS" subtitle="Low-sample outcomes shrink toward 50%; the conservative floor matters more than a lucky raw rate">
            {report.byDecisionKind.map((bucket) => <CalibrationCard key={bucket.key} bucket={bucket} />)}
          </Section>

          <Section title="BY ADMISSION STATE" subtitle="Tests whether admitted/caution/remediation states were appropriately calibrated against later evidence">
            {report.byAdmissionState.map((bucket) => <CalibrationCard key={bucket.key} bucket={bucket} />)}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function CalibrationCard({ bucket }: Readonly<{ bucket: ReturnType<typeof analyzeInternalDecisionCalibration>['byDecisionKind'][number] }>) {
  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Pill label={`${bucket.maturity.toUpperCase()} · N=${bucket.resolvedCount}`} tone={bucket.resolvedCount >= 8 ? 'accent' : 'neutral'} dot={bucket.resolvedCount >= 8} />
          <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{bucket.label}</NeonText>
        </View>
        <NeonText variant="mono" tone="accent">{Math.round(bucket.posteriorSupport * 100)}%</NeonText>
      </View>
      <View style={styles.metricRow}>
        <Metric label="POSTERIOR" value={`${Math.round(bucket.posteriorSupport * 100)}%`} />
        <Metric label="LOWER FLOOR" value={`${Math.round(bucket.conservativeSupportFloor * 100)}%`} />
        <Metric label="AVG AUTHORITY" value={`${Math.round(bucket.averageAdmissionAuthority * 100)}%`} />
        <Metric label="AUTH GAP" value={`${Math.round(bucket.calibrationGap * 100)}`} />
      </View>
      <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>supported {bucket.supportedCount} · weakened {bucket.weakenedCount} · invalidated {bucket.invalidatedCount}</NeonText>
      <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{bucket.interpretation}</NeonText>
    </Surface>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">{label}</NeonText><NeonText variant="h2" style={{ marginTop: 3 }}>{value}</NeonText></Surface>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 40 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, warningCard: { borderRadius: radii.xl, borderColor: '#F59E0B' }, metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { minWidth: 116, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline }, actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, section: { gap: spacing.sm }, card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
});
