import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import {
  getVenueOperationsSnapshot,
  type VenueOperationAuditRow,
  type VenueOperationsSnapshot,
  type VenueServicePointSampleRow,
} from '../services/venue-operations.service';
import { assessVenueServicePoints } from '../spatial/VenueServicePoint';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type VenueOperationsParams = { VenueOperations: { eventId: string } };

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function latestServicePointInputs(samples: VenueServicePointSampleRow[]) {
  const grouped = new Map<string, VenueServicePointSampleRow[]>();
  for (const sample of samples) {
    grouped.set(sample.service_point_id, [...(grouped.get(sample.service_point_id) ?? []), sample]);
  }

  return [...grouped.values()].map((group) => {
    const ordered = [...group].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    const latest = ordered[0];
    const previous = ordered[1];
    return {
      id: latest.service_point_id,
      zoneId: latest.zone_id,
      kind: latest.kind,
      configuredServers: 1,
      observedQueueLength: latest.queue_length,
      previousQueueLength: previous?.queue_length ?? latest.queue_length,
      arrivals: latest.arrivals,
      completions: latest.completions,
      observationWindowMinutes: latest.window_minutes,
      sampleSupport: latest.sample_support,
      confidence: latest.confidence,
    };
  });
}

function admissionTone(row: VenueOperationAuditRow): 'success' | 'warning' | 'danger' | 'neutral' {
  if (row.admission_decision === 'allow') return 'success';
  if (row.admission_decision === 'review') return 'warning';
  if (row.admission_decision === 'block') return 'danger';
  return 'neutral';
}

