import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  analyzeInternalDecisionRetrospectives,
  type InternalRetrospectiveSignature,
} from '../admin/InternalAnalyticalRetrospectiveEngine';
import { loadInternalDecisionRetrospectives } from '../admin/internalDecisionJournal.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Params = { InternalDecisionRetrospective: { eventId?: string } | undefined };

function toneFor(signature: InternalRetrospectiveSignature): 'accent' | 'neutral' {
  return signature.priority >= 7 && signature.maturity !== 'nascent' ? 'accent' : 'neutral';
}

export default function InternalDecisionRetrospectiveScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<Params, 'InternalDecisionRetrospective'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadInternalDecisionRetrospectives>>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      setRows(await loadInternalDecisionRetrospectives(eventId));
    } catch (error) {
      Alert.alert('Retrospective unavailable', error instanceof Error ? error.message : 'Unable to load bounded decision retrospectives.');
    } finally {
      setLoading(false);
    }
  }, [operator, eventId]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);
  const report = useMemo(() => analyzeInternalDecisionRetrospectives(rows), [rows]);

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>REPLAYING ANALYTICAL HISTORY</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="RETROSPECTIVE · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.11} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · ANALYTICAL RETROSPECTIVE" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Retrospective Lab</NeonText>
              <NeonText variant="bodyMuted">What decision-time conditions repeatedly co-occurred with later support, weakening, or invalidation? Shrinkage protects against low-sample stories.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metrics}>
            <Metric label="RESOLVED" value={`${report.resolvedCount}`} />
            <Metric label="WITH CONTEXT" value={`${report.withContextCount}`} />
            <Metric label="SIGNATURES" value={`${report.strongestAssociations.length}`} />
            <Metric label="DECISION CLASSES" value={`${report.byDecisionKind.length}`} />
          </View>

          <Surface padded style={styles.contract}>
            <Pill label="RETROSPECTIVE CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>{report.operatingRule}</NeonText>
          </Surface>

          <View style={styles.actions}>
            <GlowButton label="Decision Calibration" variant="ghost" onPress={() => navigation.navigate('InternalDecisionCalibration', { eventId: eventId ?? undefined })} />
            <GlowButton label="Method Journal" variant="ghost" onPress={() => navigation.navigate('InternalDecisionJournal', { eventId: eventId ?? undefined })} />
            <GlowButton label="Evidence Debt" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceDebt', { eventId: eventId ?? undefined })} />
          </View>

          <Section title="STRONGEST RECURRING CONDITIONS" subtitle="Priority combines shrinkage-adjusted adverse association with evidence maturity; it is not causal attribution">
            {report.strongestAssociations.map((signature) => (
              <Surface key={signature.key} elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={`${signature.maturity.toUpperCase()} · N=${signature.sampleSize}`} tone={toneFor(signature)} dot={toneFor(signature) === 'accent'} />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{signature.label}</NeonText>
                  </View>
                  <NeonText variant="mono" tone="accent">P{signature.priority.toFixed(1)}</NeonText>
                </View>
                <View style={styles.miniRow}>
                  <Mini label="ADVERSE POSTERIOR" value={`${Math.round(signature.posteriorAdverseAssociation * 100)}%`} />
                  <Mini label="CONSERVATIVE FLOOR" value={`${Math.round(signature.conservativeAdverseFloor * 100)}%`} />
                  <Mini label="INVALIDATED" value={`${signature.invalidatedCount}`} />
                  <Mini label="WEAKENED" value={`${signature.weakenedCount}`} />
                </View>
                {signature.reasons.map((reason, index) => <NeonText key={`${signature.key}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <GlowButton label="Open remediation surface" variant="ghost" onPress={() => navigation.navigate(signature.recommendedSurface, { eventId: eventId ?? undefined })} />
              </Surface>
            ))}
            {report.strongestAssociations.length === 0 ? <NeonText variant="bodyMuted">Not enough resolved retrospective context yet. Continue sealing falsifiable hypotheses; low-sample absence is preferable to fabricated insight.</NeonText> : null}
          </Section>

          <Section title="BY DECISION CLASS" subtitle="Review whether routing, intervention, analysis, restricted forensics, or export decisions fail in different ways">
            {report.byDecisionKind.map((bucket) => (
              <Surface key={bucket.decisionKind} padded style={styles.card}>
                <Pill label={bucket.decisionKind.replaceAll('_', ' ').toUpperCase()} tone="neutral" />
                <View style={styles.miniRow}>
                  <Mini label="RESOLVED" value={`${bucket.resolvedCount}`} />
                  <Mini label="SUPPORTED" value={`${bucket.supportedCount}`} />
                  <Mini label="WEAKENED" value={`${bucket.weakenedCount}`} />
                  <Mini label="INVALIDATED" value={`${bucket.invalidatedCount}`} />
                  <Mini label="AVG AUTHORITY" value={`${Math.round(bucket.averageCreatedAuthority * 100)}%`} />
                  <Mini label="HEALTH Δ" value={`${bucket.averageResolvedHealthDelta >= 0 ? '+' : ''}${Math.round(bucket.averageResolvedHealthDelta * 100)} pts`} />
                </View>
                {bucket.signatures.slice(0, 4).map((signature) => <NeonText key={`${bucket.decisionKind}-${signature.key}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {signature.label} · P{signature.priority.toFixed(1)} · n={signature.sampleSize}</NeonText>)}
              </Surface>
            ))}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted">{subtitle}</NeonText>{children}</View>;
}
function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></Surface>;
}
function Mini({ label, value }: Readonly<{ label: string; value: string }>) {
  return <View style={styles.mini}><NeonText variant="body">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 122, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  contract: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  bodyGap: { marginTop: spacing.sm, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  miniRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mini: { minWidth: 108, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.space },
});
