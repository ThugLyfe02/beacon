import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import InternalGraphCanvas from '../admin/InternalGraphCanvas';
import {
  analyzeInternalGraph,
  diffInternalGraphs,
  findInternalGraphPath,
  type InternalGraphConfidence,
  type InternalGraphPayload,
} from '../admin/InternalGraphEngine';
import {
  addInternalGraphAssertion,
  loadInternalIntelligenceGraph,
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

type InternalGraphRoute = {
  InternalGraph: { eventId?: string } | undefined;
};

type AssertionKind = 'organization' | 'domain' | 'project' | 'topic' | 'venue' | 'event' | 'role';

const ASSERTION_KINDS: AssertionKind[] = [
  'organization',
  'domain',
  'project',
  'topic',
  'venue',
  'event',
  'role',
];

function stringAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string | null): string {
  if (!payload || !nodeId) return '—';
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalGraphScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<InternalGraphRoute, 'InternalGraph'>>();
  const operator = useInternalOperator();
  const eventId = route.params?.eventId ?? null;

  const [payload, setPayload] = useState<InternalGraphPayload | null>(null);
  const previousPayload = useRef<InternalGraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pathSource, setPathSource] = useState<string | null>(null);
  const [pathTarget, setPathTarget] = useState<string | null>(null);
  const [assertionOpen, setAssertionOpen] = useState(false);
  const [assertionKind, setAssertionKind] = useState<AssertionKind>('organization');
  const [assertionLabel, setAssertionLabel] = useState('');
  const [assertionRelation, setAssertionRelation] = useState('connected_to');
  const [assertionSource, setAssertionSource] = useState('');
  const [assertionNote, setAssertionNote] = useState('');
  const [assertionConfidence, setAssertionConfidence] = useState<InternalGraphConfidence>('VERIFIED');
  const [savingAssertion, setSavingAssertion] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!operator.allowed) return;
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const next = await loadInternalIntelligenceGraph({
        eventId,
        includeRestricted: includeRestricted && operator.has('graph_restricted'),
        limit: 1100,
      });
      previousPayload.current = payload;
      setPayload(next);
      if (selectedNodeId && !next.nodes.some((node) => node.id === selectedNodeId)) {
        setSelectedNodeId(null);
      }
    } catch (error) {
      if (!quiet) {
        Alert.alert(
          'Internal graph unavailable',
          error instanceof Error ? error.message : 'Unable to load operator intelligence.',
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, includeRestricted, operator, payload, selectedNodeId]);

  useEffect(() => {
    if (!operator.loading && operator.allowed) load(false);
  }, [operator.loading, operator.allowed, includeRestricted, eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!operator.allowed) return;
    const timer = setInterval(() => load(true), 20_000);
    return () => clearInterval(timer);
  }, [operator.allowed, load]);

  const analysis = useMemo(() => payload ? analyzeInternalGraph(payload) : null, [payload]);
  const diff = useMemo(() => payload ? diffInternalGraphs(previousPayload.current, payload) : null, [payload]);
  const nodeById = useMemo(
    () => new Map((payload?.nodes ?? []).map((node) => [node.id, node] as const)),
    [payload],
  );
  const metricByNode = useMemo(
    () => new Map((analysis?.metrics ?? []).map((metric) => [metric.nodeId, metric] as const)),
    [analysis],
  );
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedMetric = selectedNodeId ? metricByNode.get(selectedNodeId) ?? null : null;
  const selectedEdges = useMemo(() => {
    if (!payload || !selectedNodeId) return [];
    return payload.edges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .sort((left, right) => right.strength - left.strength || right.evidenceCount - left.evidenceCount)
      .slice(0, 14);
  }, [payload, selectedNodeId]);
  const path = useMemo(
    () => payload && pathSource && pathTarget
      ? findInternalGraphPath(payload, pathSource, pathTarget)
      : null,
    [payload, pathSource, pathTarget],
  );

  const searchResults = useMemo(() => {
    if (!payload || !query.trim()) return [];
    const needle = query.trim().toLowerCase();
    return payload.nodes
      .filter((node) => node.label.toLowerCase().includes(needle) || node.kind.toLowerCase().includes(needle))
      .sort((left, right) => {
        const leftExact = left.label.toLowerCase() === needle ? 0 : 1;
        const rightExact = right.label.toLowerCase() === needle ? 0 : 1;
        return leftExact - rightExact || left.label.localeCompare(right.label);
      })
      .slice(0, 8);
  }, [payload, query]);

  const openSelectedProfile = () => {
    const userId = stringAttribute(selectedNode?.attributes.subjectUserId);
    if (userId) navigation.navigate('Profile', { userId });
  };

  const saveAssertion = async () => {
    const subjectUserId = stringAttribute(selectedNode?.attributes.subjectUserId);
    if (!subjectUserId || !assertionLabel.trim() || !assertionRelation.trim()) return;
    setSavingAssertion(true);
    try {
      await addInternalGraphAssertion({
        subjectUserId,
        entityKind: assertionKind,
        entityLabel: assertionLabel,
        relation: assertionRelation,
        confidence: assertionConfidence,
        sourceUri: assertionSource || null,
        note: assertionNote || null,
      });
      setAssertionOpen(false);
      setAssertionLabel('');
      setAssertionSource('');
      setAssertionNote('');
      await load(true);
    } catch (error) {
      Alert.alert('Bridge assertion rejected', error instanceof Error ? error.message : 'Unable to add bridge.');
    } finally {
      setSavingAssertion(false);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          ASSEMBLING EVIDENCE GRAPH
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read')) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="INTERNAL · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator capability required.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            This surface is absent for normal Beacon accounts and cannot be enabled from the client.
          </NeonText>
        </Surface>
      </View>
    );
  }

  if (!payload || !analysis) return null;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.18} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Pill label={eventId ? 'INTERNAL · EVENT GRAPH' : 'INTERNAL · GLOBAL GRAPH'} tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Constellation</NeonText>
              <NeonText variant="bodyMuted">
                Evidence-native relationship intelligence · {payload.nodeCount} nodes · {payload.edgeCount} edges
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <View style={styles.telemetryRow}>
            <Telemetry label="COMMUNITIES" value={`${analysis.communities.length}`} />
            <Telemetry label="BROKERS" value={`${analysis.brokerNodeIds.length}`} />
            <Telemetry label="NEW EDGES" value={`${diff?.addedEdgeIds.length ?? 0}`} />
            <Telemetry label="REMOVED" value={`${diff?.removedEdgeIds.length ?? 0}`} />
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search person, role, organization, venue…"
              placeholderTextColor="#64748B"
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={() => load(true)} style={styles.refreshButton}>
              <NeonText variant="label" tone="accent">{refreshing ? 'SYNC…' : 'SYNC'}</NeonText>
            </Pressable>
          </View>

          {searchResults.length > 0 ? (
            <Surface padded style={styles.searchResults}>
              {searchResults.map((node) => (
                <Pressable
                  key={node.id}
                  onPress={() => {
                    setSelectedNodeId(node.id);
                    setQuery('');
                  }}
                  style={styles.searchResult}
                >
                  <NeonText variant="body">{node.label}</NeonText>
                  <NeonText variant="label" tone="muted">{node.kind.toUpperCase()}</NeonText>
                </Pressable>
              ))}
            </Surface>
          ) : null}

          {operator.has('graph_restricted') ? (
            <Surface padded style={styles.restrictedRow}>
              <View style={{ flex: 1 }}>
                <NeonText variant="label" tone="danger">RESTRICTED FORENSICS</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>
                  Include block/report topology. Free-text report reasons are never copied into graph memory.
                </NeonText>
              </View>
              <Switch
                value={includeRestricted}
                onValueChange={setIncludeRestricted}
                trackColor={{ false: palette.hairlineStrong, true: palette.danger }}
                thumbColor={includeRestricted ? '#F8FAFC' : palette.textMuted}
              />
            </Surface>
          ) : null}

          <InternalGraphCanvas
            payload={payload}
            analysis={analysis}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />

          {selectedNode ? (
            <Surface elevated padded glow style={styles.selectedCard}>
              <View style={styles.selectedHeader}>
                <View style={{ flex: 1 }}>
                  <Pill label={selectedNode.kind.toUpperCase()} tone="accent" dot />
                  <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{selectedNode.label}</NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                    Community {selectedMetric?.communityId ?? '—'} · weighted degree {selectedMetric?.weightedDegree.toFixed(2) ?? '0'} · broker {selectedMetric?.brokerScore.toFixed(2) ?? '0'}
                  </NeonText>
                </View>
                <Pressable onPress={() => setSelectedNodeId(null)}>
                  <NeonText variant="label" tone="muted">CLEAR</NeonText>
                </Pressable>
              </View>

              <View style={styles.selectedActions}>
                {stringAttribute(selectedNode.attributes.subjectUserId) ? (
                  <GlowButton label="Open profile" onPress={openSelectedProfile} variant="ghost" />
                ) : null}
                <GlowButton
                  label={pathSource === selectedNode.id ? 'Path start ✓' : 'Set path start'}
                  onPress={() => setPathSource(selectedNode.id)}
                  variant="ghost"
                />
                <GlowButton
                  label={pathTarget === selectedNode.id ? 'Path target ✓' : 'Set path target'}
                  onPress={() => setPathTarget(selectedNode.id)}
                  variant="ghost"
                />
                {operator.has('graph_manage') && stringAttribute(selectedNode.attributes.subjectUserId) ? (
                  <GlowButton label="Add bridge" onPress={() => setAssertionOpen(true)} variant="ghost" />
                ) : null}
              </View>

              {selectedEdges.length > 0 ? (
                <View style={styles.edgeList}>
                  <NeonText variant="label" tone="accent">EDGE PROVENANCE</NeonText>
                  {selectedEdges.map((edge) => {
                    const otherId = edge.source === selectedNode.id ? edge.target : edge.source;
                    return (
                      <Pressable key={edge.id} style={styles.edgeRow} onPress={() => setSelectedNodeId(otherId)}>
                        <View style={{ flex: 1 }}>
                          <NeonText variant="body">{edge.relation.replaceAll('_', ' ')} → {nodeLabel(payload, otherId)}</NeonText>
                          <NeonText variant="bodyMuted">
                            {edge.confidence} · strength {edge.strength.toFixed(2)} · evidence ×{edge.evidenceCount}
                          </NeonText>
                        </View>
                        {edge.sensitivity === 'restricted' ? <Pill label="RESTRICTED" tone="danger" /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </Surface>
          ) : null}

          {pathSource && pathTarget ? (
            <Surface elevated padded style={styles.pathCard}>
              <Pill label="EXPLAINABLE BRIDGE PATH" tone="accent" dot />
              {path ? (
                <>
                  <NeonText variant="h2" style={{ marginTop: spacing.sm }}>
                    {nodeLabel(payload, pathSource)} → {nodeLabel(payload, pathTarget)}
                  </NeonText>
                  <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                    {path.nodeIds.map((id) => nodeLabel(payload, id)).join('  →  ')}
                  </NeonText>
                  <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>
                    PATH COST {path.cost.toFixed(3)} · {path.edgeIds.length} HOPS
                  </NeonText>
                </>
              ) : (
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                  No explainable path exists in the currently authorized graph.
                </NeonText>
              )}
              <Pressable onPress={() => { setPathSource(null); setPathTarget(null); }} style={{ marginTop: spacing.sm }}>
                <NeonText variant="label" tone="muted">CLEAR PATH</NeonText>
              </Pressable>
            </Surface>
          ) : null}

          <InsightSection title="BROKER NODES" subtitle="People/entities spanning otherwise separate communities">
            {analysis.brokerNodeIds.slice(0, 6).map((id, index) => (
              <InsightRow
                key={id}
                rank={index + 1}
                title={nodeLabel(payload, id)}
                detail={`broker ${(metricByNode.get(id)?.brokerScore ?? 0).toFixed(2)}`}
                onPress={() => setSelectedNodeId(id)}
              />
            ))}
          </InsightSection>

          <InsightSection title="STRUCTURAL-HOLE BRIDGES" subtitle="Potential introductions with a concrete shared connector">
            {analysis.bridgeCandidates.slice(0, 7).map((candidate, index) => (
              <InsightRow
                key={`${candidate.source}|${candidate.via}|${candidate.target}`}
                rank={index + 1}
                title={`${nodeLabel(payload, candidate.source)} ↔ ${nodeLabel(payload, candidate.target)}`}
                detail={`via ${nodeLabel(payload, candidate.via)} · ${candidate.why.join(' · ')}`}
                onPress={() => setSelectedNodeId(candidate.via)}
              />
            ))}
          </InsightSection>

          <InsightSection title="SURPRISING CONNECTIONS" subtitle="Cross-community edges that deserve operator attention">
            {analysis.surprises.slice(0, 7).map((surprise, index) => (
              <InsightRow
                key={surprise.edgeId}
                rank={index + 1}
                title={`${nodeLabel(payload, surprise.source)} → ${nodeLabel(payload, surprise.target)}`}
                detail={`${surprise.relation.replaceAll('_', ' ')} · ${surprise.why.join(' · ')}`}
                onPress={() => setSelectedNodeId(surprise.source)}
              />
            ))}
          </InsightSection>

          <Surface padded style={styles.retentionCard}>
            <Pill label="RETENTION CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Standard topology expires on bounded retention windows; restricted safety edges expire faster. Person graph state is keyed through erasable aliases and is purged when that account is erased. The graph stores evidence topology—not emails, raw GPS trails, private outcome intents, or free-text safety reports.
            </NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={assertionOpen} animationType="slide" transparent onRequestClose={() => setAssertionOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Pill label="BRIDGE BUILDER" tone="accent" dot />
                <NeonText variant="h1" style={{ marginTop: spacing.sm }}>
                  Extend {selectedNode?.label ?? 'subject'}
                </NeonText>
              </View>
              <Pressable onPress={() => setAssertionOpen(false)}>
                <NeonText variant="label" tone="muted">CLOSE</NeonText>
              </Pressable>
            </View>

            <NeonText variant="label" tone="muted">ENTITY KIND</NeonText>
            <View style={styles.kindRail}>
              {ASSERTION_KINDS.map((kind) => (
                <Pressable key={kind} onPress={() => setAssertionKind(kind)} style={[styles.kindChip, assertionKind === kind && styles.kindChipActive]}>
                  <NeonText variant="label" tone={assertionKind === kind ? 'accent' : 'muted'}>{kind.toUpperCase()}</NeonText>
                </Pressable>
              ))}
            </View>

            <Field label="ENTITY LABEL" value={assertionLabel} onChange={setAssertionLabel} placeholder="Acme Ventures / example.com / Project Atlas" />
            <Field label="RELATION" value={assertionRelation} onChange={setAssertionRelation} placeholder="works_with / advised_by / affiliated_with" />
            <Field label="SOURCE URI" value={assertionSource} onChange={setAssertionSource} placeholder="https://…" />
            <Field label="NOTE" value={assertionNote} onChange={setAssertionNote} placeholder="Why this bridge exists (max 500 chars)" multiline />

            <NeonText variant="label" tone="muted">CONFIDENCE</NeonText>
            <View style={styles.kindRail}>
              {(['VERIFIED', 'DERIVED', 'AMBIGUOUS'] as InternalGraphConfidence[]).map((confidence) => (
                <Pressable key={confidence} onPress={() => setAssertionConfidence(confidence)} style={[styles.kindChip, assertionConfidence === confidence && styles.kindChipActive]}>
                  <NeonText variant="label" tone={assertionConfidence === confidence ? 'accent' : 'muted'}>{confidence}</NeonText>
                </Pressable>
              ))}
            </View>

            <Surface padded style={styles.bridgeRule}>
              <NeonText variant="bodyMuted">
                Bridge Builder is intentionally limited to business/event context. It does not fetch people, phone numbers, home addresses, devices, or other hidden personal identifiers.
              </NeonText>
            </Surface>

            <GlowButton
              label={savingAssertion ? 'Committing evidence…' : 'Commit bridge evidence'}
              onPress={saveAssertion}
              loading={savingAssertion}
              fullWidth
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Telemetry({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.telemetry}>
      <NeonText variant="h2" tone="accent" glow>{value}</NeonText>
      <NeonText variant="label" tone="muted">{label}</NeonText>
    </View>
  );
}

function InsightSection({
  title,
  subtitle,
  children,
}: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return (
    <Surface elevated padded style={styles.insightCard}>
      <NeonText variant="label" tone="accent">{title}</NeonText>
      <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{subtitle}</NeonText>
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </Surface>
  );
}

function InsightRow({
  rank,
  title,
  detail,
  onPress,
}: Readonly<{ rank: number; title: string; detail: string; onPress: () => void }>) {
  return (
    <Pressable onPress={onPress} style={styles.insightRow}>
      <View style={styles.rankBadge}><NeonText variant="label" tone="accent">{rank}</NeonText></View>
      <View style={{ flex: 1 }}>
        <NeonText variant="body">{title}</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 2 }}>{detail}</NeonText>
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}>) {
  return (
    <View style={{ gap: 6 }}>
      <NeonText variant="label" tone="muted">{label}</NeonText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#64748B"
        multiline={multiline}
        maxLength={multiline ? 500 : 160}
        style={[styles.modalInput, multiline && styles.modalInputMultiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#040711' },
  centered: { flex: 1, backgroundColor: '#040711', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 480, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 100, gap: spacing.md },
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  telemetryRow: { flexDirection: 'row', gap: spacing.sm },
  telemetry: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: 'rgba(15,23,42,0.72)', borderWidth: 1, borderColor: palette.hairline },
  searchWrap: { flexDirection: 'row', gap: spacing.sm },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 14, color: '#F8FAFC', backgroundColor: '#0F172A', borderRadius: 13, borderWidth: 1, borderColor: '#1E293B' },
  refreshButton: { minWidth: 68, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  searchResults: { gap: 4, borderRadius: radii.lg },
  searchResult: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.hairline },
  restrictedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.lg, borderColor: 'rgba(251,113,133,0.25)' },
  selectedCard: { borderRadius: radii.xl, borderColor: 'rgba(56,189,248,0.34)' },
  selectedHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  selectedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  edgeList: { marginTop: spacing.md, gap: 6 },
  edgeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.hairline },
  pathCard: { borderRadius: radii.xl },
  insightCard: { borderRadius: radii.xl },
  insightRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 9, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.hairline },
  rankBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft, borderWidth: 1, borderColor: palette.accent },
  retentionCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.76)', justifyContent: 'flex-end' },
  modalCard: { marginTop: 80, padding: spacing.xl, paddingBottom: 48, gap: spacing.md, backgroundColor: '#07101D', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#1E293B' },
  modalHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  kindRail: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  kindChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A' },
  kindChipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  modalInput: { minHeight: 44, paddingHorizontal: 12, color: '#F8FAFC', borderRadius: 12, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0F172A' },
  modalInputMultiline: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  bridgeRule: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
});
