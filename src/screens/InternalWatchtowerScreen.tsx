import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useInternalOperator } from '../admin/useInternalOperator';
import {
  acknowledgeInternalGraphWatchEvent,
  loadInternalGraphWatchtower,
  saveInternalGraphWatchRule,
  setInternalGraphWatchRuleEnabled,
  type InternalGraphWatchEvent,
  type InternalGraphWatchtowerState,
} from '../admin/internalGraphWatchtower.service';
import { loadInternalGraphEventSequence, type InternalGraphEventSummary } from '../admin/internalGraph.service';
import { loadInternalGraphMachineRecipes } from '../admin/internalGraphMachineRegistry.service';
import type { InternalGraphMachineRecipeDefinition } from '../admin/InternalGraphMachineRecipeEngine';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Preset = {
  id: string;
  title: string;
  detail: string;
  create: (eventId: string | null, recipes: InternalGraphMachineRecipeDefinition[]) => Parameters<typeof saveInternalGraphWatchRule>[0] | null;
};

const PRESETS: Preset[] = [
  {
    id: 'fragility',
    title: 'Structural dependence spike',
    detail: 'Alert when articulation/bottleneck dependence reaches a level worth forensic review.',
    create: (eventId) => ({ title: 'Structural dependence ≥ 35%', eventId, ruleKind: 'metric_threshold', metricKey: 'structural_dependence', comparator: 'gte', threshold: 0.35, cooldownMinutes: 180 }),
  },
  {
    id: 'new-broker',
    title: 'New broker emergence',
    detail: 'Alert when at least one broker appears that was absent from the previous retained epoch.',
    create: (eventId) => ({ title: 'New broker emerged', eventId, ruleKind: 'metric_threshold', metricKey: 'new_broker_count', comparator: 'gte', threshold: 1, cooldownMinutes: 120 }),
  },
  {
    id: 'community-delta',
    title: 'Community count moved',
    detail: 'Alert when the community count changes materially between successive canonical epochs.',
    create: (eventId) => ({ title: 'Community count changed by ≥ 2', eventId, ruleKind: 'metric_delta', metricKey: 'community_count', threshold: 2, cooldownMinutes: 180 }),
  },
  {
    id: 'bridge-motif',
    title: 'Cross-community context bridges',
    detail: 'Alert when repeated real-world contexts are bridging otherwise separate communities.',
    create: (eventId) => ({ title: 'Cross-community context bridge motif ≥ 3', eventId, ruleKind: 'motif_threshold', motifKey: 'cross_community_context_bridge', comparator: 'gte', threshold: 3, cooldownMinutes: 180 }),
  },
  {
    id: 'machine-change',
    title: 'Private Machine result changed',
    detail: 'Alert when the newest sealed run of your first active private recipe produces a different result digest.',
    create: (eventId, recipes) => {
      const recipe = recipes.find((item) => item.enabled);
      return recipe ? { title: `Machine changed · ${recipe.title}`, eventId, ruleKind: 'machine_digest_changed', recipeId: recipe.id, cooldownMinutes: 60 } : null;
    },
  },
];

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.finalizedAt ?? event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricLabel(key: string | null): string {
  if (!key) return 'machine output';
  return key.replaceAll('_', ' ');
}

function ruleDescription(rule: InternalGraphWatchtowerState['rules'][number]): string {
  if (rule.ruleKind === 'machine_digest_changed') return 'private Machine result digest changed';
  if (rule.ruleKind === 'motif_threshold') return `${metricLabel(rule.motifKey)} ${rule.comparator === 'lte' ? '≤' : '≥'} ${rule.threshold ?? 0}`;
  if (rule.ruleKind === 'metric_delta') return `${metricLabel(rule.metricKey)} delta ≥ ${rule.threshold ?? 0}`;
  return `${metricLabel(rule.metricKey)} ${rule.comparator === 'lte' ? '≤' : '≥'} ${rule.threshold ?? 0}`;
}

function alertDestination(event: InternalGraphWatchEvent): { route: string; params?: object } {
  if (event.manifestId || event.conditionKey === 'machine_result_changed') return { route: 'InternalMachineRegistry' };
  if (event.conditionKey.includes('structural_dependence') || event.conditionKey.includes('articulation') || event.conditionKey.includes('critical_bridge')) {
    return { route: 'InternalForensicsLab', params: event.eventId ? { eventId: event.eventId } : undefined };
  }
  if (event.conditionKey.includes('community') || event.conditionKey.startsWith('motif:') || event.conditionKey.includes('broker')) {
    return { route: 'InternalEpochLab' };
  }
  return { route: 'InternalStrategyLab', params: event.eventId ? { eventId: event.eventId } : undefined };
}

