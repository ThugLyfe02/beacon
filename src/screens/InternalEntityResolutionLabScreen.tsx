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
import { applyInternalGraphEntityAliases } from '../admin/InternalGraphCanonicalizationEngine';
import { suggestInternalGraphEntityResolutions } from '../admin/InternalGraphEntityResolutionEngine';
import {
  approveInternalGraphEntityAlias,
  loadInternalGraphEntityAliasState,
  loadRawInternalGraphForEntityResolution,
  revokeInternalGraphEntityAlias,
  type InternalGraphEntityAliasState,
} from '../admin/internalGraphEntityResolution.service';
import {
  loadInternalGraphEventSequence,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function label(graph: InternalGraphPayload | null, nodeId: string): string {
  return graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalEntityResolutionLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);
  const [rawGraph, setRawGraph] = useState<InternalGraphPayload | null>(null);
  const [aliasState, setAliasState] = useState<InternalGraphEntityAliasState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [sequence, aliases] = await Promise.all([
        loadInternalGraphEventSequence(48),
        loadInternalGraphEntityAliasState(),
      ]);
      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedId = currentEventId ?? ordered[0]?.eventId ?? null;
      const raw = await loadRawInternalGraphForEntityResolution({ eventId: selectedId, limit: 1900 });
      setEvents(ordered);
      setCurrentEventId(selectedId);
      setAliasState(aliases);
      setRawGraph(raw);
    } catch (error) {
      Alert.alert('Entity Resolution unavailable', error instanceof Error ? error.message : 'Unable to assemble raw/canonical graph state.');
    } finally {
      setLoading(false);
    }
  }, [operator, currentEventId]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const preview = useMemo(
    () => rawGraph && aliasState
      ? applyInternalGraphEntityAliases(rawGraph, aliasState.aliases, aliasState.canonicalizationVersion)
      : null,
    [rawGraph, aliasState],
  );
  const approvedAliases = aliasState?.aliases ?? [];
  const approvedAliasIds = useMemo(
    () => new Set(approvedAliases.map((mapping) => mapping.aliasNodeId)),
    [approvedAliases],
  );
  const suggestions = useMemo(
    () => rawGraph
      ? suggestInternalGraphEntityResolutions(rawGraph, 0.72)
          .filter((candidate) => !approvedAliasIds.has(candidate.aliasNodeId))
          .slice(0, 60)
      : [],
    [rawGraph, approvedAliasIds],
  );

  const approve = async (candidate: (typeof suggestions)[number]) => {
    setBusyId(candidate.aliasNodeId);
    try {
      await approveInternalGraphEntityAlias({
        eventId: currentEventId,
        aliasNodeId: candidate.aliasNodeId,
        canonicalNodeId: candidate.canonicalNodeId,
        confidence: candidate.score,
        reason: candidate.reasons.join(' · '),
      });
      await load();
    } catch (error) {
      Alert.alert('Canonicalization rejected', error instanceof Error ? error.message : 'Unable to approve entity alias.');
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (aliasId: string) => {
    setBusyId(aliasId);
    try {
      await revokeInternalGraphEntityAlias(aliasId);
      await load();
    } catch (error) {
      Alert.alert('Alias revoke failed', error instanceof Error ? error.message : 'Unable to revoke entity alias.');
    } finally {
      setBusyId(null);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>RESOLVING GRAPH ENTITY QUALITY</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_manage') || !rawGraph || !aliasState || !preview) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="ENTITY RESOLUTION · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText>
        </Surface>
      </View>
    );
  }

  const nodeCompression = rawGraph.nodeCount - preview.nodeCount;
  const edgeCompression = rawGraph.edgeCount - preview.edgeCount;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · GRAPH QUALITY CONTROL" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Entity Resolution Lab</NeonText>
              <NeonText variant="bodyMuted">Non-person canonicalization · duplicate suppression · topology quality · operator-approved only</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="IDENTITY FIREWALL" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Person identity resolution is prohibited. This Lab only canonicalizes already-authorized organization, domain, project, topic, venue, and role nodes. It performs no email, phone, device, facial, raw-location, or external identity matching, and every merge requires explicit operator approval.
            </NeonText>
          </Surface>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
            {events.slice(0, 16).map((event) => (
              <Pressable key={event.eventId} onPress={() => setCurrentEventId(event.eventId)} style={[styles.eventChip, currentEventId === event.eventId && styles.eventChipActive]}>
                <NeonText variant="label" tone={currentEventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText>
                <NeonText variant="bodyMuted">{event.participantCount} people · {event.mutualCount} mutuals</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <GlowButton label="Constellation" variant="ghost" onPress={() => navigation.navigate('InternalGraph', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab')} />
            <GlowButton label="Refresh" variant="ghost" disabled={busyId != null} onPress={load} />
          </View>

          <View style={styles.metricRow}>
            <Metric label="SUGGESTIONS" value={`${suggestions.length}`} />
            <Metric label="APPROVED" value={`${approvedAliases.length}`} />
            <Metric label="NODES COLLAPSED" value={`${nodeCompression}`} />
            <Metric label="EDGES COALESCED" value={`${edgeCompression}`} />
          </View>

          <Surface padded style={styles.versionCard}>
            <Pill label="CANONICAL GRAPH VERSION" tone="neutral" dot />
            <NeonText variant="mono" tone="accent" style={{ marginTop: spacing.sm }}>{preview.graphVersion}</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
              Approved alias changes alter this version, so Machine manifests and graph diffs cannot mistake canonicalization changes for identical topology.
            </NeonText>
          </Surface>

          <Section title="RESOLUTION CANDIDATES" subtitle="Confidence combines label similarity, root-domain equivalence and shared graph neighborhoods; approval is never automatic.">
            {suggestions.map((candidate) => (
              <Surface key={`${candidate.aliasNodeId}->${candidate.canonicalNodeId}`} elevated padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{label(rawGraph, candidate.aliasNodeId)} → {label(rawGraph, candidate.canonicalNodeId)}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{candidate.kind} · confidence {Math.round(candidate.score * 100)}%</NeonText>
                  </View>
                  <Pill label={`${Math.round(candidate.score * 100)}%`} tone="accent" />
                </View>
                <View style={styles.metricRow}>
                  <Metric label="LABEL" value={`${Math.round(candidate.labelSimilarity * 100)}%`} />
                  <Metric label="NEIGHBORS" value={`${Math.round(candidate.neighborhoodSimilarity * 100)}%`} />
                  <Metric label="SHARED" value={`${candidate.sharedNeighborCount}`} />
                  <Metric label="DOMAIN" value={candidate.domainEquivalent ? 'SAME' : '—'} />
                </View>
                {candidate.reasons.map((reason) => <NeonText key={reason} variant="bodyMuted" style={{ marginTop: 3 }}>• {reason}</NeonText>)}
                <GlowButton label={busyId === candidate.aliasNodeId ? 'Approving…' : 'Approve canonical alias'} variant="primary" disabled={busyId != null} onPress={() => approve(candidate)} />
              </Surface>
            ))}
            {suggestions.length === 0 ? <NeonText variant="bodyMuted">No unresolved non-person entity pair currently crosses the conservative similarity floor.</NeonText> : null}
          </Section>

          <Section title="APPROVED CANONICALIZATION" subtitle="Mappings are one-hop, expiring, auditable, and globally applied to internal graph analysis/export loads.">
            {approvedAliases.map((mapping) => (
              <Surface key={mapping.id} padded style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{label(rawGraph, mapping.aliasNodeId)} → {label(rawGraph, mapping.canonicalNodeId)}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{mapping.kind} · approved confidence {Math.round(mapping.confidence * 100)}%</NeonText>
                  </View>
                  <Pill label="CANONICAL" tone="accent" />
                </View>
                {mapping.reason ? <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{mapping.reason}</NeonText> : null}
                <GlowButton label={busyId === mapping.id ? 'Revoking…' : 'Revoke alias'} variant="ghost" disabled={busyId != null} onPress={() => revoke(mapping.id)} />
              </Surface>
            ))}
            {approvedAliases.length === 0 ? <NeonText variant="bodyMuted">No operator-approved canonical aliases exist yet.</NeonText> : null}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label: metricLabel, value }: Readonly<{ label: string; value: string }>) {
  return <View style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{metricLabel}</NeonText></View>;
}

function Section({ title: sectionTitle, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{sectionTitle}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { marginTop: spacing.sm, fontSize: 38 },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  versionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  eventRow: { gap: spacing.sm },
  eventChip: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, minWidth: 150 },
  eventChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.72)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metric: { flex: 1, minWidth: 78, minHeight: 68, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.74)' },
  section: { gap: spacing.sm },
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
