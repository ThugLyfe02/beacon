import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { useInternalOperator } from '../admin/useInternalOperator';
import { loadInternalGraphCases, type InternalGraphCase } from '../admin/internalGraphCasebook.service';
import {
  addInternalGraphCaseHandoffNote,
  createInternalGraphCaseHandoff,
  loadInternalGraphCaseHandoffs,
  loadInternalHandoffOperatorDirectory,
  setInternalGraphCaseHandoffStatus,
  type InternalGraphCaseHandoff,
  type InternalHandoffOperator,
} from '../admin/internalGraphHandoff.service';
import { loadInternalIntelligenceGraph } from '../admin/internalGraph.service';
import {
  applyInternalGraphPerspective,
  INTERNAL_GRAPH_BUILTIN_PERSPECTIVES,
  type InternalGraphPerspectiveDefinition,
} from '../admin/InternalGraphPerspectiveEngine';
import { loadInternalGraphPerspectives } from '../admin/internalGraphPerspective.service';
import type { InternalGraphPayload } from '../admin/InternalGraphEngine';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

export default function InternalHandoffLabScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { user } = useAuth();
  const operator = useInternalOperator();
  const [cases, setCases] = useState<InternalGraphCase[]>([]);
  const [directory, setDirectory] = useState<InternalHandoffOperator[]>([]);
  const [handoffs, setHandoffs] = useState<InternalGraphCaseHandoff[]>([]);
  const [perspectives, setPerspectives] = useState<InternalGraphPerspectiveDefinition[]>(INTERNAL_GRAPH_BUILTIN_PERSPECTIVES);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [selectedPerspectiveId, setSelectedPerspectiveId] = useState('evidence_first');
  const [graph, setGraph] = useState<InternalGraphPayload | null>(null);
  const [summary, setSummary] = useState('');
  const [nextQuestion, setNextQuestion] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const selectedPerspective = perspectives.find((item) => item.id === selectedPerspectiveId)
    ?? INTERNAL_GRAPH_BUILTIN_PERSPECTIVES.find((item) => item.id === 'evidence_first')!;
  const perspectiveResult = useMemo(
    () => graph ? applyInternalGraphPerspective(graph, selectedPerspective) : null,
    [graph, selectedPerspective],
  );

  const loadBase = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [caseRows, operatorRows, handoffRows, catalog] = await Promise.all([
        loadInternalGraphCases(),
        loadInternalHandoffOperatorDirectory(),
        loadInternalGraphCaseHandoffs(),
        loadInternalGraphPerspectives(),
      ]);
      setCases(caseRows);
      setDirectory(operatorRows.filter((item) => item.id !== user?.id));
      setHandoffs(handoffRows);
      setPerspectives([...INTERNAL_GRAPH_BUILTIN_PERSPECTIVES, ...catalog.perspectives]);
      setSelectedCaseId((current) => current && caseRows.some((item) => item.id === current)
        ? current
        : caseRows.find((item) => item.status === 'active')?.id ?? caseRows[0]?.id ?? null);
      setSelectedRecipientId((current) => current && operatorRows.some((item) => item.id === current && item.id !== user?.id)
        ? current
        : operatorRows.find((item) => item.id !== user?.id)?.id ?? null);
    } catch (error) {
      Alert.alert('Handoff Lab unavailable', error instanceof Error ? error.message : 'Unable to load operator handoffs.');
    } finally {
      setLoading(false);
    }
  }, [operator, user?.id]);

  useEffect(() => {
    if (!operator.loading) void loadBase();
  }, [operator.loading, loadBase]);

  useEffect(() => {
    if (!selectedCase || !operator.allowed || !operator.has('graph_manage')) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    void loadInternalIntelligenceGraph({ eventId: selectedCase.scopeEventId, includeRestricted: false, limit: 1600 })
      .then((payload) => { if (!cancelled) setGraph(payload); })
      .catch((error) => { if (!cancelled) Alert.alert('Case graph unavailable', error instanceof Error ? error.message : 'Unable to load case graph.'); });
    return () => { cancelled = true; };
  }, [selectedCase, operator]);

  const createHandoff = async () => {
    if (!selectedCase || !selectedRecipientId || !graph || !perspectiveResult) return;
    if (summary.trim().length < 12 || nextQuestion.trim().length < 8) {
      Alert.alert('More context required', 'Add a concise analytical summary and a falsifiable next question before handing off the case.');
      return;
    }
    setSending(true);
    try {
      await createInternalGraphCaseHandoff({
        caseId: selectedCase.id,
        toOperator: selectedRecipientId,
        graphVersion: graph.graphVersion,
        perspectiveFingerprint: perspectiveResult.perspectiveFingerprint,
        perspectiveTitle: selectedPerspective.title,
        summary,
        nextQuestion,
        evidenceSummary: {
          schemaVersion: 'handoff-evidence-v1',
          graphVersion: graph.graphVersion,
          caseStatus: selectedCase.status,
          pinCount: selectedCase.pins.length,
          findingCount: selectedCase.findings.length,
          perspective: {
            fingerprint: perspectiveResult.perspectiveFingerprint,
            visibleNodeCount: perspectiveResult.payload.nodeCount,
            visibleEdgeCount: perspectiveResult.payload.edgeCount,
            hiddenNodeCount: perspectiveResult.hiddenNodeCount,
            hiddenEdgeCount: perspectiveResult.hiddenEdgeCount,
          },
        },
      });
      setSummary('');
      setNextQuestion('');
      await loadBase();
    } catch (error) {
      Alert.alert('Handoff rejected', error instanceof Error ? error.message : 'Unable to transfer investigation context.');
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (handoff: InternalGraphCaseHandoff, status: 'accepted' | 'declined' | 'resolved' | 'withdrawn') => {
    try {
      await setInternalGraphCaseHandoffStatus(handoff.id, status);
      await loadBase();
    } catch (error) {
      Alert.alert('Unable to update handoff', error instanceof Error ? error.message : 'Handoff status update failed.');
    }
  };

  const addNote = async (handoff: InternalGraphCaseHandoff) => {
    const note = noteDrafts[handoff.id]?.trim() ?? '';
    if (!note) return;
    try {
      await addInternalGraphCaseHandoffNote(handoff.id, note);
      setNoteDrafts((current) => ({ ...current, [handoff.id]: '' }));
      await loadBase();
    } catch (error) {
      Alert.alert('Unable to add note', error instanceof Error ? error.message : 'Handoff note failed.');
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>ASSEMBLING INVESTIGATION CONTEXT</NeonText></View>;
  }
  if (!operator.allowed || !operator.has('graph_manage')) {
    return <View style={styles.centered}><GridBackground /><Surface padded style={styles.locked}><Pill label="HANDOFF LAB · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  const incoming = handoffs.filter((handoff) => handoff.toOperatorId === user?.id);
  const outgoing = handoffs.filter((handoff) => handoff.fromOperatorId === user?.id);

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · INVESTIGATION CONTEXT TRANSFER" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Handoff Lab</NeonText>
              <NeonText variant="bodyMuted">Case + canonical graph version + Perspective fingerprint + evidence digest + falsifiable next question. No graph payload duplication.</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="HANDOFF CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Only provisioned graph-management operators can participate. Handoff text rejects obvious email/URL dumping, evidence is stored only as SHA-256 digest, and the handoff itself authorizes no relationship or user-facing action.</NeonText>
          </Surface>

          <Section title="CREATE HANDOFF CAPSULE" subtitle="Transfer the analytical question—not a screenshot or opaque data dump">
            <NeonText variant="label" tone="muted">CASE</NeonText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              {cases.filter((item) => item.status !== 'archived').map((item) => <Pressable key={item.id} onPress={() => setSelectedCaseId(item.id)} style={[styles.choiceChip, selectedCaseId === item.id && styles.choiceChipActive]}><NeonText variant="label" tone={selectedCaseId === item.id ? 'accent' : 'muted'}>{item.title.toUpperCase()}</NeonText></Pressable>)}
            </ScrollView>
            <NeonText variant="label" tone="muted">RECIPIENT</NeonText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              {directory.map((item) => <Pressable key={item.id} onPress={() => setSelectedRecipientId(item.id)} style={[styles.choiceChip, selectedRecipientId === item.id && styles.choiceChipActive]}><NeonText variant="label" tone={selectedRecipientId === item.id ? 'accent' : 'muted'}>{item.label.toUpperCase()}</NeonText></Pressable>)}
            </ScrollView>
            <NeonText variant="label" tone="muted">PERSPECTIVE</NeonText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
              {perspectives.slice(0, 16).map((item) => <Pressable key={item.id} onPress={() => setSelectedPerspectiveId(item.id)} style={[styles.choiceChip, selectedPerspectiveId === item.id && styles.choiceChipActive]}><NeonText variant="label" tone={selectedPerspectiveId === item.id ? 'accent' : 'muted'}>{item.title.toUpperCase()}</NeonText></Pressable>)}
            </ScrollView>
            {selectedCase && perspectiveResult ? (
              <Surface padded style={styles.smallCard}>
                <NeonText variant="h2">{selectedCase.title}</NeonText>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{selectedPerspective.title} · {perspectiveResult.payload.nodeCount} visible nodes · {perspectiveResult.payload.edgeCount} visible edges · scene {perspectiveResult.perspectiveFingerprint}</NeonText>
              </Surface>
            ) : null}
            <TextInput value={summary} onChangeText={setSummary} placeholder="What has been established so far? No direct contact details or URLs." placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <TextInput value={nextQuestion} onChangeText={setNextQuestion} placeholder="What falsifiable question should the recipient answer next?" placeholderTextColor="#64748B" style={[styles.input, styles.multiline]} multiline />
            <GlowButton label={sending ? 'Transferring…' : 'Create handoff capsule'} disabled={sending || !selectedCaseId || !selectedRecipientId || !graph} onPress={createHandoff} />
          </Section>

          <Section title="INCOMING" subtitle={`${incoming.filter((item) => item.status === 'open').length} open handoff${incoming.filter((item) => item.status === 'open').length === 1 ? '' : 's'} awaiting your review`}>
            {incoming.map((handoff) => <HandoffCard key={handoff.id} handoff={handoff} currentUserId={user?.id ?? null} note={noteDrafts[handoff.id] ?? ''} setNote={(value) => setNoteDrafts((current) => ({ ...current, [handoff.id]: value }))} onNote={() => addNote(handoff)} onStatus={(status) => updateStatus(handoff, status)} />)}
            {incoming.length === 0 ? <NeonText variant="bodyMuted">No incoming handoffs.</NeonText> : null}
          </Section>

          <Section title="OUTGOING" subtitle="Track whether analytical context was accepted, resolved, declined or withdrawn">
            {outgoing.map((handoff) => <HandoffCard key={handoff.id} handoff={handoff} currentUserId={user?.id ?? null} note={noteDrafts[handoff.id] ?? ''} setNote={(value) => setNoteDrafts((current) => ({ ...current, [handoff.id]: value }))} onNote={() => addNote(handoff)} onStatus={(status) => updateStatus(handoff, status)} />)}
            {outgoing.length === 0 ? <NeonText variant="bodyMuted">No outgoing handoffs.</NeonText> : null}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function HandoffCard({ handoff, currentUserId, note, setNote, onNote, onStatus }: Readonly<{
  handoff: InternalGraphCaseHandoff;
  currentUserId: string | null;
  note: string;
  setNote: (value: string) => void;
  onNote: () => void;
  onStatus: (status: 'accepted' | 'declined' | 'resolved' | 'withdrawn') => void;
}>) {
  const incoming = handoff.toOperatorId === currentUserId;
  const outgoing = handoff.fromOperatorId === currentUserId;
  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Pill label={`${handoff.status.toUpperCase()} · ${incoming ? 'INCOMING' : 'OUTGOING'}`} tone={handoff.status === 'accepted' ? 'accent' : 'neutral'} dot={handoff.status === 'open'} />
          <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{handoff.caseTitle}</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{handoff.fromOperatorLabel} → {handoff.toOperatorLabel}</NeonText>
        </View>
        <NeonText variant="mono" tone="accent">{handoff.evidenceDigest.slice(0, 10)}…</NeonText>
      </View>
      <NeonText variant="body" style={{ marginTop: spacing.sm }}>{handoff.summary}</NeonText>
      <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>NEXT FALSIFIABLE QUESTION</NeonText>
      <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{handoff.nextQuestion}</NeonText>
      <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{handoff.perspectiveTitle ?? 'No Perspective'} · graph {handoff.graphVersion.slice(0, 18)}… · {new Date(handoff.createdAt).toLocaleString()}</NeonText>
      {handoff.notes.map((item) => <Surface key={item.id} padded style={styles.noteCard}><NeonText variant="label" tone="muted">{item.authorLabel.toUpperCase()}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{item.note}</NeonText></Surface>)}
      {(handoff.status === 'open' || handoff.status === 'accepted') ? (
        <View style={styles.noteRow}>
          <TextInput value={note} onChangeText={setNote} placeholder="Bounded handoff note" placeholderTextColor="#64748B" style={[styles.input, { flex: 1 }]} />
          <GlowButton label="Add note" variant="ghost" onPress={onNote} disabled={!note.trim()} />
        </View>
      ) : null}
      <View style={styles.actionRow}>
        {incoming && handoff.status === 'open' ? <><GlowButton label="Accept" variant="ghost" onPress={() => onStatus('accepted')} /><GlowButton label="Decline" variant="ghost" onPress={() => onStatus('declined')} /></> : null}
        {(incoming || outgoing) && handoff.status === 'accepted' ? <GlowButton label="Resolve" variant="ghost" onPress={() => onStatus('resolved')} /> : null}
        {outgoing && handoff.status === 'open' ? <GlowButton label="Withdraw" variant="ghost" onPress={() => onStatus('withdrawn')} /> : null}
      </View>
    </Surface>
  );
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, locked: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 40 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, section: { gap: spacing.sm }, choiceRow: { gap: spacing.sm }, choiceChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairline }, choiceChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(245,158,11,0.08)' }, smallCard: { borderRadius: radii.lg, borderColor: palette.hairline }, input: { borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: palette.text, backgroundColor: 'rgba(15,23,42,0.72)' }, multiline: { minHeight: 82, textAlignVertical: 'top' }, card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }, noteCard: { marginTop: spacing.sm, borderRadius: radii.lg, borderColor: palette.hairline }, noteRow: { marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, actionRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
