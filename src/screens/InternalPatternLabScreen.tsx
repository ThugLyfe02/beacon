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
import { calibrateInternalBridgePatterns } from '../admin/InternalGraphCalibrationEngine';
import { loadInternalBridgePatternCalibration } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function InternalPatternLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [attributionNote, setAttributionNote] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const result = await loadInternalBridgePatternCalibration();
      setPatterns(result.patterns);
      setAttributionNote(result.attributionNote);
    } catch (error) {
      Alert.alert('Pattern Lab unavailable', error instanceof Error ? error.message : 'Unable to load bridge calibration.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const model = useMemo(() => calibrateInternalBridgePatterns(patterns), [patterns]);

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          SHRINKING NOISY HISTORY TOWARD EVIDENCE
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_manage')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="PATTERN LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText>
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
              <Pill label="INTERNAL · BAYESIAN BRIDGE MEMORY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Pattern Lab</NeonText>
              <NeonText variant="bodyMuted">
                Historical bridge archetypes · empirical-Bayes shrinkage · conservative evidence floors
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <GlowButton label="Refresh model" onPress={load} variant="ghost" />
            <GlowButton label="Bridge Lab" onPress={() => navigation.navigate('InternalBridgeLab')} variant="ghost" />
            <GlowButton label="Epoch Lab" onPress={() => navigation.navigate('InternalEpochLab')} variant="ghost" />
            <GlowButton label="Casebook" onPress={() => navigation.navigate('InternalCasebook')} variant="ghost" />
          </View>

          <View style={styles.metricRow}>
            <Metric label="ARCHETYPES" value={`${model.patterns.length}`} />
            <Metric label="OUTCOME PRIOR" value={pct(model.priorOutcomeMean)} />
            <Metric label="COMPLETE PRIOR" value={pct(model.priorCompletedMean)} />
            <Metric label="PRIOR WEIGHT" value={`${model.priorStrength}`} />
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="ANTI-OVERFITTING CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Raw bridge rates are never treated as learned truth at low sample size. Every archetype is shrunk toward the pooled Beacon prior, and ranking uses a conservative posterior lower bound rather than a lucky point estimate.
            </NeonText>
          </Surface>

          <Section title="BRIDGE ARCHETYPE POSTERIORS" subtitle="Which connector patterns historically preceded meaningful first-party evidence, with uncertainty intact">
            {model.patterns.map((pattern, index) => (
              <Surface key={pattern.connectorKind} elevated padded style={styles.patternCard}>
                <View style={styles.rowBetween}>
                  <View style={styles.rank}>
                    <NeonText variant="label" tone="accent">{index + 1}</NeonText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{pattern.connectorKind.replaceAll('_', ' ')}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                      n={pattern.sampleSize} · maturity {pct(pattern.evidenceMaturity)} · conservative value {pattern.conservativeValueScore.toFixed(3)}
                    </NeonText>
                  </View>
                  <Pill label={pattern.sampleSize >= 15 ? 'MATURING' : pattern.sampleSize >= 5 ? 'DEVELOPING' : 'SPARSE'} tone={pattern.sampleSize >= 15 ? 'accent' : 'neutral'} />
                </View>

                <View style={styles.rateGrid}>
                  <Rate label="RAW OUTCOME" value={pct(pattern.observedOutcomeRate)} />
                  <Rate label="POSTERIOR" value={pct(pattern.posteriorOutcomeMean)} />
                  <Rate label="90% FLOOR" value={pct(pattern.outcomeLowerBound90)} />
                  <Rate label="COMPLETE FLOOR" value={pct(pattern.completedLowerBound90)} />
                </View>

                {pattern.interpretation.map((line) => (
                  <NeonText key={line} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>
                ))}
              </Surface>
            ))}
            {model.patterns.length === 0 ? (
              <NeonText variant="bodyMuted">No bridge-watch history is mature enough to calibrate yet.</NeonText>
            ) : null}
          </Section>

          <Surface padded style={styles.caveatCard}>
            <Pill label="ATTRIBUTION FIREWALL" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              {attributionNote || model.caveat} Posterior ranking improves uncertainty handling; it does not turn observational chronology into a causal estimate of operator impact.
            </NeonText>
          </Surface>
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

function Rate({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.rate}>
      <NeonText variant="h2">{value}</NeonText>
      <NeonText variant="label" tone="muted">{label}</NeonText>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View>
        <NeonText variant="label" tone="accent">{title}</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#040711' },
  centered: { flex: 1, backgroundColor: '#040711', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 84, minHeight: 74, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.74)' },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  caveatCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  patternCard: { borderRadius: radii.xl },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.9)' },
  rateGrid: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rate: { flex: 1, minWidth: 90, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, alignItems: 'center' },
});
