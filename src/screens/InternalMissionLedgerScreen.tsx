import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  analyzeInternalGraph,
  type InternalGraphPayload,
} from '../admin/InternalGraphEngine';
import {
  runInternalGraphAgentOrchestrator,
} from '../admin/InternalGraphStrategyEngine';
import {
  getInternalBridgeSuppressions,
  loadInternalBridgePatternCalibration,
  loadInternalGraphEventSequence,
  loadInternalIntelligenceGraph,
  type InternalGraphEventSummary,
} from '../admin/internalGraph.service';
import {
  loadInternalAgentMissionLedger,
  setInternalAgentMissionStatus,
  syncInternalAgentMissions,
  type InternalAgentMissionLedger,
  type InternalAgentMissionLedgerEntry,
  type InternalAgentMissionSyncResult,
} from '../admin/internalAgentMission.service';
import { useInternalOperator } from '../admin/useInternalOperator';
import { GlowButton, GridBackground, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type MissionRoute = {
  InternalMissionLedger: { eventId?: string } | undefined;
};

function eventTime(event: InternalGraphEventSummary): number {
  const raw = event.endsAt ?? event.startsAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTone(status: InternalAgentMissionLedgerEntry['status']): 'accent' | 'neutral' | 'success' {
  return status === 'open' ? 'accent' : status === 'resolved' ? 'success' : 'neutral';
}

function nodeLabel(payload: InternalGraphPayload | null, nodeId: string): string {
  return payload?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

export default function InternalMissionLedgerScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<MissionRoute, 'InternalMissionLedger'>>();
  const operator = useInternalOperator();
  const requestedEventId = route.params?.eventId ?? null;

  const [events, setEvents] = useState<InternalGraphEventSummary[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(requestedEventId);
  const [current, setCurrent] = useState<InternalGraphPayload | null>(null);
  const [previous, setPrevious] = useState<InternalGraphPayload | null>(null);
  const [patterns, setPatterns] = useState<Awaited<ReturnType<typeof loadInternalBridgePatternCalibration>>['patterns']>([]);
  const [suppressions, setSuppressions] = useState<Set<string> | null>(null);
  const [ledger, setLedger] = useState<InternalAgentMissionLedger | null>(null);
  const [lastSync, setLastSync] = useState<InternalAgentMissionSyncResult | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyMissionId, setBusyMissionId] = useState<string | null>(null);
  const lastSyncFingerprint = useRef<string | null>(null);

  const loadContext = useCallback(async () => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    setLoading(true);
    try {
      const [sequence, patternCalibration, safeSuppressions] = await Promise.all([
        loadInternalGraphEventSequence(48),
        operator.has('graph_manage')
          ? loadInternalBridgePatternCalibration()
          : Promise.resolve({ generatedAt: new Date().toISOString(), patterns: [], attributionNote: '' }),
        operator.has('graph_manage') ? getInternalBridgeSuppressions() : Promise.resolve(new Set<string>()),
      ]);

      const ordered = [...sequence.events].sort((left, right) => eventTime(right) - eventTime(left));
      const selectedId = currentEventId ?? requestedEventId ?? ordered[0]?.eventId ?? null;
      setEvents(ordered);
      setCurrentEventId(selectedId);
      setPatterns(patternCalibration.patterns);
      setSuppressions(safeSuppressions);

      const selectedIndex = selectedId ? ordered.findIndex((event) => event.eventId === selectedId) : -1;
      const previousId = selectedIndex >= 0 ? ordered[selectedIndex + 1]?.eventId ?? null : null;
      const [nextCurrent, nextPrevious, nextLedger] = await Promise.all([
        loadInternalIntelligenceGraph({ eventId: selectedId, includeRestricted: false, limit: 1500 }),
        previousId
          ? loadInternalIntelligenceGraph({ eventId: previousId, includeRestricted: false, limit: 1500 })
          : Promise.resolve(null),
        loadInternalAgentMissionLedger(selectedId, 180),
      ]);
      setCurrent(nextCurrent);
      setPrevious(nextPrevious);
      setLedger(nextLedger);
    } catch (error) {
      setSuppressions(null);
      Alert.alert('Mission Ledger unavailable', error instanceof Error ? error.message : 'Unable to load persistent agent memory.');
    } finally {
      setLoading(false);
    }
  }, [operator, currentEventId, requestedEventId]);

  useEffect(() => {
    if (!operator.loading) loadContext();
  }, [operator.loading, loadContext]);

  useEffect(() => {
    if (!operator.allowed || !operator.has('graph_read')) return;
    const timer = setInterval(loadContext, 60_000);
    return () => clearInterval(timer);
  }, [operator, loadContext]);

  const analysis = useMemo(() => current ? analyzeInternalGraph(current) : null, [current]);

  useEffect(() => {
    if (!analysis || !current) return;
    if (sourceNodeId && current.nodes.some((node) => node.id === sourceNodeId)) return;
    setSourceNodeId(
      analysis.brokerNodeIds[0]
      ?? analysis.hubNodeIds[0]
      ?? current.nodes.find((node) => node.kind === 'person')?.id
      ?? null,
    );
  }, [analysis, current, sourceNodeId]);

  const agentRun = useMemo(
    () => current && suppressions
      ? runInternalGraphAgentOrchestrator({
          current,
          previous,
          patterns,
          suppressions,
          targetQuery: targetQuery.trim() || null,
          sourceNodeId,
        })
      : null,
    [current, previous, patterns, suppressions, targetQuery, sourceNodeId],
  );

  const syncLedger = useCallback(async (force = false) => {
    if (!operator.has('graph_manage') || !current || !agentRun) return;
    const fingerprint = [
      currentEventId ?? 'global',
      current.graphVersion,
      targetQuery.trim().toLowerCase(),
      ...agentRun.missions.map((mission) => `${mission.id}:${mission.priority.toFixed(4)}`),
    ].join('|');
    if (!force && lastSyncFingerprint.current === fingerprint) return;

    setSyncing(true);
    try {
      const result = await syncInternalAgentMissions({
        eventId: currentEventId,
        objective: targetQuery.trim() || null,
        graphVersion: current.graphVersion,
        missions: agentRun.missions,
      });
      lastSyncFingerprint.current = fingerprint;
      setLastSync(result);
      setLedger(await loadInternalAgentMissionLedger(currentEventId, 180));
    } catch (error) {
      if (force) {
        Alert.alert('Mission sync rejected', error instanceof Error ? error.message : 'Unable to persist agent mission memory.');
      }
    } finally {
      setSyncing(false);
    }
  }, [operator, current, agentRun, currentEventId, targetQuery]);

  useEffect(() => {
    if (!agentRun || !current) return;
    void syncLedger(false);
  }, [agentRun, current, syncLedger]);

  const changeStatus = async (
    mission: InternalAgentMissionLedgerEntry,
    status: 'open' | 'acknowledged' | 'dismissed',
  ) => {
    setBusyMissionId(mission.id);
    try {
      await setInternalAgentMissionStatus(mission.id, status);
      setLedger(await loadInternalAgentMissionLedger(currentEventId, 180));
    } catch (error) {
      Alert.alert('Mission state rejected', error instanceof Error ? error.message : 'Unable to update mission memory.');
    } finally {
      setBusyMissionId(null);
    }
  };

  const visibleMissions = useMemo(() => {
    const rows = ledger?.missions ?? [];
    return [...rows].sort((left, right) => {
      const statusRank = (status: InternalAgentMissionLedgerEntry['status']) =>
        status === 'open' ? 0 : status === 'acknowledged' ? 1 : status === 'resolved' ? 2 : 3;
      return statusRank(left.status) - statusRank(right.status)
        || right.priority - left.priority
        || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    });
  }, [ledger]);

  if (operator.loading || loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <ActivityIndicator color={palette.accent} size="large" />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
          RECONCILING AGENT MEMORY
        </NeonText>
      </View>
    );
  }

  if (!operator.allowed || !operator.has('graph_read') || !current || !agentRun || !suppressions) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded style={styles.lockedCard}>
          <Pill label="MISSION LEDGER · SEALED" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Operator graph access required.</NeonText>
        </Surface>
      </View>
    );
  }

  const activeCount = visibleMissions.filter((mission) => mission.status === 'open' || mission.status === 'acknowledged').length;
  const persistentCount = visibleMissions.filter((mission) => mission.seenCount >= 3 && mission.status !== 'dismissed').length;
  const reopenedCount = visibleMissions.filter((mission) => mission.reopenedCount > 0).length;

  return (
    <View style={styles.container}>
      <GridBackground intensity={0.12} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Pill label="INTERNAL · PERSISTENT AGENT MEMORY" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={styles.title}>Mission Ledger</NeonText>
              <NeonText variant="bodyMuted">
                Persistent strategic holes · revision memory · reappearance detection · human-reviewed mission state
              </NeonText>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CLOSE</NeonText>
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRow}>
            {events.slice(0, 16).map((event) => (
              <Pressable
                key={event.eventId}
                onPress={() => {
                  lastSyncFingerprint.current = null;
                  setCurrentEventId(event.eventId);
                }}
                style={[styles.eventChip, currentEventId === event.eventId && styles.eventChipActive]}
              >
                <NeonText variant="label" tone={currentEventId === event.eventId ? 'accent' : 'muted'}>
                  {event.name.toUpperCase()}
                </NeonText>
                <NeonText variant="bodyMuted">{event.participantCount} people · {event.mutualCount} mutuals</NeonText>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.actionRow}>
            <GlowButton label="Strategy Lab" variant="ghost" onPress={() => navigation.navigate('InternalStrategyLab', { eventId: currentEventId ?? undefined })} />
            <GlowButton label="Forensics" variant="ghost" onPress={() => navigation.navigate('InternalForensicsLab')} />
            <GlowButton label="Casebook" variant="ghost" onPress={() => navigation.navigate('InternalCasebook')} />
            {operator.has('graph_manage') ? (
              <GlowButton label={syncing ? 'Syncing…' : 'Sync agents'} disabled={syncing} variant="ghost" onPress={() => syncLedger(true)} />
            ) : null}
          </View>

          <View style={styles.metricRow}>
            <Metric label="ACTIVE" value={`${activeCount}`} />
            <Metric label="PERSISTENT" value={`${persistentCount}`} />
            <Metric label="REOPENED" value={`${reopenedCount}`} />
            <Metric label="LIVE AGENTS" value={`${agentRun.missionCount}`} />
          </View>

          <Surface padded style={styles.contractCard}>
            <Pill label="MISSION AUTONOMY CONTRACT" tone="neutral" dot />
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 19 }}>
              Agents may detect, diff, re-rank and persist internal analytical missions. They cannot message users, create introductions, bypass blocks, or mutate relationship evidence. A mission disappears only after two consecutive misses; any social action remains explicitly human-approved.
            </NeonText>
          </Surface>

          {operator.has('graph_manage') ? (
            <Surface padded style={styles.syncCard}>
              <Pill label="LATEST MEMORY RECONCILIATION" tone="accent" dot />
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
                {lastSync
                  ? `new ${lastSync.createdCount} · revised ${lastSync.revisedCount} · reopened ${lastSync.reopenedCount} · active ${lastSync.activeCount}`
                  : 'This scope has not produced a new mission-ledger delta during the current session.'}
              </NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
                Raw target-objective text is not retained in mission memory; only a digest scopes objective-specific mission history.
              </NeonText>
            </Surface>
          ) : null}

          <TextInput
            value={targetQuery}
            onChangeText={(value) => {
              lastSyncFingerprint.current = null;
              setTargetQuery(value);
            }}
            placeholder="Optional target ecosystem for Pathfinder…"
            placeholderTextColor="#64748B"
            style={styles.input}
            autoCapitalize="none"
          />
          {sourceNodeId ? (
            <NeonText variant="bodyMuted">Pathfinder anchor: {nodeLabel(current, sourceNodeId)}</NeonText>
          ) : null}

          <Section title="PERSISTENT MISSION MEMORY" subtitle="Strategic conditions that survived, changed, disappeared, or reappeared across graph refreshes">
            {visibleMissions.map((mission) => (
              <Surface key={mission.id} elevated padded style={styles.missionCard}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Pill label={mission.agent.toUpperCase()} tone="accent" dot />
                    <NeonText variant="h2" style={{ marginTop: spacing.sm }}>{mission.title}</NeonText>
                    <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>{mission.thesis}</NeonText>
                  </View>
                  <Pill label={mission.status.toUpperCase()} tone={statusTone(mission.status)} />
                </View>

                <View style={styles.metricRow}>
                  <Metric label="PRIORITY" value={mission.priority.toFixed(1)} />
                  <Metric label="SEEN" value={`${mission.seenCount}`} />
                  <Metric label="REVISED" value={`${mission.revisionCount}`} />
                  <Metric label="REOPENED" value={`${mission.reopenedCount}`} />
                </View>

                {mission.evidence.slice(0, 8).map((evidence, index) => (
                  <NeonText key={`${mission.id}-e-${index}`} variant="bodyMuted" style={{ marginTop: 3 }}>• {evidence}</NeonText>
                ))}
                <NeonText variant="body" style={{ marginTop: spacing.sm }}>{mission.recommendedAction}</NeonText>

                {operator.has('graph_manage') ? (
                  <View style={styles.actionRow}>
                    {mission.status !== 'acknowledged' ? (
                      <GlowButton
                        label="Acknowledge"
                        variant="ghost"
                        disabled={busyMissionId != null}
                        onPress={() => changeStatus(mission, 'acknowledged')}
                      />
                    ) : null}
                    {mission.status !== 'dismissed' ? (
                      <GlowButton
                        label="Dismiss"
                        variant="ghost"
                        disabled={busyMissionId != null}
                        onPress={() => changeStatus(mission, 'dismissed')}
                      />
                    ) : null}
                    {(mission.status === 'dismissed' || mission.status === 'resolved') ? (
                      <GlowButton
                        label="Reopen"
                        variant="ghost"
                        disabled={busyMissionId != null}
                        onPress={() => changeStatus(mission, 'open')}
                      />
                    ) : null}
                  </View>
                ) : null}
              </Surface>
            ))}
            {visibleMissions.length === 0 ? (
              <NeonText variant="bodyMuted">No retained mission memory exists in this scope yet.</NeonText>
            ) : null}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <View style={styles.metric}>
      <NeonText variant="h2" tone="accent">{value}</NeonText>
      <NeonText variant="label" tone="muted">{label}</NeonText>
    </View>
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
  container: { flex: 1, backgroundColor: '#02050D' },
  centered: { flex: 1, backgroundColor: '#02050D', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  lockedCard: { width: '100%', maxWidth: 520, borderRadius: radii.xl },
  scroll: { padding: spacing.lg, paddingBottom: 110, gap: spacing.lg },
  header: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { marginTop: spacing.sm, fontSize: 38 },
  eventRow: { gap: spacing.sm, paddingRight: spacing.lg },
  eventChip: { minWidth: 180, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.62)' },
  eventChipActive: { borderColor: palette.accent, backgroundColor: 'rgba(25,35,70,0.88)' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metric: { flex: 1, minWidth: 76, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline, backgroundColor: 'rgba(15,23,42,0.7)' },
  contractCard: { borderRadius: radii.xl, borderColor: palette.hairlineStrong },
  syncCard: { borderRadius: radii.xl, borderColor: palette.accent },
  input: { minHeight: 46, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, color: palette.text, paddingHorizontal: spacing.md, backgroundColor: 'rgba(15,23,42,0.72)' },
  section: { gap: spacing.sm },
  missionCard: { borderRadius: radii.xl },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
});