export default function VenueOperationsScreen() {
  const route = useRoute<RouteProp<VenueOperationsParams, 'VenueOperations'>>();
  const { eventId } = route.params;
  const [snapshot, setSnapshot] = useState<VenueOperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    try {
      setSnapshot(await getVenueOperationsSnapshot(eventId));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId]);

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const measuredSummary = useMemo(() => {
    const measurements = snapshot?.measurements ?? [];
    if (measurements.length === 0) return { meanEffect: null as number | null, positive: 0, negative: 0 };
    const meanEffect = measurements.reduce((sum, row) => sum + row.effect_score, 0) / measurements.length;
    return {
      meanEffect,
      positive: measurements.filter((row) => row.effect_score > 0.08).length,
      negative: measurements.filter((row) => row.effect_score < -0.08).length,
    };
  }, [snapshot?.measurements]);

  const serviceSummary = useMemo(
    () => assessVenueServicePoints(latestServicePointInputs(snapshot?.servicePoints ?? [])),
    [snapshot?.servicePoints],
  );

  if (loading && !snapshot) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading venue evidence
        </NeonText>
      </View>
    );
  }

  const audit = snapshot?.audit ?? [];
  const measurements = snapshot?.measurements ?? [];
  const errors = snapshot?.errors ?? [];
  const latestAudit = audit[0] ?? null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={palette.accent}
        />
      )}
    >
      <GridBackground intensity={0.34} />

      <View style={styles.hero}>
        <Pill label="Venue operations" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          Operations evidence
        </NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
          Host-visible operational history, measured interventions, and aggregate service pressure. No attendee movement history is shown here.
        </NeonText>
      </View>

      {errors.length > 0 ? (
        <Surface padded style={styles.warningCard}>
          <NeonText variant="label" tone="warning">PARTIAL DATA</NeonText>
          {errors.map((error) => (
            <NeonText key={`${error.surface}:${error.message}`} variant="bodyMuted" style={styles.compactLine}>
              {error.surface}: {error.message}
            </NeonText>
          ))}
        </Surface>
      ) : null}

      <View style={styles.metricRow}>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">AUDIT EVENTS</NeonText>
          <NeonText variant="h1" tone="accent" style={styles.metricValue}>{audit.length}</NeonText>
        </Surface>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">MEASURED</NeonText>
          <NeonText variant="h1" tone="text" style={styles.metricValue}>{measurements.length}</NeonText>
        </Surface>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">SERVICE POINTS</NeonText>
          <NeonText variant="h1" tone={serviceSummary.congestedPointIds.length ? 'warning' : 'success'} style={styles.metricValue}>
            {serviceSummary.points.length}
          </NeonText>
        </Surface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <NeonText variant="label" tone="accent">CURRENT CONTROL EVIDENCE</NeonText>
          <Pressable onPress={() => load('refresh')} hitSlop={12}>
            <NeonText variant="label" tone="accent">REFRESH</NeonText>
          </Pressable>
        </View>

        {latestAudit ? (
          <Surface elevated padded style={styles.primaryCard}>
            <View style={styles.inlineRow}>
              <Pill
                label={latestAudit.admission_decision?.toUpperCase() ?? latestAudit.event_type.toUpperCase()}
                tone={admissionTone(latestAudit)}
              />
              <NeonText variant="label" tone="muted">{formatTime(latestAudit.created_at)}</NeonText>
            </View>
            <NeonText variant="h2" style={{ marginTop: spacing.sm }}>
              {latestAudit.command_id ?? latestAudit.event_type}
            </NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>
              {latestAudit.reason_code ?? 'No structured reason code was recorded.'}
            </NeonText>
            <View style={styles.detailGrid}>
              <NeonText variant="label" tone="muted">EVIDENCE {formatPercent(latestAudit.evidence_score)}</NeonText>
              <NeonText variant="label" tone="muted">LAYOUT {latestAudit.layout_version}</NeonText>
              <NeonText variant="label" tone="muted">MODEL {latestAudit.model_version}</NeonText>
            </View>
          </Surface>
        ) : (
          <Surface padded>
            <NeonText variant="bodyMuted">
              No persisted operator decision evidence yet. Beacon will not fabricate an operational history.
            </NeonText>
          </Surface>
        )}
      </View>

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">MEASURED INTERVENTIONS</NeonText>
        <Surface padded style={styles.summaryCard}>
          <View style={styles.inlineRow}>
            <View>
              <NeonText variant="label" tone="muted">MEAN EFFECT</NeonText>
              <NeonText variant="h1" tone={measuredSummary.meanEffect != null && measuredSummary.meanEffect > 0.08 ? 'success' : 'text'}>
                {measuredSummary.meanEffect == null ? '—' : `${measuredSummary.meanEffect >= 0 ? '+' : ''}${measuredSummary.meanEffect.toFixed(2)}`}
              </NeonText>
            </View>
            <View style={styles.rightMetric}>
              <NeonText variant="label" tone="success">{measuredSummary.positive} positive</NeonText>
              <NeonText variant="label" tone="danger">{measuredSummary.negative} negative</NeonText>
            </View>
          </View>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Effects are observational before/after measurements, not causal proof. Only measured interventions appear here.
          </NeonText>
        </Surface>

        {measurements.slice(0, 6).map((row) => (
          <Surface key={row.id} padded style={styles.listCard}>
            <View style={styles.inlineRow}>
              <NeonText variant="h2">{row.command_id}</NeonText>
              <Pill label={`${row.effect_score >= 0 ? '+' : ''}${row.effect_score.toFixed(2)}`} tone={row.effect_score > 0.08 ? 'success' : row.effect_score < -0.08 ? 'danger' : 'neutral'} />
            </View>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
              Saturated zones {row.before_saturated_zones} → {row.after_saturated_zones} · mean occupancy {formatPercent(row.before_mean_occupancy)} → {formatPercent(row.after_mean_occupancy)}
            </NeonText>
            <NeonText variant="label" tone="muted" style={{ marginTop: 6 }}>
              {formatPercent(row.confidence)} confidence · {formatTime(row.measured_at)}
            </NeonText>
          </Surface>
        ))}
      </View>

      <View style={styles.section}>
        <NeonText variant="label" tone="accent">SERVICE PRESSURE</NeonText>
        <NeonText variant="bodyMuted">{serviceSummary.narrative}</NeonText>
        {serviceSummary.points.slice(0, 8).map((point) => (
          <Surface key={point.id} padded style={styles.listCard}>
            <View style={styles.inlineRow}>
              <View>
                <NeonText variant="h2">{point.id}</NeonText>
                <NeonText variant="label" tone="muted">{point.kind.toUpperCase()} · {point.zoneId}</NeonText>
              </View>
              <Pill label={point.state.toUpperCase()} tone={point.state === 'congested' ? 'danger' : point.state === 'building' ? 'warning' : 'success'} />
            </View>
            <View style={styles.detailGrid}>
              <NeonText variant="label" tone="muted">IN {point.arrivalRatePerMinute.toFixed(1)}/MIN</NeonText>
              <NeonText variant="label" tone="muted">OUT {point.completionRatePerMinute.toFixed(1)}/MIN</NeonText>
              <NeonText variant="label" tone="muted">WAIT {point.estimatedWaitMinutes == null ? 'WITHHELD' : `${Math.round(point.estimatedWaitMinutes)} MIN`}</NeonText>
            </View>
          </Surface>
        ))}
      </View>

      <Surface padded style={styles.privacyCard}>
        <NeonText variant="label" tone="muted">DATA BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={{ marginTop: 5 }}>
          This surface is event-host scoped. Venue evidence is aggregate and version-bound; it is not an attendee trajectory viewer or an emergency-management console.
        </NeonText>
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  metricCard: { flex: 1, minHeight: 88, justifyContent: 'space-between', borderRadius: radii.lg },
  metricValue: { marginTop: spacing.sm },
  primaryCard: { borderRadius: radii.lg, borderColor: palette.accentDim },
  summaryCard: { borderRadius: radii.lg },
  listCard: { marginTop: spacing.xs, borderRadius: radii.md },
  inlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  detailGrid: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  rightMetric: { alignItems: 'flex-end', gap: 4 },
  warningCard: { marginHorizontal: spacing.xl, marginTop: spacing.sm, borderColor: palette.warning },
  compactLine: { marginTop: 4 },
  privacyCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
});
