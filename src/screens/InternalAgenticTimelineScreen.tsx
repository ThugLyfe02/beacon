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
  buildInternalAgenticTimeline,
  type InternalRelationProgression,
  type InternalTimelineEpisode,
} from '../admin/InternalAgenticTimelineEngine';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type TimelineRoute = {
  InternalAgenticTimeline: { eventId?: string } | undefined;
};

function nodeLabel(payload: Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function formatWindow(start: string, end: string): string {
  const left = new Date(start).toLocaleDateString();
  const right = new Date(end).toLocaleDateString();
  return left === right ? left : `${left} → ${right}`;
}

function EpisodeCard({ episode }: Readonly<{ episode: InternalTimelineEpisode }>) {
  return (
    <Surface padded style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Pill label="EVIDENCE EPISODE" tone="neutral" dot />
          <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{formatWindow(episode.startedAt, episode.endedAt)}</NeonText>
        </View>
        <NeonText variant="mono" tone="accent">{Math.round(episode.verifiedRatio * 100)}%</NeonText>
      </View>
      <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
        {episode.eventCount} observations · {episode.relationCount} relation families · verified share {Math.round(episode.verifiedRatio * 100)}%
      </NeonText>
      <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>
        {episode.relationFamilies.slice(0, 8).map((item) => item.replaceAll('_', ' ')).join(' · ')}
      </NeonText>
    </Surface>
  );
}

function ProgressionCard({
  progression,
  payload,
}: Readonly<{
  progression: InternalRelationProgression;
  payload: Awaited<ReturnType<typeof loadInternalIntelligenceGraph>>;
}>) {
  return (
    <Surface elevated padded style={[styles.card, progression.chronologyGap ? styles.warningBorder : null]}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Pill label={progression.chronologyGap ? 'CHRONOLOGY GAP' : 'RELATIONSHIP LADDER'} tone={progression.chronologyGap ? 'accent' : 'neutral'} dot />
          <NeonText variant="h2" style={{ marginTop: spacing.sm }}>
            {nodeLabel(payload, progression.leftNodeId)} ↔ {nodeLabel(payload, progression.rightNodeId)}
          </NeonText>
        </View>
        <NeonText variant="mono" tone="accent">{progression.observedStages.length} STAGES</NeonText>
      </View>
      {progression.observedStages.map((stage) => (
        <View key={stage.edgeId} style={styles.stageRow}>
          <NeonText variant="label" tone="accent">S{stage.stage}</NeonText>
          <View style={{ flex: 1 }}>
            <NeonText variant="body">{stage.relation.replaceAll('_', ' ')}</NeonText>
            <NeonText variant="bodyMuted">first observed {new Date(stage.firstSeenAt).toLocaleString()} · {stage.confidence}</NeonText>
          </View>
        </View>
      ))}
      {progression.gapReasons.map((reason, index) => (
        <NeonText key={`${progression.pairKey}-gap-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>
      ))}
    </Surface>
  );
}

export default function InternalAgenticTimelineScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<TimelineRoute, 'InternalAgenticTimeline'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      setPayload(await loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1800 }));
    } catch (error) {
      Alert.alert('Timeline unavailable', error instanceof Error ? error.message : 'Unable to build evidence chronology.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const timeline = useMemo(() => payload ? buildInternalAgenticTimeline(payload) : null, [payload]);

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>ASSEMBLING EVIDENCE TIMELINE</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_read')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="AGENTIC TIMELINE · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }
  if (!payload || !timeline) return null;

  const chronologyGaps = timeline.progressions.filter((item) => item.chronologyGap);

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · AGENTIC EVIDENCE TIMELINE" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Timeline</NeonText>
              <NeonText variant="bodyMuted">Observation chronology · evidence episodes · relationship ladders · chronology gaps · temporal-coherence boundary</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <View style={styles.metricRow}>
            <Metric label="OBSERVATIONS" value={`${timeline.events.length}`} />
            <Metric label="EPISODES" value={`${timeline.episodes.length}`} />
            <Metric label="LADDERS" value={`${timeline.progressions.length}`} />
            <Metric label="CHRONOLOGY GAPS" value={`${timeline.chronologyGapCount}`} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="TEMPORAL TRUTH CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{timeline.operatingRule}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>A structural path can remain valid while being temporally incoherent for point-in-time interpretation. Sequence never becomes causation.</NeonText>
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label="Target Routing" variant="ghost" onPress={() => navigation.navigate('InternalTargetRouting', { eventId: eventId ?? undefined })} />
            <GlowButton label="Decision Journal" variant="ghost" onPress={() => navigation.navigate('InternalDecisionJournal', { eventId: eventId ?? undefined })} />
            <GlowButton label="Evidence Debt" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceDebt', { eventId: eventId ?? undefined })} />
            <GlowButton label="Epoch Lab" variant="ghost" onPress={() => navigation.navigate('InternalEpochLab', { eventId: eventId ?? undefined })} />
          </View>

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">EVIDENCE EPISODES</NeonText>
            <NeonText variant="bodyMuted">Seven-day observation gaps separate episodes so long-running history does not collapse into one misleading “now.”</NeonText>
            {timeline.episodes.slice(-12).reverse().map((episode) => <EpisodeCard key={episode.id} episode={episode} />)}
          </View>

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">RELATIONSHIP PROGRESSION / CHRONOLOGY</NeonText>
            <NeonText variant="bodyMuted">Signal → mutual → Office Hours → aligned outcome → completed outcome, using retained first-observed evidence only.</NeonText>
            {timeline.progressions.slice(0, 30).map((progression) => (
              <ProgressionCard key={progression.pairKey} progression={progression} payload={payload} />
            ))}
            {timeline.progressions.length === 0 ? <NeonText variant="bodyMuted">No multi-stage first-party relationship ladders are present in this scope.</NeonText> : null}
          </View>

          {chronologyGaps.length > 0 ? (
            <Surface elevated padded style={[styles.ruleCard, styles.warningBorder]}>
              <Pill label="OBSERVATION-ORDER DEBT" tone="accent" dot />
              <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{chronologyGaps.length} progression{chronologyGaps.length === 1 ? '' : 's'} need temporal caution.</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>These are gaps in Beacon's retained observation order, not claims that real-world chronology was impossible.</NeonText>
            </Surface>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">{label}</NeonText><NeonText variant="h2" style={{ marginTop: 3 }}>{value}</NeonText></Surface>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 40 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 132, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  warningBorder: { borderColor: '#F59E0B' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  stageRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.sm },
});