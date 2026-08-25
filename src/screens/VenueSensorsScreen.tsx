import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { getActiveVenueOperationsRelease } from '../services/venue-release.service';
import {
  listVenueSensorSources,
  provisionVenueSensorSource,
  revokeVenueSensorSource,
  rotateVenueSensorSourceToken,
  type ProvisionedVenueSensor,
  type VenueSensorKind,
  type VenueSensorSourceRow,
} from '../services/venue-sensor.service';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type VenueSensorsParams = { VenueSensors: { eventId: string } };

const SENSOR_KINDS: Array<{ kind: VenueSensorKind; label: string }> = [
  { kind: 'ble', label: 'BLE' },
  { kind: 'wifi', label: 'Wi-Fi' },
  { kind: 'camera', label: 'Camera' },
  { kind: 'edge', label: 'Edge' },
  { kind: 'other', label: 'Other' },
];

function ageLabel(value: string | null): string {
  if (!value) return 'never';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function sensorState(source: VenueSensorSourceRow): 'live' | 'stale' | 'offline' | 'revoked' {
  if (!source.active || source.revoked_at) return 'revoked';
  if (!source.last_received_at) return 'offline';
  const receivedAt = Date.parse(source.last_received_at);
  if (!Number.isFinite(receivedAt)) return 'offline';
  const ageMs = Date.now() - receivedAt;
  if (ageMs <= 60_000) return 'live';
  if (ageMs <= 5 * 60_000) return 'stale';
  return 'offline';
}

function stateTone(state: ReturnType<typeof sensorState>): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'live') return 'success';
  if (state === 'stale') return 'warning';
  if (state === 'revoked') return 'danger';
  return 'neutral';
}

