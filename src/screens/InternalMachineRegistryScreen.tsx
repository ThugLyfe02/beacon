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
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { INTERNAL_GRAPH_MACHINES } from '../admin/InternalGraphMachineEngine';
import {
  internalGraphMachineRecipeRequirements,
  runInternalGraphMachineRecipe,
  type InternalGraphMachineRecipeDefinition,
} from '../admin/InternalGraphMachineRecipeEngine';
import {
  loadInternalGraphMachineRecipes,
  loadInternalGraphMachineRunManifests,
  recordInternalGraphMachineRun,
  saveInternalGraphMachineRecipe,
  setInternalGraphMachineRecipeEnabled,
  type InternalGraphMachineRunManifest,
} from '../admin/internalGraphMachineRegistry.service';
import {
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import { analyzeInternalGraph, type InternalGraphPayload } from '../admin/InternalGraphEngine';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function recipeDelta(manifests: InternalGraphMachineRunManifest[]) {
  if (manifests.length < 2) return null;
  const current = manifests[0];
  const previous = manifests[1];
  return {
    identical: current.resultDigest === previous.resultDigest,
    nodes: current.finalNodeCount - previous.finalNodeCount,
    edges: current.finalEdgeCount - previous.finalEdgeCount,
    questions: current.questionCount - previous.questionCount,
    traceSteps: current.traceStepCount - previous.traceStepCount,
  };
}

export default function InternalMachineRegistryScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);
  const [current, setCurrent] = useState<InternalGraphPayload | null>(null);
  const [previous, setPrevious] = useState<InternalGraphPayload | null>(null);
  const [recipes, setRecipes] = useState<InternalGraphMachineRecipeDefinition[]>([]);
  const [manifests, setManifests] = useState<InternalGraphMachineRunManifest[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>(['broker-xray', 'bridge-emergence']);
  const [seedNodeId, setSeedNodeId] = useState<string | null>(null);
  const [seedQuery, setSeedQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [sequence, nextRecipes, nextManifests] = await Promise.all([
        loadInternalGraphEventSequence(48),
        loadInternalGraphMachineRecipes(),
        loadInternalGraphMachineRunManifests(null, 120),
      ]);
      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedEventId = currentEventId ?? ordered[0]?.eventId ?? null;
      const selectedIndex = selectedEventId ? ordered.findIndex((event) => event.eventId === selectedEventId) : -1;
      const previousId = selectedIndex >= 0 ? ordered[selectedIndex + 1]?.eventId ?? null : null;
      const [nextCurrent, nextPrevious] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId: selectedEventId, includeRestricted: false, limit: 1800 }),
        previousId
          ? loadInternalIntelligenceGraph({ eventId: previousId, includeRestricted: false, limit: 1800 })
          : Promise.resolve(null),
      ]);

      setEvents(ordered);
      setCurrentEventId(selectedEventId);
      setRecipes(nextRecipes);
      setManifests(nextManifests);
      setCurrent(nextCurrent);
      setPrevious(nextPrevious);
      setSelectedRecipeId((existing) => {
        if (existing && nextRecipes.some((recipe) => recipe.id === existing)) return existing;
        return nextRecipes.find((recipe) => recipe.enabled)?.id ?? null;
      });
      setSeedNodeId((existing) => {
        if (existing && nextCurrent.nodes.some((node) => node.id === existing)) return existing;
        const analysis = analyzeInternalGraph(nextCurrent);
        return analysis.brokerNodeIds[0]
          ?? nextCurrent.nodes.find((node) => node.kind === 'person')?.id
          ?? nextCurrent.nodes[0]?.id
          ?? null;
      });
    } catch (error) {
      Alert.alert('Machine Registry unavailable', error instanceof Error ? error.message : 'Unable to assemble private Machine registry state.');
    } finally {
      setLoading(false);
    }
  }, [operator, currentEventId]);

  useEffect(() => {
    if (!operator.loading) load();
  }, [operator.loading, load]);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  );
  const requirements = useMemo(
    () => selectedRecipe ? internalGraphMachineRecipeRequirements(selectedRecipe.machineIds) : null,
    [selectedRecipe],
  );
  const seedResults = useMemo(() => {
    if (!current) return [];
    const query = seedQuery.trim().toLowerCase();
    const rows = query
      ? current.nodes.filter((node) => node.label.toLowerCase().includes(query) || node.kind.toLowerCase().includes(query))
      : current.nodes.filter((node) => node.kind === 'person');
    return rows.slice(0, 16);
  }, [current, seedQuery]);

  const recipeRun = useMemo(() => {
    if (!selectedRecipe || !current || !requirements) return null;
    if (requirements.requiresSeed && !seedNodeId) return null;
    if (requirements.requiresTargetQuery && !targetQuery.trim()) return null;
    if (requirements.requiresPreviousGraph && !previous) return null;
    try {
      return runInternalGraphMachineRecipe(selectedRecipe, {
        current,
        previous,
        seedNodeId,
        targetQuery,
      });
    } catch {
      return null;
    }
  }, [selectedRecipe, current, previous, requirements, seedNodeId, targetQuery]);

  const selectedManifests = useMemo(
    () => manifests.filter((manifest) => manifest.recipeId === selectedRecipeId),
    [manifests, selectedRecipeId],
  );
  const delta = useMemo(() => recipeDelta(selectedManifests), [selectedManifests]);

  const toggleMachine = (machineId: string) => {
    setSelectedMachineIds((currentIds) => {
      if (currentIds.includes(machineId)) {
        if (currentIds.length === 1) return currentIds;
        return currentIds.filter((id) => id !== machineId);
      }
      if (currentIds.length >= 6) return currentIds;
      return [...currentIds, machineId];
    });
  };

  const saveRecipe = async () => {
    if (!title.trim()) {
      Alert.alert('Recipe title required', 'Give the private Machine pipeline a short operator-facing name.');
      return;
    }
    setBusy(true);
    try {
      const saved = await saveInternalGraphMachineRecipe({
        title,
        description,
        machineIds: selectedMachineIds,
      });
      setTitle('');
      setDescription('');
      setSelectedRecipeId(saved.id);
      await load();
    } catch (error) {
      Alert.alert('Recipe save failed', error instanceof Error ? error.message : 'Unable to save private Machine recipe.');
    } finally {
      setBusy(false);
    }
  };

  const archiveRecipe = async (recipe: InternalGraphMachineRecipeDefinition) => {
    setBusy(true);
    try {
      await setInternalGraphMachineRecipeEnabled(recipe.id, !recipe.enabled);
      await load();
    } catch (error) {
      Alert.alert('Recipe update failed', error instanceof Error ? error.message : 'Unable to update private Machine recipe.');
    } finally {
      setBusy(false);
    }
  };

  const sealManifest = async () => {
    if (!selectedRecipe || !recipeRun) return;
    setBusy(true);
    try {
      const manifest = await recordInternalGraphMachineRun({
        recipe: selectedRecipe,
        run: recipeRun,
        eventId: currentEventId,
        seedNodeId,
        targetQuery,
      });
      const next = await loadInternalGraphMachineRunManifests(null, 120);
      setManifests(next);
      Alert.alert(
        'Machine run sealed',
        `manifest ${manifest.resultDigest.slice(0, 12)}… · ${manifest.finalNodeCount} nodes · ${manifest.finalEdgeCount} edges`,
      );
    } catch (error) {
      Alert.alert('Manifest failed', error instanceof Error ? error.message : 'Unable to seal this Machine run.');
    } finally {
      setBusy(false);
    }
  };

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>LOADING PRIVATE MACHINE REGISTRY</NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_manage') || !current) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="MACHINE REGISTRY · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · PRIVATE MACHINE REGISTRY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Machine Registry</NeonText>
              <NeonText variant="bodyMuted">Saved pipelines · deterministic replay · digest-only run manifests · topology-change verification</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="REGISTRY PRIVACY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Recipes contain audited Machine ids only—not scripts, URLs, contacts, external enrichment endpoints, seed people, or target text. Run history stores hashes and topology counts; seed/objective inputs are reduced to SHA-256 digests before persistence.
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
            <GlowButton label="Machine Lab" variant="ghost" onPress={() => navigation.navigate('InternalMachineLab', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Mission Ledger" variant="ghost" onPress={() => navigation.navigate('InternalMissionLedger', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Refresh" variant="ghost" disabled={busy} onPress={load} />
          </View>

          <Section title="COMPOSE PRIVATE PIPELINE" subtitle="Order is preserved. Up to six audited Machines may be composed into one reusable recipe.">
            <TextInput value={title} onChangeText={setTitle} placeholder="Recipe name…" placeholderTextColor="#64748B" style={styles.input} />
            <TextInput value={description} onChangeText={setDescription} placeholder="Optional purpose / operator note…" placeholderTextColor="#64748B" style={styles.input} />
            <View style={styles.machineGrid}>
              {INTERNAL_GRAPH_MACHINES.map((machine) => {
                const selected = selectedMachineIds.includes(machine.id);
                const position = selectedMachineIds.indexOf(machine.id);
                return (
                  <Pressable key={machine.id} onPress={() => toggleMachine(machine.id)} style={[styles.machineButton, selected && styles.machineButtonActive]}>
                    <NeonText variant="label" tone={selected ? 'accent' : 'muted'}>{selected ? `${position + 1}. ` : ''}{machine.title.toUpperCase()}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{machine.steps.length} audited steps</NeonText>
                  </Pressable>
                );
              })}
            </View>
            <GlowButton label={busy ? 'Saving…' : 'Save private recipe'} variant="primary" disabled={busy || selectedMachineIds.length === 0} onPress={saveRecipe} />
          </Section>

          <Section title="PRIVATE RECIPES" subtitle="Only recipes created by the current operator are returned by the registry RPC.">
            {recipes.map((recipe) => (
              <Pressable key={recipe.id} onPress={() => setSelectedRecipeId(recipe.id)}>
                <Surface elevated padded style={[styles.recipeCard, selectedRecipeId === recipe.id && styles.recipeCardActive]}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{recipe.title}</NeonText>
                      <NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{recipe.machineIds.map((id) => INTERNAL_GRAPH_MACHINES.find((machine) => machine.id === id)?.title ?? id).join(' → ')}</NeonText>
                    </View>
                    <Pill label={recipe.enabled ? 'ACTIVE' : 'ARCHIVED'} tone={recipe.enabled ? 'accent' : 'neutral'} />
                  </View>
                  {recipe.description ? <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>{recipe.description}</NeonText> : null}
                  <NeonText variant="label" tone="muted" style={{ marginTop: spacing.sm }}>HASH {recipe.recipeHash.slice(0, 14)}… · {recipe.machineIds.length} STAGES</NeonText>
                  <View style={styles.actionRow}>
                    <GlowButton label={recipe.enabled ? 'Archive' : 'Restore'} variant="ghost" disabled={busy} onPress={() => archiveRecipe(recipe)} />
                  </View>
                </Surface>
              </Pressable>
            ))}
            {recipes.length === 0 ? <NeonText variant="bodyMuted">No private Machine recipe has been saved yet.</NeonText> : null}
          </Section>

          {selectedRecipe && requirements ? (
            <>
              <Section title="REPLAY INPUTS" subtitle="Inputs are explicit per run and never embedded in the saved recipe.">
                {requirements.requiresSeed ? (
                  <>
                    <TextInput value={seedQuery} onChangeText={setSeedQuery} placeholder="Search seed node…" placeholderTextColor="#64748B" style={styles.input} />
                    <View style={styles.seedGrid}>
                      {seedResults.map((node) => (
                        <Pressable key={node.id} onPress={() => { setSeedNodeId(node.id); setSeedQuery(''); }} style={[styles.seedButton, seedNodeId === node.id && styles.seedButtonActive]}>
                          <NeonText variant="body">{node.label}</NeonText>
                          <NeonText variant="label" tone="muted">{node.kind.toUpperCase()}</NeonText>
                        </Pressable>
                      ))}
                    </View>
                    {seedNodeId ? <NeonText variant="bodyMuted">Seed: {nodeLabel(current, seedNodeId)}</NeonText> : null}
                  </>
                ) : null}
                {requirements.requiresTargetQuery ? (
                  <TextInput value={targetQuery} onChangeText={setTargetQuery} placeholder="Target ecosystem for this replay…" placeholderTextColor="#64748B" style={styles.input} autoCapitalize="none" />
                ) : null}
                {requirements.requiresPreviousGraph && !previous ? <NeonText variant="bodyMuted">This pipeline needs a previous retained event graph.</NeonText> : null}
              </Section>

              {recipeRun ? (
                <>
                  <View style={styles.metricRow}>
                    <Metric label="STAGES" value={`${recipeRun.stageCount}`} />
                    <Metric label="TRACE" value={`${recipeRun.traceStepCount}`} />
                    <Metric label="NODES" value={`${recipeRun.finalNodeIds.length}`} />
                    <Metric label="EDGES" value={`${recipeRun.finalEdgeIds.length}`} />
                  </View>
                  <Surface padded style={styles.runCard}>
                    <Pill label="LIVE RECIPE REPLAY" tone="accent" dot />
                    <NeonText variant="h1" style={{ marginTop: spacing.sm }}>{recipeRun.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>{recipeRun.operatingRule}</NeonText>
                    {recipeRun.stages.map((stage, index) => (
                      <View key={`${recipeRun.recipeId}-${stage.machineId}-${index}`} style={styles.stageRow}>
                        <NeonText variant="label" tone="accent">{index + 1}. {stage.title.toUpperCase()}</NeonText>
                        <NeonText variant="bodyMuted">{stage.run.trace.length} steps · {stage.run.finalNodeIds.length} nodes · {stage.run.finalEdgeIds.length} edges</NeonText>
                      </View>
                    ))}
                    <GlowButton label={busy ? 'Sealing…' : 'Seal reproducible run manifest'} variant="primary" disabled={busy} onPress={sealManifest} />
                  </Surface>
                </>
              ) : (
                <NeonText variant="bodyMuted">Provide every required replay input to execute this private recipe.</NeonText>
              )}
            </>
          ) : null}

          <Section title="REPRODUCIBILITY LEDGER" subtitle="Compare the same private recipe across graph versions without retaining raw people/objective inputs.">
            {delta ? (
              <Surface padded style={styles.deltaCard}>
                <Pill label={delta.identical ? 'IDENTICAL RESULT DIGEST' : 'TOPOLOGY RESULT CHANGED'} tone={delta.identical ? 'neutral' : 'accent'} dot={!delta.identical} />
                <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                  Δ nodes {delta.nodes >= 0 ? '+' : ''}{delta.nodes} · Δ edges {delta.edges >= 0 ? '+' : ''}{delta.edges} · Δ questions {delta.questions >= 0 ? '+' : ''}{delta.questions} · Δ trace {delta.traceSteps >= 0 ? '+' : ''}{delta.traceSteps}
                </NeonText>
              </Surface>
            ) : null}
            {selectedManifests.slice(0, 16).map((manifest) => (
              <Surface key={manifest.id} padded style={styles.manifestCard}>
                <View style={styles.rowBetween}>
                  <NeonText variant="label" tone="accent">{new Date(manifest.createdAt).toLocaleString()}</NeonText>
                  <Pill label={`${manifest.stageCount} STAGES`} tone="neutral" />
                </View>
                <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                  graph {manifest.graphVersion.slice(0, 16)}… · result {manifest.resultDigest.slice(0, 16)}…
                </NeonText>
                <NeonText variant="bodyMuted">{manifest.finalNodeCount} nodes · {manifest.finalEdgeCount} edges · {manifest.questionCount} questions</NeonText>
                <NeonText variant="label" tone="muted">SEED {manifest.seedDigest ? 'DIGESTED' : 'NONE'} · OBJECTIVE {manifest.objectiveDigest ? 'DIGESTED' : 'NONE'}</NeonText>
              </Surface>
            ))}
            {selectedRecipe && selectedManifests.length === 0 ? <NeonText variant="bodyMuted">No sealed manifest exists for this recipe yet.</NeonText> : null}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return <View style={styles.metric}><NeonText variant="h1" tone="accent" glow>{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>;
}

function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) {
  return <View style={{ gap: spacing.sm }}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { marginTop: spacing.sm, fontSize: 38 },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  eventRow: { gap: spacing.sm },
  eventChip: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, minWidth: 150 },
  eventChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.72)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  input: { minHeight: 46, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, color: palette.text, paddingHorizontal: spacing.md, backgroundColor: 'rgba(15,23,42,0.78)' },
  machineGrid: { gap: spacing.sm },
  machineButton: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline },
  machineButtonActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.72)' },
  recipeCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  recipeCardActive: { borderColor: palette.accent },
  seedGrid: { gap: spacing.sm },
  seedButton: { padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline },
  seedButtonActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.72)' },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flex: 1, minWidth: 82, minHeight: 74, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.74)' },
  runCard: { borderRadius: radii.xl, borderColor: palette.accent },
  stageRow: { marginTop: spacing.md, gap: 3 },
  deltaCard: { borderRadius: radii.xl, borderColor: palette.accent },
  manifestCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
});
