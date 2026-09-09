import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { analyzeInternalGraphMotifs } from '../admin/InternalGraphMotifEngine';
import {
  analyzeInternalEpochTransition,
  type InternalGraphEpoch,
} from '../admin/InternalGraphEpochEngine';
import {
  loadInternalGraphEpochHistory,
  recordInternalGraphEpoch,
} from '../admin/internalGraphEpoch.service';
import {
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
} from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

export default function InternalEpochLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [epochs, setEpochs] = useState<InternalGraphEpoch[]>([]);
  const [selectedEpochId, setSelectedEpochId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkpointing, setCheckpointing] = useState(false);
  const checkpointedSessionEvents = useRef(new Set<string>());

  const loadHistory = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    const history = await loadInternalGraphEpochHistory(72);
    setEpochs(history.epochs);
    setSelectedEpochId((current) => current && history.epochs.some((epoch) => epoch.epochId === current)
      ? current
      : history.epochs[0]?.epochId ?? null);
  }, [operator]);

  const checkpointLatestFinalized = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    const sequence = await loadInternalGraphEventSequence(48);
    const target = sequence.events.find((event) => event.finalizedAt != null);
    if (!target || checkpointedSessionEvents.current.has(target.eventId)) return;

    setCheckpointing(true);
    try {
      const graph = await loadInternalIntelligenceGraph({
        eventId: target.eventId,
        includeRestricted: false,
        limit: 1800,
      });
      const analysis = analyzeInternalGraph(graph);
      const forensics = analyzeInternalGraphForensics(graph, analysis);
      const motifs = analyzeInternalGraphMotifs(graph, analysis);
      await recordInternalGraphEpoch({ eventId: target.eventId, analysis, forensics, motifs });
      checkpointedSessionEvents.current.add(target.eventId);
    } finally {
      setCheckpointing(false);
    }
  }, [operator]);

  const refresh = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      await checkpointLatestFinalized();
      await loadHistory();
    } catch (error) {
      Alert.alert('Epoch Lab unavailable', error instanceof Error ? error.message : 'Unable to load longitudinal graph memory.');
    } finally {
      setLoading(false);
    }
  }, [operator, checkpointLatestFinalized, loadHistory]);

  useEffect(() => {
    if (!operator.loading) refresh();
  }, [operator.loading, refresh]);

  const selectedIndex = selectedEpochId ? epochs.findIndex((epoch) => epoch.epochId === selectedEpochId) : -1;
  const current = selectedIndex >= 0 ? epochs[selectedIndex] : null;
  const previous = selectedIndex >= 0 ? epochs[selectedIndex + 1] ?? null : null;
  const transition = useMemo(
    () => current ? analyzeInternalEpochTransition(current, previous) : null,
    [current, previous],
  );

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          RECONSTRUCTING NETWORK LINEAGE
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="EPOCH LAB · SEALED" tone="neutral" dot />
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
              <Pill label="INTERNAL · LONGITUDINAL MEMORY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Epoch Lab</NeonText>
              <NeonText variant="bodyMuted">
                Durable community lineage · broker trajectories · motif evolution · structural dependence
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="ANALYTICAL MEMORY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Finalized event graphs checkpoint idempotently when an authorized operator inspects this lab. Person membership and broker history remain FK-bound to erasable aliases; account erasure removes those person references from longitudinal memory.
            </NeonText>
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label={checkpointing ? 'Checkpointing…' : 'Refresh epochs'} onPress={refresh} disabled={checkpointing} variant="ghost" />
            <GlowButton label="Strategy Lab" onPress={() => navigation.navigate('InternalStrategyLab')} variant="ghost" />
            <GlowButton label="Simulation Lab" onPress={() => navigation.navigate('InternalSimulationLab')} variant="ghost" />
          </View>

          {epochs.length === 0 ? (
            <Surface elevated padded style={styles.emptyCard}>
              <NeonText variant="h2">No durable epochs yet.</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                Finalize an event and revisit Epoch Lab with graph management capability to create the first structural checkpoint.
              </NeonText>
            </Surface>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.epochRow}>
                {epochs.slice(0, 24).map((epoch) => (
                  <Pressable
                    key={epoch.epochId}
                    onPress={() => setSelectedEpochId(epoch.epochId)}
                    style={[styles.epochChip, selectedEpochId === epoch.epochId && styles.epochChipActive]}
                  >
                    <NeonText variant="label" tone={selectedEpochId === epoch.epochId ? 'accent' : 'muted'}>
                      {epoch.eventName.toUpperCase()}
                    </NeonText>
                    <NeonText variant="bodyMuted">{epoch.nodeCount}N · {epoch.edgeCount}E · {epoch.communityCount}C</NeonText>
                  </Pressable>
                ))}
              </ScrollView>

              {current && transition ? (
                <>
                  <View style={styles.metricRow}>
                    <Metric label="COMMUNITIES" value={`${current.communityCount}`} />
                    <Metric label="ARTICULATION" value={`${current.articulationCount}`} />
                    <Metric label="CRITICAL EDGES" value={`${current.criticalBridgeCount}`} />
                    <Metric label="DEPENDENCE" value={`${Math.round(current.structuralDependence * 100)}%`} />
                  </View>

                  <Section title="EPOCH INTERPRETATION" subtitle={previous ? `${previous.eventName} → ${current.eventName}` : 'First retained structural epoch'}>
                    {transition.summary.map((line) => (
                      <Surface key={line} padded style={styles.smallCard}>
                        <NeonText variant="body">{line}</NeonText>
                      </Surface>
                    ))}
                  </Section>

                  <Section title="COMMUNITY LINEAGE" subtitle="Membership-overlap lineage over erasable person aliases">
                    {transition.communities.slice(0, 16).map((community) => (
                      <Surface key={`${community.currentEpochId}-${community.currentCommunityId}`} padded style={styles.smallCard}>
                        <View style={styles.rowBetween}>
                          <NeonText variant="h2">{community.currentLabel}</NeonText>
                          <Pill label={community.status.toUpperCase()} tone={community.status === 'converged' || community.status === 'new' ? 'accent' : 'neutral'} />
                        </View>
                        <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                          Prior: {community.previousLabels.join(', ') || 'none'} · shared {community.sharedMembers} · Jaccard {Math.round(community.jaccard * 100)}% · retained {Math.round(community.retainedRatio * 100)}%
                        </NeonText>
                      </Surface>
                    ))}
                  </Section>

                  <Section title="BROKER TRAJECTORIES" subtitle="Genuine brokerage movement, not simple popularity">
                    {transition.brokerTrajectories.slice(0, 16).map((broker) => (
                      <Surface key={broker.subjectAlias} padded style={styles.smallCard}>
                        <View style={styles.rowBetween}>
                          <NeonText variant="h2">Broker {broker.subjectAlias.slice(0, 8)}</NeonText>
                          <Pill label={broker.status.toUpperCase()} tone={broker.status === 'emerging' || broker.status === 'new' ? 'accent' : 'neutral'} />
                        </View>
                        <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                          Rank #{broker.currentRank}{broker.previousRank ? ` ← #${broker.previousRank}` : ''} · forensic {broker.forensicScore.toFixed(2)}{broker.scoreDelta != null ? ` · Δ ${broker.scoreDelta >= 0 ? '+' : ''}${broker.scoreDelta.toFixed(2)}` : ''}{broker.articulation ? ' · ARTICULATION' : ''}
                        </NeonText>
                      </Surface>
                    ))}
                  </Section>

                  <Section title="MOTIF EVOLUTION" subtitle="Higher-order structural patterns that are accelerating or fading">
                    {transition.motifTrajectories.slice(0, 14).map((motif) => (
                      <Surface key={motif.key} padded style={styles.smallCard}>
                        <View style={styles.rowBetween}>
                          <NeonText variant="h2">{motif.key.replaceAll('_', ' ')}</NeonText>
                          <Pill label={motif.status.toUpperCase()} tone={motif.status === 'emerging' || motif.status === 'accelerating' ? 'accent' : 'neutral'} />
                        </View>
                        <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                          count {motif.currentCount} ({motif.countDelta >= 0 ? '+' : ''}{motif.countDelta}) · strength {motif.currentStrength.toFixed(2)} ({motif.strengthDelta >= 0 ? '+' : ''}{motif.strengthDelta.toFixed(2)})
                        </NeonText>
                      </Surface>
                    ))}
                  </Section>

                  <Surface padded style={styles.retentionCard}>
                    <Pill label="BOUNDED STRUCTURAL MEMORY" tone="neutral" dot />
                    <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
                      Epochs expire on a bounded retention window. They preserve structural history needed for lineage and motif learning without storing contact data, raw movement trails, or permanent detached person dossiers.
                    </NeonText>
                  </Surface>
                </>
              ) : null}
            </>
          )}
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
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  epochRow: { gap: spacing.sm, paddingRight: spacing.lg },
  epochChip: { minWidth: 180, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.7)' },
  epochChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.92)' },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 82, minHeight: 74, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.74)' },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  retentionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  emptyCard: { borderRadius: radii.xl },
});
