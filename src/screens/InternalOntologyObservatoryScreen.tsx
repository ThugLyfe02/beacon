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
import { analyzeInternalOntologyObservatory } from '../admin/InternalOntologyObservatoryEngine';
import {
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type ObservatoryRoute = {
  InternalOntologyObservatory: { eventId?: string } | undefined;
};

function eventTime(event: InternalGraphEventSummary): number {
  const candidate = event.finalizedAt ?? event.endsAt ?? event.startsAt;
  const parsed = candidate ? Date.parse(candidate) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function signatureLabel(key: string): string {
  const [source, relation, target] = key.split('|');
  return `${source ?? '?'} → ${(relation ?? '?').replaceAll('_', ' ')} → ${target ?? '?'}`;
}

export default function InternalOntologyObservatoryScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<ObservatoryRoute, 'InternalOntologyObservatory'>>();
  const operator = useInternalOperator();
  const requestedEventId = route.params?.eventId ?? null;
  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(requestedEventId);
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [previous, setPrevious] = useState<Awaited<ReturnType<typeof loadInternalIntelligenceGraph>> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const sequence = await loadInternalGraphEventSequence(60);
      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedId = currentEventId ?? requestedEventId ?? ordered[0]?.eventId ?? null;
      setEvents(ordered);
      setCurrentEventId(selectedId);
      if (!selectedId) {
        setCurrent(await loadInternalIntelligenceGraph({ includeRestricted: false, limit: 1800 }));
        setPrevious(null);
        return;
      }
      const currentIndex = ordered.findIndex((event) => event.eventId === selectedId);
      const previousId = currentIndex >= 0 ? ordered[currentIndex + 1]?.eventId ?? null : null;
      const [nextCurrent, nextPrevious] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId: selectedId, includeRestricted: false, limit: 1800 }),
        previousId ? loadInternalIntelligenceGraph({ eventId: previousId, includeRestricted: false, limit: 1800 }) : Promise.resolve(null),
      ]);
      setCurrent(nextCurrent);
      setPrevious(nextPrevious);
    } catch (error) {
      Alert.alert('Ontology Observatory unavailable', error instanceof Error ? error.message : 'Unable to inspect graph schema evolution.');
    } finally {
      setLoading(false);
    }
  }, [operator, currentEventId, requestedEventId]);

  useEffect(() => {
    if (!operator.loading) void load();
  }, [operator.loading, load]);

  const report = useMemo(
    () => current ? analyzeInternalOntologyObservatory({ current, previous }) : null,
    [current, previous],
  );

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>MAPPING GRAPH LANGUAGE</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_read')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.lockedCard}><Pill label="ONTOLOGY OBSERVATORY · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText></Surface></View>;
  }
  if (!current || !report) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · META-GRAPH / DATA MODEL" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Ontology Observatory</NeonText>
              <NeonText variant="bodyMuted">Inspect the language Constellation is learning: entity kinds, relation signatures, confidence coverage, repeated evidence, schema drift and blind spots.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
            {events.slice(0, 18).map((event) => (
              <Pressable key={event.eventId} onPress={() => setCurrentEventId(event.eventId)} style={[styles.eventChip, currentEventId === event.eventId && styles.eventChipActive]}>
                <NeonText variant="label" tone={currentEventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText>
                <NeonText variant="bodyMuted">{event.participantCount} people · {event.mutualCount} mutuals</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.metricRow}>
            <Metric label="NODE KINDS" value={`${report.nodeKinds.length}`} />
            <Metric label="RELATION SIGNATURES" value={`${report.relationSignatures.length}`} />
            <Metric label="KIND ENTROPY" value={`${Math.round(report.nodeKindEntropy * 100)}%`} />
            <Metric label="RELATION ENTROPY" value={`${Math.round(report.relationEntropy * 100)}%`} />
            <Metric label="BLIND SPOTS" value={`${report.blindSpots.length}`} />
          </View>

          <Surface padded style={styles.ruleCard}>
            <Pill label="SCHEMA TRUTH BOUNDARY" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>{report.operatingRule}</NeonText>
          </Surface>

          <View style={styles.actionRow}>
            <GlowButton label="Lens Workbench" variant="ghost" onPress={() => navigation.navigate('InternalPerspectiveLab', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Pattern Grammar" variant="ghost" onPress={() => navigation.navigate('InternalPatternQueryLab', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Evidence Debt" variant="ghost" onPress={() => navigation.navigate('InternalEvidenceDebt', { eventId: currentEventId ?? undefined })} />
            {operator.has('graph_manage') ? <GlowButton label="Entity Resolution" variant="ghost" onPress={() => navigation.navigate('InternalEntityResolutionLab', { eventId: currentEventId ?? undefined })} /> : null}
          </View>

          {report.drift ? (
            <View style={styles.section}>
              <NeonText variant="label" tone="accent">ONTOLOGY DRIFT</NeonText>
              <View style={styles.metricRow}>
                <Metric label="STABILITY" value={`${Math.round(report.drift.schemaStability * 100)}%`} />
                <Metric label="NOVELTY" value={`${Math.round(report.drift.schemaNovelty * 100)}%`} />
                <Metric label="NEW SIGNATURES" value={`${report.drift.newRelationSignatures.length}`} />
                <Metric label="RETIRED" value={`${report.drift.retiredRelationSignatures.length}`} />
              </View>
              {report.drift.newNodeKinds.length > 0 ? <Surface padded style={styles.smallCard}><NeonText variant="label" tone="accent">NEW ENTITY KINDS</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{report.drift.newNodeKinds.join(' · ')}</NeonText></Surface> : null}
              {report.drift.newRelationSignatures.slice(0, 12).map((key) => <Surface key={`new-${key}`} padded style={styles.smallCard}><Pill label="NEW GRAPH GRAMMAR" tone="accent" dot /><NeonText variant="h2" style={{ marginTop: 4 }}>{signatureLabel(key)}</NeonText></Surface>)}
              {report.drift.retiredRelationSignatures.slice(0, 8).map((key) => <Surface key={`retired-${key}`} padded style={styles.smallCard}><Pill label="NO LONGER PRESENT" tone="neutral" /><NeonText variant="h2" style={{ marginTop: 4 }}>{signatureLabel(key)}</NeonText></Surface>)}
            </View>
          ) : null}

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">ENTITY-KIND COVERAGE</NeonText>
            {report.nodeKinds.map((kind) => (
              <Surface key={kind.kind} padded style={styles.smallCard}>
                <View style={styles.rowBetween}>
                  <NeonText variant="h2">{kind.kind}</NeonText>
                  <Pill label={`${kind.count} · ${Math.round(kind.share * 100)}%`} tone="neutral" />
                </View>
                <NeonText variant="bodyMuted">average degree {kind.averageDegree.toFixed(2)}</NeonText>
              </Surface>
            ))}
          </View>

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">RELATION SIGNATURES</NeonText>
            <NeonText variant="bodyMuted">Source kind → relation → target kind, with evidence quality rather than just raw frequency.</NeonText>
            {report.relationSignatures.slice(0, 30).map((signature) => (
              <Surface key={signature.key} padded style={styles.signatureCard}>
                <View style={styles.rowBetween}>
                  <NeonText variant="h2" style={{ flex: 1 }}>{signatureLabel(signature.key)}</NeonText>
                  <Pill label={`${signature.count} EDGES`} tone="neutral" />
                </View>
                <NeonText variant="bodyMuted">{Math.round(signature.verifiedRatio * 100)}% verified · {Math.round(signature.repeatedEvidenceRatio * 100)}% repeated · {Math.round(signature.freshRatio * 100)}% recent · avg evidence ×{signature.averageEvidenceCount.toFixed(1)}</NeonText>
              </Surface>
            ))}
          </View>

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">SCHEMA BLIND SPOTS</NeonText>
            <NeonText variant="bodyMuted">High-volume relation families with weak verification, repetition or freshness are data-model debt—not evidence about the entities themselves.</NeonText>
            {report.blindSpots.map((spot) => (
              <Surface key={spot.key} elevated padded style={styles.blindCard}>
                <View style={styles.rowBetween}>
                  <NeonText variant="h2" style={{ flex: 1 }}>{spot.title}</NeonText>
                  <NeonText variant="mono" tone="accent">S{spot.severity.toFixed(1)}</NeonText>
                </View>
                {spot.reasons.map((reason, index) => <NeonText key={`${spot.key}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <GlowButton label="Open remediation" variant="ghost" onPress={() => navigation.navigate(spot.recommendedSurface, { eventId: currentEventId ?? undefined })} />
              </Surface>
            ))}
          </View>

          <Surface padded style={styles.suggestionCard}>
            <Pill label="PERSPECTIVE / PATTERN SEEDS" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Frequent entity kinds: {report.suggestedPerspectiveKinds.join(' · ') || 'none'}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>Frequent relation families: {report.suggestedRelations.join(' · ') || 'none'}</NeonText>
          </Surface>
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
  eventRow: { gap: spacing.sm },
  eventChip: { minWidth: 180, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.58)' },
  eventChipActive: { borderColor: palette.accent },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 130, flexGrow: 1, borderRadius: radii.lg, borderColor: palette.hairline },
  ruleCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  signatureCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  blindCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  suggestionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
});