export default function InternalWatchtowerScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const operator = useInternalOperator();
  const [state, setState] = useState<InternalGraphWatchtowerState | null>(null);
  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [recipes, setRecipes] = useState<InternalGraphMachineRecipeDefinition[]>([]);
  const [scopeEventId, setScopeEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    setLoading(true);
    try {
      const [watchtower, sequence, machineRecipes] = await Promise.all([
        loadInternalGraphWatchtower(),
        loadInternalGraphEventSequence(48),
        loadInternalGraphMachineRecipes(),
      ]);
      setState(watchtower);
      setEvents([...sequence.events].sort((a, b) => eventTime(b) - eventTime(a)));
      setRecipes(machineRecipes);
    } catch (error) {
      Alert.alert('Watchtower unavailable', error instanceof Error ? error.message : 'Unable to load structural watches.');
    } finally {
      setLoading(false);
    }
  }, [operator]);

  useEffect(() => { if (!operator.loading) void load(); }, [operator.loading, load]);
  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_manage')) return;
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [operator, load]);

  const unacknowledged = useMemo(() => state?.events.filter((event) => !event.acknowledgedAt) ?? [], [state]);
  const activeRules = useMemo(() => state?.rules.filter((rule) => rule.enabled) ?? [], [state]);

  const createPreset = async (preset: Preset) => {
    const input = preset.create(scopeEventId, recipes);
    if (!input) {
      Alert.alert('Recipe required', 'Create or enable a private Machine recipe before adding this Watchtower rule.');
      return;
    }
    setBusy(preset.id);
    try {
      await saveInternalGraphWatchRule(input);
      await load();
    } catch (error) {
      Alert.alert('Watch rejected', error instanceof Error ? error.message : 'Unable to save Watchtower rule.');
    } finally {
      setBusy(null);
    }
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    setBusy(ruleId);
    try {
      await setInternalGraphWatchRuleEnabled(ruleId, enabled);
      await load();
    } catch (error) {
      Alert.alert('Rule update rejected', error instanceof Error ? error.message : 'Unable to update Watchtower rule.');
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = async (event: InternalGraphWatchEvent) => {
    setBusy(event.id);
    try {
      await acknowledgeInternalGraphWatchEvent(event.id);
      await load();
    } catch (error) {
      Alert.alert('Acknowledgement rejected', error instanceof Error ? error.message : 'Unable to acknowledge Watchtower event.');
    } finally {
      setBusy(null);
    }
  };

  if (operator.loading || loading) {
    return <View style={styles.centered}><GridBackground /><ActivityIndicator color={palette.accent} size="large" /><NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>CALIBRATING WATCHTOWER</NeonText></View>;
  }

  if (!operator.allowed || !operator.has('graph_manage') || !state) {
    return <View style={styles.centered}><GridBackground /><Surface elevated padded style={styles.lockedCard}><Pill label="WATCHTOWER · SEALED" tone="neutral" dot /><NeonText variant="h1" style={{ marginTop: spacing.md }}>Graph management capability required.</NeonText></Surface></View>;
  }

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.1} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · EVENT-DRIVEN STRUCTURAL MONITORING" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Watchtower</NeonText>
              <NeonText variant="bodyMuted">Canonical Epoch signals · Machine digest changes · cooldown-aware internal review queue</NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}><NeonText variant="label" tone="muted">CLOSE</NeonText></Pressable>
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="WATCHTOWER AUTONOMY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>
              Watchtower monitors aggregate topology, motif state, and private Machine result digests. It cannot target a person, fetch external identity data, message users, create introductions, mutate relationships, or bypass blocks. Alerts are evidence for operator review—not autonomous decisions.
            </NeonText>
          </Surface>

          <View style={styles.metrics}>
            <Metric label="ACTIVE RULES" value={`${activeRules.length}`} />
            <Metric label="UNREVIEWED" value={`${unacknowledged.length}`} />
            <Metric label="TOTAL ALERTS" value={`${state.events.length}`} />
            <Metric label="RECIPES" value={`${recipes.filter((recipe) => recipe.enabled).length}`} />
          </View>

          <Section title="SCOPE" subtitle="Global watches compare successive retained epochs; event scope keeps the rule inside one event's evolving topology.">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Pressable onPress={() => setScopeEventId(null)} style={[styles.chip, scopeEventId == null && styles.chipActive]}><NeonText variant="label" tone={scopeEventId == null ? 'accent' : 'muted'}>GLOBAL</NeonText></Pressable>
              {events.slice(0, 16).map((event) => <Pressable key={event.eventId} onPress={() => setScopeEventId(event.eventId)} style={[styles.chip, scopeEventId === event.eventId && styles.chipActive]}><NeonText variant="label" tone={scopeEventId === event.eventId ? 'accent' : 'muted'}>{event.name.toUpperCase()}</NeonText></Pressable>)}
            </ScrollView>
          </Section>

          <Section title="WATCH PRESETS" subtitle="Opinionated structural conditions; every rule remains visible, reversible and cooldown-limited.">
            {PRESETS.map((preset) => <Surface key={preset.id} padded style={styles.card}>
              <View style={styles.rowBetween}><View style={{ flex: 1 }}><NeonText variant="h2">{preset.title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{preset.detail}</NeonText></View><GlowButton label={busy === preset.id ? 'Saving…' : 'Add'} disabled={busy != null} variant="ghost" onPress={() => createPreset(preset)} /></View>
            </Surface>)}
          </Section>

          <Section title="ACTIVE RULES" subtitle="Crossing semantics + cooldowns prevent a persistent condition from becoming alert spam.">
            {state.rules.map((rule) => <Surface key={rule.id} padded style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}><Pill label={rule.ruleKind.replaceAll('_', ' ').toUpperCase()} tone={rule.enabled ? 'accent' : 'neutral'} dot={rule.enabled} /><NeonText variant="h2" style={{ marginTop: 5 }}>{rule.title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{ruleDescription(rule)} · cooldown {rule.cooldownMinutes}m</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{rule.eventId ? 'event scoped' : 'global epoch sequence'}{rule.lastEvaluatedAt ? ` · evaluated ${new Date(rule.lastEvaluatedAt).toLocaleString()}` : ' · awaiting first evidence'}</NeonText></View>
                <GlowButton label={rule.enabled ? 'Pause' : 'Enable'} variant="ghost" disabled={busy != null} onPress={() => toggleRule(rule.id, !rule.enabled)} />
              </View>
            </Surface>)}
            {state.rules.length === 0 ? <NeonText variant="bodyMuted">No structural watches yet.</NeonText> : null}
          </Section>

          <Section title="REVIEW QUEUE" subtitle="Newest unacknowledged structural changes first; open the evidence surface that best explains the condition.">
            {[...state.events].sort((a, b) => Number(Boolean(a.acknowledgedAt)) - Number(Boolean(b.acknowledgedAt)) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((event) => {
              const rule = state.rules.find((item) => item.id === event.ruleId);
              const destination = alertDestination(event);
              return <Surface key={event.id} elevated padded style={[styles.alertCard, !event.acknowledgedAt && styles.alertActive]}>
                <View style={styles.rowBetween}><View style={{ flex: 1 }}><Pill label={event.acknowledgedAt ? 'REVIEWED' : 'NEW STRUCTURAL SIGNAL'} tone={event.acknowledgedAt ? 'neutral' : 'accent'} dot={!event.acknowledgedAt} /><NeonText variant="h2" style={{ marginTop: 5 }}>{rule?.title ?? event.conditionKey.replaceAll('_', ' ')}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{event.conditionKey.replaceAll('_', ' ')}{event.observedValue != null ? ` · ${event.previousValue ?? 'baseline'} → ${event.observedValue}` : ''}</NeonText><NeonText variant="label" tone="muted" style={{ marginTop: 5 }}>EVIDENCE {event.evidenceDigest.slice(0, 12)}… · {new Date(event.createdAt).toLocaleString()}</NeonText></View></View>
                <View style={styles.actions}><GlowButton label="Open evidence" variant="ghost" onPress={() => navigation.navigate(destination.route, destination.params)} />{!event.acknowledgedAt ? <GlowButton label={busy === event.id ? 'Saving…' : 'Acknowledge'} disabled={busy != null} variant="ghost" onPress={() => acknowledge(event)} /> : null}</View>
              </Surface>;
            })}
            {state.events.length === 0 ? <NeonText variant="bodyMuted">Watchtower has not emitted a retained alert yet.</NeonText> : null}
          </Section>

          <Surface padded style={styles.footerCard}>
            <Pill label="SIGNAL DISCIPLINE" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={styles.bodyGap}>A Watchtower event says a canonical structural condition changed. It does not say why a person behaved a certain way, whether an introduction should occur, or whether a topology change caused an outcome.</NeonText>
          </Surface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <View style={styles.metric}><NeonText variant="h2" tone="accent">{value}</NeonText><NeonText variant="label" tone="muted">{label}</NeonText></View>; }
function Section({ title, subtitle, children }: Readonly<{ title: string; subtitle: string; children: React.ReactNode }>) { return <View style={styles.section}><View><NeonText variant="label" tone="accent">{title}</NeonText><NeonText variant="bodyMuted" style={{ marginTop: 3 }}>{subtitle}</NeonText></View>{children}</View>; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#02050D' }, centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, lockedCard: { width: '100%', maxWidth: 560, borderRadius: radii.xl }, scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }, header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, title: { marginTop: spacing.sm, fontSize: 42 }, contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, bodyGap: { marginTop: spacing.sm, lineHeight: 19 }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, metric: { minWidth: 118, flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: palette.hairlineStrong, borderRadius: radii.lg, backgroundColor: palette.space }, section: { gap: spacing.sm }, chips: { gap: spacing.sm }, chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.space }, chipActive: { borderColor: palette.accent }, card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, alertCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong }, alertActive: { borderColor: palette.accent }, rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }, actions: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, footerCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
});