export default function VenueSensorsScreen() {
  const route = useRoute<RouteProp<VenueSensorsParams, 'VenueSensors'>>();
  const { eventId } = route.params;
  const [sources, setSources] = useState<VenueSensorSourceRow[]>([]);
  const [layoutVersion, setLayoutVersion] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [sourceKey, setSourceKey] = useState('');
  const [sourceKind, setSourceKind] = useState<VenueSensorKind>('edge');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<ProvisionedVenueSensor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [release, roster] = await Promise.all([
        getActiveVenueOperationsRelease(eventId),
        listVenueSensorSources(eventId),
      ]);
      if (roster.error) throw new Error(roster.error.message);
      setSources(roster.data);
      setLayoutVersion(release.data?.layoutVersion ?? null);
      setReleaseId(release.data?.releaseId ?? null);
      if (release.error && !release.data) setError('No active venue operations release is available for new sensor provisioning.');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load venue sensor sources.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const counts = useMemo(() => {
    const states = sources.map(sensorState);
    return {
      live: states.filter((state) => state === 'live').length,
      stale: states.filter((state) => state === 'stale').length,
      offline: states.filter((state) => state === 'offline').length,
      revoked: states.filter((state) => state === 'revoked').length,
    };
  }, [sources]);

  const provision = useCallback(async () => {
    if (!layoutVersion) {
      Alert.alert('Release required', 'Pin an active venue operations release before provisioning sensor sources.');
      return;
    }
    const key = sourceKey.trim();
    if (key.length < 2) {
      Alert.alert('Source name required', 'Use a stable source name such as north-entry-ble or checkin-edge-01.');
      return;
    }

    setWorking(true);
    try {
      const result = await provisionVenueSensorSource({
        eventId,
        sourceKey: key,
        sourceKind,
        layoutVersion,
      });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'Sensor source was not provisioned.');
      setIssuedCredential(result.data);
      setSourceKey('');
      await load();
    } catch (provisionError) {
      Alert.alert('Provisioning failed', provisionError instanceof Error ? provisionError.message : 'Could not provision sensor source.');
    } finally {
      setWorking(false);
    }
  }, [eventId, layoutVersion, load, sourceKey, sourceKind]);

  const rotate = useCallback((source: VenueSensorSourceRow) => {
    Alert.alert(
      'Rotate sensor credential?',
      'The current device token will stop working immediately. The replacement is shown once and is not persisted by Beacon.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: async () => {
            setWorking(true);
            try {
              const result = await rotateVenueSensorSourceToken(source.source_id);
              if (result.error || !result.data) throw new Error(result.error?.message ?? 'Credential rotation failed.');
              setIssuedCredential(result.data);
              await load();
            } catch (rotateError) {
              Alert.alert('Rotation failed', rotateError instanceof Error ? rotateError.message : 'Could not rotate the credential.');
            } finally {
              setWorking(false);
            }
          },
        },
      ],
    );
  }, [load]);

  const revoke = useCallback((source: VenueSensorSourceRow) => {
    Alert.alert(
      'Revoke sensor source?',
      `${source.source_key} will stop accepting new observations. Existing aggregate evidence remains available under retention and audit rules.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setWorking(true);
            try {
              const result = await revokeVenueSensorSource(source.source_id);
              if (result.error || !result.revoked) throw new Error(result.error?.message ?? 'Sensor source was not revoked.');
              await load();
            } catch (revokeError) {
              Alert.alert('Revocation failed', revokeError instanceof Error ? revokeError.message : 'Could not revoke the source.');
            } finally {
              setWorking(false);
            }
          },
        },
      ],
    );
  }, [load]);

  if (loading && sources.length === 0) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading sensor sources
        </NeonText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <GridBackground intensity={0.34} />

      <View style={styles.hero}>
        <Pill label="Physical data plane" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>Sensor sources</NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          Provision independent aggregate inputs without handing sensors a user session. Every source gets a unique revocable credential, bounded sequence window, rate limit, layout binding, and short raw-data retention.
        </NeonText>
      </View>

      <View style={styles.metrics}>
        <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">LIVE</NeonText><NeonText variant="h1" tone="success">{counts.live}</NeonText></Surface>
        <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">STALE</NeonText><NeonText variant="h1" tone="warning">{counts.stale}</NeonText></Surface>
        <Surface padded style={styles.metric}><NeonText variant="label" tone="muted">OFFLINE</NeonText><NeonText variant="h1">{counts.offline}</NeonText></Surface>
      </View>

      {issuedCredential ? (
        <Surface elevated padded style={styles.secretCard}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <NeonText variant="label" tone="warning">COPY ONCE</NeonText>
              <NeonText variant="h2" style={styles.smallTop}>New sensor credential</NeonText>
            </View>
            <Pill label={`V${issuedCredential.token_version}`} tone="warning" />
          </View>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Beacon stores only a SHA-256 digest. This plaintext token disappears when you dismiss this card and is never written to AsyncStorage or analytics.
          </NeonText>
          <NeonText selectable variant="mono" tone="accent" style={styles.secretText}>
            {issuedCredential.ingress_token}
          </NeonText>
          <NeonText selectable variant="mono" tone="dim" style={styles.sourceIdText}>
            SOURCE {issuedCredential.source_id}
          </NeonText>
          <Pressable onPress={() => setIssuedCredential(null)} style={styles.dismissButton}>
            <NeonText variant="label" tone="accent">I SAVED THE CREDENTIAL</NeonText>
          </Pressable>
        </Surface>
      ) : null}

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">PROVISION SOURCE</NeonText>
        <Surface padded style={styles.formCard}>
          <NeonText variant="label" tone="muted">ACTIVE RELEASE</NeonText>
          <NeonText variant="mono" tone={layoutVersion ? 'text' : 'danger'} style={styles.smallTop}>
            {layoutVersion ? `${releaseId ?? 'release'} · layout ${layoutVersion}` : 'No active release'}
          </NeonText>

          <NeonText variant="label" tone="muted" style={styles.formLabel}>SOURCE NAME</NeonText>
          <TextInput
            value={sourceKey}
            onChangeText={setSourceKey}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="north-entry-ble"
            placeholderTextColor={palette.textDim}
            style={styles.input}
            editable={!working}
          />

          <NeonText variant="label" tone="muted" style={styles.formLabel}>SOURCE KIND</NeonText>
          <View style={styles.kindRow}>
            {SENSOR_KINDS.map((item) => (
              <Pressable
                key={item.kind}
                disabled={working}
                onPress={() => setSourceKind(item.kind)}
                style={[styles.kindButton, sourceKind === item.kind && styles.kindButtonSelected]}
              >
                <NeonText variant="label" tone={sourceKind === item.kind ? 'accent' : 'muted'}>{item.label}</NeonText>
              </Pressable>
            ))}
          </View>

          <Pressable disabled={working || !layoutVersion} onPress={provision} style={[styles.primaryButton, (working || !layoutVersion) && styles.disabled]}>
            <NeonText variant="label" tone="accent">PROVISION UNIQUE CREDENTIAL</NeonText>
          </Pressable>
        </Surface>
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">SOURCE CONTROL DEGRADED</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      <View style={styles.section}>
        <View style={styles.headerRow}>
          <NeonText variant="label" tone="accent">REGISTERED SOURCES</NeonText>
          <Pill label={`${sources.length}`} tone="neutral" />
        </View>

        {sources.length === 0 ? (
          <Surface padded><NeonText variant="bodyMuted">No venue sensor sources are registered for this event yet.</NeonText></Surface>
        ) : sources.map((source) => {
          const state = sensorState(source);
          return (
            <Surface key={source.source_id} elevated padded style={styles.sourceCard}>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="h2">{source.source_key}</NeonText>
                  <NeonText variant="label" tone="muted" style={styles.smallTop}>
                    {source.source_kind.toUpperCase()} · TOKEN V{source.token_version} · {source.max_observations_per_minute}/MIN MAX
                  </NeonText>
                </View>
                <Pill label={state.toUpperCase()} tone={stateTone(state)} />
              </View>

              <View style={styles.sourceMetrics}>
                <NeonText variant="label" tone="muted">LAST {ageLabel(source.last_received_at)}</NeonText>
                <NeonText variant="label" tone="muted">SEQ {source.last_sequence < 0 ? '—' : source.last_sequence}</NeonText>
                <NeonText variant="label" tone="muted">LAYOUT {source.layout_version}</NeonText>
              </View>

              <View style={styles.sourceActions}>
                {source.active ? (
                  <Pressable disabled={working} onPress={() => rotate(source)} style={styles.secondaryButton}>
                    <NeonText variant="label" tone="accent">ROTATE TOKEN</NeonText>
                  </Pressable>
                ) : null}
                {source.active ? (
                  <Pressable disabled={working} onPress={() => revoke(source)} style={styles.revokeButton}>
                    <NeonText variant="label" tone="danger">REVOKE</NeonText>
                  </Pressable>
                ) : null}
              </View>
            </Surface>
          );
        })}
      </View>

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="warning">INGRESS BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          Device ingress accepts only aggregate occupancy, transition, and service-point payloads. Manual operator confirmations use the authenticated operator path. Raw sensor ingress is transport evidence with bounded retention, not a permanent attendee history.
        </NeonText>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  heroCopy: { marginTop: spacing.sm, lineHeight: 20 },
  metrics: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  metric: { flex: 1, minHeight: 90, justifyContent: 'space-between', borderRadius: radii.lg },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  formCard: { borderRadius: radii.lg },
  formLabel: { marginTop: spacing.lg },
  input: { marginTop: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface, color: palette.text, fontSize: 15 },
  kindRow: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindButton: { paddingHorizontal: spacing.md, minHeight: 34, justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairlineStrong, backgroundColor: palette.surface },
  kindButtonSelected: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  primaryButton: { marginTop: spacing.lg, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
  secondaryButton: { minHeight: 36, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accentDim },
  revokeButton: { minHeight: 36, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.danger },
  disabled: { opacity: 0.45 },
  secretCard: { marginHorizontal: spacing.xl, marginTop: spacing.lg, borderRadius: radii.lg, borderColor: palette.warning },
  secretText: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: palette.surface, fontSize: 12, lineHeight: 18 },
  sourceIdText: { marginTop: spacing.sm, fontSize: 10 },
  dismissButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  sourceCard: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
  sourceMetrics: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sourceActions: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  errorCard: { marginHorizontal: spacing.xl, marginTop: spacing.lg, borderColor: palette.danger },
  boundaryCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
  smallTop: { marginTop: spacing.xs },
});
