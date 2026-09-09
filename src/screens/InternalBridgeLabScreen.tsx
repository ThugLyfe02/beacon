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
  analyzeInternalGraph,
  type InternalBridgeCandidate,
  type InternalGraphPayload,
} from '../admin/InternalGraphEngine';
import {
  getInternalBridgeSuppressions,
  getInternalBridgeWatchSummary,
  loadInternalIntelligenceGraph,
  setInternalBridgeDisposition,
  watchInternalGraphBridge,
  type InternalBridgeWatch,
  type InternalBridgeWatchSummary,
} from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import {
  GlowButton,
  GridBackground,
  NeonText,
  Pill,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';

type BridgeLabRoute = {
  InternalBridgeLab: { eventId?: string } | undefined;
};

function canonicalPair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function nodeLabel(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function nodeUserId(payload: InternalGraphPayload, nodeId: string): string | null {
  const node = payload.nodes.find((candidate) => candidate.id === nodeId);
  const value = node?.attributes.subjectUserId;
  return typeof value === 'string' ? value : null;
}

function watchKey(source: string, target: string, via: string): string {
  return `${canonicalPair(source, target)}|${via}`;
}

function stageLabel(stage: InternalBridgeWatch['observedStage']): string {
  switch (stage) {
    case 'outcome_completed': return 'OUTCOME COMPLETED';
    case 'outcome_aligned': return 'OUTCOME ALIGNED';
    case 'office_hours': return 'OFFICE HOURS';
    case 'mutual': return 'MUTUAL';
    default: return 'NO DOWNSTREAM EVIDENCE YET';
  }
}

function stageTone(stage: InternalBridgeWatch['observedStage']): 'accent' | 'success' | 'neutral' {
  return stage === 'none' ? 'neutral' : stage === 'outcome_completed' ? 'success' : 'accent';
}

export default function InternalBridgeLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<BridgeLabRoute, 'InternalBridgeLab'>>();
  const eventId = route.params?.eventId ?? null;
  const operator = useInternalOperator();

  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [summary, setSummary] = useState<InternalBridgeWatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      // Suppression failure must fail this surface closed. Candidate bridges are
      // never shown unless the authoritative block-safety set loaded successfully.
      const [nextPayload, nextSuppressions, nextSummary] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1200 }),
        getInternalBridgeSuppressions(),
        getInternalBridgeWatchSummary(),
      ]);
      setPayload(nextPayload);
      setSuppressions(nextSuppressions);
      setSummary(nextSummary);
    } catch (error) {
      setSuppressions(null);
      Alert.alert(
        'Bridge Lab sealed',
        error instanceof Error ? error.message : 'Safety calibration could not be established.',
      );
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [operator, load]);

  const analysis = useMemo(() => payload ? analyzeInternalGraph(payload) : null, [payload]);
  const candidates = useMemo(() => {
    if (!analysis || !suppressions) return [];
    return analysis.bridgeCandidates.filter(
      (candidate) => !suppressions.has(canonicalPair(candidate.source, candidate.target)),
    );
  }, [analysis, suppressions]);

  const watchByCandidate = useMemo(() => {
    const map = new Map<string, InternalBridgeWatch>();
    for (const watch of summary?.watches ?? []) {
      map.set(watchKey(watch.sourceNodeId, watch.targetNodeId, watch.viaNodeId), watch);
    }
    return map;
  }, [summary]);

  const watchCandidate = async (candidate: InternalBridgeCandidate) => {
    if (!payload) return;
    const sourceUserId = nodeUserId(payload, candidate.source);
    const targetUserId = nodeUserId(payload, candidate.target);
    if (!sourceUserId || !targetUserId) return;
    const key = watchKey(candidate.source, candidate.target, candidate.via);
    setBusyKey(key);
    try {
      await watchInternalGraphBridge({
        sourceUserId,
        targetUserId,
        viaNodeId: candidate.via,
        eventId,
        score: candidate.score,
        rationale: candidate.why,
      });
      await load();
    } catch (error) {
      Alert.alert('Bridge watch rejected', error instanceof Error ? error.message : 'Unable to watch bridge.');
    } finally {
      setBusyKey(null);
    }
  };

  const changeDisposition = async (watch: InternalBridgeWatch, disposition: 'introduced' | 'dismissed') => {
    setBusyKey(watch.id);
    try {
      await setInternalBridgeDisposition(watch.id, disposition);
      await load();
    } catch (error) {
      Alert.alert('Bridge state rejected', error instanceof Error ? error.message : 'Unable to update bridge.');
    } finally {
      setBusyKey(null);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          CALIBRATING BRIDGE INTELLIGENCE
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_manage')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="BRIDGE LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Candidate introduction analysis is intentionally unavailable to read-only operators.
          </NeonText>
        </Surface>
      </View>
    );
  }

  if (!payload || !analysis || !suppressions || !summary) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="FAIL CLOSED" tone="danger" dot />
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Bridge recommendations remain hidden until graph evidence and block suppressions can both be verified.
          </NeonText>
          <GlowButton label="Retry safety calibration" onPress={load} fullWidth style={{ marginTop: spacing.md }} />
        </Surface>
      </View>
    );
  }

  const calibration = summary.calibration;
  const observedRate = calibration.total > 0 ? calibration.mutualOrBetter / calibration.total : 0;
  const outcomeRate = calibration.total > 0 ? calibration.outcomeAlignedOrBetter / calibration.total : 0;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.16} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label={eventId ? 'INTERNAL · EVENT BRIDGE LAB' : 'INTERNAL · GLOBAL BRIDGE LAB'} tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Bridge Lab</NeonText>
              <NeonText variant="bodyMuted">
                Structural-hole intelligence with block-safe suppression and evidence calibration.
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.telemetryRow}>
            <Metric label="WATCHED" value={`${calibration.total}`} />
            <Metric label="INTRODUCED" value={`${calibration.introduced}`} />
            <Metric label="MUTUAL+" value={`${Math.round(observedRate * 100)}%`} />
            <Metric label="OUTCOME+" value={`${Math.round(outcomeRate * 100)}%`} />
          </View>

          <Surface padded style={styles.attributionCard}>
            <Pill label="ATTRIBUTION FIREWALL" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              {summary.attributionNote}
            </NeonText>
          </Surface>

          <Section title="BRIDGE WATCHES" subtitle="Tracked candidates with monotonic downstream evidence stages">
            {(summary.watches.filter((watch) => watch.disposition !== 'dismissed').slice(0, 12)).map((watch) => (
              <Surface key={watch.id} padded style={styles.watchCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">
                      {nodeLabel(payload, watch.sourceNodeId)} ↔ {nodeLabel(payload, watch.targetNodeId)}
                    </NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                      via {nodeLabel(payload, watch.viaNodeId)} · score {watch.initialScore.toFixed(2)}
                    </NeonText>
                  </View>
                  <Pill label={stageLabel(watch.observedStage)} tone={stageTone(watch.observedStage)} />
                </View>
                <View style={styles.actionRow}>
                  {watch.disposition !== 'introduced' ? (
                    <GlowButton
                      label={busyKey === watch.id ? 'Updating…' : 'Mark introduced'}
                      onPress={() => changeDisposition(watch, 'introduced')}
                      disabled={busyKey != null}
                      variant="ghost"
                    />
                  ) : <Pill label="INTRODUCED" tone="accent" dot />}
                  <GlowButton
                    label="Dismiss"
                    onPress={() => changeDisposition(watch, 'dismissed')}
                    disabled={busyKey != null}
                    variant="ghost"
                  />
                </View>
              </Surface>
            ))}
            {summary.watches.filter((watch) => watch.disposition !== 'dismissed').length === 0 ? (
              <NeonText variant="bodyMuted">No bridge watches yet.</NeonText>
            ) : null}
          </Section>

          <Section title="SAFE STRUCTURAL HOLES" subtitle="No candidate is rendered until the block-suppression set is verified">
            {candidates.slice(0, 18).map((candidate, index) => {
              const key = watchKey(candidate.source, candidate.target, candidate.via);
              const watch = watchByCandidate.get(key);
              return (
                <Surface key={key} padded style={styles.candidateCard}>
                  <View style={styles.rank}>{index + 1}</View>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">
                      {nodeLabel(payload, candidate.source)} ↔ {nodeLabel(payload, candidate.target)}
                    </NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                      via {nodeLabel(payload, candidate.via)} · score {candidate.score.toFixed(2)}
                    </NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                      {candidate.why.join(' · ')}
                    </NeonText>
                    <View style={styles.actionRow}>
                      {watch ? (
                        <Pill label={watch.disposition === 'introduced' ? 'INTRODUCED' : 'WATCHING'} tone="accent" dot />
                      ) : (
                        <GlowButton
                          label={busyKey === key ? 'Watching…' : 'Watch bridge'}
                          onPress={() => watchCandidate(candidate)}
                          disabled={busyKey != null}
                          variant="ghost"
                        />
                      )}
                      <GlowButton
                        label="Inspect connector"
                        onPress={() => navigation.navigate('InternalGraph', { eventId: eventId ?? undefined })}
                        variant="ghost"
                      />
                    </View>
                  </View>
                </Surface>
              );
            })}
            {candidates.length === 0 ? (
              <NeonText variant="bodyMuted">
                No currently safe structural holes meet the graph criteria in this scope.
              </NeonText>
            ) : null}
          </Section>

          <Surface padded style={styles.retentionCard}>
            <Pill label="COMPOUNDING, NOT PERMANENT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Watches expire on bounded retention, disappear when either subject is erased, and are deleted if a later block makes the pair ineligible. Calibration learns from verified Beacon chronology rather than scraped enrichment.
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

function Section({
  title,
  subtitle,
  children,
}: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
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
  lockedCard: { width: '100%', maxWidth: 500, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 90, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  telemetryRow: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, minHeight: 74, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.74)' },
  attributionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  watchCard: { borderRadius: radii.lg, borderColor: 'rgba(56,189,248,0.22)' },
  candidateCard: { flexDirection: 'row', gap: spacing.md, borderRadius: radii.lg },
  rank: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft, borderWidth: 1, borderColor: palette.accent, color: palette.accent, fontWeight: '800' },
  rowBetween: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', justifyContent: 'space-between' },
  actionRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  retentionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
