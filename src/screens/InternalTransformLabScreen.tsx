import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  buildInternalEvidenceTimeline,
  expandInternalTransformNeighborhood,
  runInternalNodeTransforms,
  type InternalTransformResult,
} from '../admin/InternalGraphTransformEngine';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type TransformRoute = {
  InternalTransformLab: { eventId?: string; nodeId?: string } | undefined;
};

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalTransformLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<TransformRoute, 'InternalTransformLab'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;
  const requestedNodeId = route.params?.nodeId ?? null;
  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(requestedNodeId);
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState(2);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const graph = await loadInternalIntelligenceGraph({ eventId, includeRestricted: false, limit: 1400 });
      setPayload(graph);
      const validRequested = requestedNodeId && graph.nodes.some((node) => node.id === requestedNodeId)
        ? requestedNodeId
        : null;
      setSelectedNodeId((current) => current && graph.nodes.some((node) => node.id === current)
        ? current
        : validRequested ?? graph.nodes.find((node) => node.kind === 'person')?.id ?? graph.nodes[0]?.id ?? null);
    } catch (error) {
      Alert.alert('Transform Lab unavailable', error instanceof Error ? error.message : 'Unable to load graph transforms.');
    } finally {
      setLoading(false);
    }
  }, [eventId, operator, requestedNodeId]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const searchResults = useMemo(() => {
    if (!payload) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return payload.nodes.slice(0, 20);
    return payload.nodes
      .filter((node) => node.label.toLowerCase().includes(normalized) || node.kind.toLowerCase().includes(normalized))
      .slice(0, 30);
  }, [payload, query]);

  const transforms = useMemo(
    () => payload && selectedNodeId ? runInternalNodeTransforms(payload, selectedNodeId) : [],
    [payload, selectedNodeId],
  );
  const timeline = useMemo(
    () => payload && selectedNodeId ? buildInternalEvidenceTimeline(payload, selectedNodeId) : [],
    [payload, selectedNodeId],
  );
  const neighborhood = useMemo(
    () => payload && selectedNodeId ? expandInternalTransformNeighborhood(payload, [selectedNodeId], depth, 120) : null,
    [payload, selectedNodeId, depth],
  );

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>RUNNING GRAPH TRANSFORMS</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface padded style={styles.lockedCard}>
          <Pill label="TRANSFORM LAB · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  if (!payload || !selectedNodeId) return null;
  const selected = payload.nodes.find((node) => node.id === selectedNodeId);

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · TRANSFORM ENGINE" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Transform Lab</NeonText>
              <NeonText variant="bodyMuted">
                Maltego-style pivots over first-party Beacon evidence. No external identity lookup or scraping.
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <GlowButton label="Constellation" variant="ghost" onPress={() => navigation.navigate('InternalGraph', { eventId: eventId ?? undefined })} />
            <GlowButton label="Strategy Lab" variant="ghost" onPress={() => navigation.navigate('InternalStrategyLab', { eventId: eventId ?? undefined })} />
            <GlowButton label="Simulation Lab" variant="ghost" onPress={() => navigation.navigate('InternalSimulationLab', { eventId: eventId ?? undefined })} />
          </View>

          <Surface elevated padded style={styles.selectedCard}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <NeonText variant="label" tone="accent">TRANSFORM SOURCE</NeonText>
                <NeonText variant="h1" style={{ marginTop: 4 }}>{selected?.label ?? selectedNodeId}</NeonText>
                <NeonText variant="bodyMuted">{selected?.kind ?? 'entity'} · {selected?.sensitivity ?? 'standard'}</NeonText>
              </View>
              <Pill label={`${transforms.length} TRANSFORMS`} tone="neutral" />
            </View>
          </Surface>

          <View style={styles.searchBlock}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Pivot to another person, event, role, org, project…"
              placeholderTextColor="#64748B"
              style={styles.input}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resultRow}>
              {searchResults.map((node) => (
                <Pressable
                  key={node.id}
                  onPress={() => { setSelectedNodeId(node.id); setQuery(''); }}
                  style={[styles.nodeChip, node.id === selectedNodeId && styles.nodeChipActive]}
                >
                  <NeonText variant="label" tone={node.id === selectedNodeId ? 'accent' : 'muted'}>{node.label.toUpperCase()}</NeonText>
                  <NeonText variant="bodyMuted">{node.kind}</NeonText>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <Section title="TRANSFORM PALETTE · MALTEGO-STYLE TRANSFORMS" subtitle="Each transform expands evidence Beacon already holds; results remain provenance-aware">
            {transforms.map((transform) => (
              <TransformCard key={transform.id} transform={transform} payload={payload} />
            ))}
          </Section>

          <Section title="MULTI-HOP EXPANSION · RELATIONSHIP LADDER" subtitle="Bounded multi-hop expansion for investigative context, not hidden contact discovery">
            <View style={styles.depthRow}>
              {[1, 2, 3, 4].map((value) => (
                <Pressable key={value} onPress={() => setDepth(value)} style={[styles.depthChip, depth === value && styles.depthChipActive]}>
                  <NeonText variant="label" tone={depth === value ? 'accent' : 'muted'}>{value} HOP{value === 1 ? '' : 'S'}</NeonText>
                </Pressable>
              ))}
            </View>
            <Surface padded style={styles.smallCard}>
              <NeonText variant="h2">{neighborhood?.nodeIds.length ?? 0} nodes · {neighborhood?.edgeIds.length ?? 0} edges</NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                Expansion is capped at 120 nodes and never changes the underlying graph.
              </NeonText>
            </Surface>
          </Section>

          <Section title="EVIDENCE TIMELINE · PROVENANCE TIMELINE" subtitle="First/last seen chronology avoids inventing a biography from graph structure">
            {timeline.slice(0, 30).map((item) => (
              <Surface key={item.edgeId} padded style={styles.timelineCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="label" tone="accent">{item.relation.toUpperCase()}</NeonText>
                    <NeonText variant="h2" style={{ marginTop: 3 }}>{nodeLabel(payload, item.counterpartNodeId)}</NeonText>
                  </View>
                  <Pill label={`${item.confidence} · n=${item.evidenceCount}`} tone={item.sensitivity === 'restricted' ? 'danger' : 'neutral'} />
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>
                  first {new Date(item.firstSeenAt).toLocaleString()} · last {new Date(item.lastSeenAt).toLocaleString()}
                </NeonText>
              </Surface>
            ))}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function TransformCard({ transform, payload }: Readonly<{ transform: InternalTransformResult; payload: InternalGraphPayload }>) {
  return (
    <Surface elevated padded style={styles.transformCard}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="accent">{transform.kind.replaceAll('_', ' ').toUpperCase()}</NeonText>
          <NeonText variant="h2" style={{ marginTop: 4 }}>{transform.title}</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{transform.description}</NeonText>
        </View>
        <Pill label={`${transform.targetNodeIds.length} TARGETS`} tone="neutral" />
      </View>
      {transform.evidence.slice(0, 8).map((line, index) => (
        <NeonText key={`${transform.id}-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {line}</NeonText>
      ))}
      {transform.targetNodeIds.length > 0 ? (
        <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>
          {transform.targetNodeIds.slice(0, 6).map((id) => nodeLabel(payload, id)).join(' · ')}
        </NeonText>
      ) : null}
    </Surface>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <View style={styles.section}>
      <View>
        <NeonText variant="label" tone="accent">{title}</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02040B' },
  centered: { flex: 1, backgroundColor: '#02040B', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selectedCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  searchBlock: { gap: spacing.sm },
  input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' },
  resultRow: { gap: spacing.sm },
  nodeChip: { minWidth: 150, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.64)' },
  nodeChipActive: { borderColor: palette.accent },
  section: { gap: spacing.sm },
  transformCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  depthRow: { flexDirection: 'row', gap: spacing.sm },
  depthChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairline },
  depthChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' },
  smallCard: { borderRadius: radii.lg, borderColor: palette.hairline },
  timelineCard: { borderRadius: radii.lg, borderColor: palette.hairline },
});
