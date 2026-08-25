import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  getVenueRepeatMemory,
  type VenueRepeatMemoryPayload,
} from '../services/venue-memory.service';
import type {
  VenueInterventionMeasurementRow,
  VenueLearningContextRow,
} from '../services/venue-operations.service';
import {
  buildVenuePortfolioMemory,
  type VenueHistoricalCloseoutInput,
  type VenueHistoricalMeasurementInput,
  type VenuePlaybookStatus,
} from '../spatial/VenuePortfolioMemory';
import {
  VENUE_LEARNING_CONTEXT_VERSION,
  type VenueLearningContext,
} from '../spatial/VenueLearningContext';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  currentContext: VenueLearningContextRow | null;
  currentMeasurements: VenueInterventionMeasurementRow[];
}

type PillTone = 'success' | 'premium' | 'danger' | 'neutral' | 'accent';

function contextFromRow(row: {
  context_key: string;
  context_version: string;
  venue_key: string;
  layout_version: string;
  geometry_hash: string;
  total_capacity: number;
  topology_redundancy: number;
  accessible_coverage: number;
  attendance_band: 'small' | 'medium' | 'large' | 'very-large';
  duration_band: 'short' | 'standard' | 'long';
  zone_kinds: string[];
  service_point_kinds: string[];
  program_fingerprint: string | null;
}): VenueLearningContext | null {
  if (row.context_version !== VENUE_LEARNING_CONTEXT_VERSION) return null;
  return {
    version: VENUE_LEARNING_CONTEXT_VERSION,
    key: row.context_key,
    venueKey: row.venue_key,
    layoutVersion: row.layout_version,
    geometryHash: row.geometry_hash,
    zoneKinds: row.zone_kinds,
    totalCapacity: row.total_capacity,
    topologyRedundancy: row.topology_redundancy,
    accessibleCoverage: row.accessible_coverage,
    servicePointKinds: row.service_point_kinds,
    attendanceBand: row.attendance_band,
    durationBand: row.duration_band,
    programFingerprint: row.program_fingerprint,
  };
}

function statusTone(status: VenuePlaybookStatus): PillTone {
  if (status === 'proven') return 'success';
  if (status === 'promising') return 'accent';
  if (status === 'avoid') return 'danger';
  if (status === 'mixed') return 'premium';
  return 'neutral';
}

function signed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Host-private repeat-event memory. This surface intentionally does not query a
 * global benchmark: it compounds only the current host's own measured venue
 * history, and historical evidence never becomes action authority by itself.
 */
export function VenueMemoryCard({ eventId, currentContext, currentMeasurements }: Props) {
  const [payload, setPayload] = useState<VenueRepeatMemoryPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!currentContext) {
      setPayload(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void getVenueRepeatMemory(eventId)
      .then((result) => {
        if (!cancelled) setPayload(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentContext, eventId]);

  const memory = useMemo(() => {
    if (!currentContext || !payload) return null;
    const targetContext = contextFromRow(currentContext);
    if (!targetContext) return null;

    const history: VenueHistoricalMeasurementInput[] = payload.measurements.flatMap((row) => {
      const context = contextFromRow(row);
      if (!context) return [];
      const measuredAt = Date.parse(row.measured_at);
      if (!Number.isFinite(measuredAt)) return [];
      return [{
        eventId: row.source_event_id,
        commandId: row.command_id,
        commandKind: row.command_kind,
        effectScore: row.effect_score,
        confidence: row.confidence,
        measuredAt,
        context,
      }];
    });

    const closeouts: VenueHistoricalCloseoutInput[] = payload.closeouts.flatMap((row) => {
      const closedAt = Date.parse(row.closed_at);
      if (!Number.isFinite(closedAt)) return [];
      return [{
        eventId: row.source_event_id,
        closedAt,
        measuredInterventionCount: row.measured_intervention_count,
        meanMeasuredEffect: row.mean_measured_effect,
        positiveRate: row.positive_rate,
        meanMeasurementConfidence: row.mean_measurement_confidence,
        evidenceCoverage: row.evidence_coverage,
      }];
    });

    return buildVenuePortfolioMemory({
      currentContext: targetContext,
      history,
      closeouts,
      currentMeasurements: currentMeasurements.map((row) => ({
        effectScore: row.effect_score,
        confidence: row.confidence,
      })),
    });
  }, [currentContext, currentMeasurements, payload]);

  if (!currentContext) {
    return (
      <Surface padded style={styles.card}>
        <NeonText variant="label" tone="muted">VENUE MEMORY</NeonText>
        <NeonText variant="bodyMuted" style={styles.copy}>
          Repeat-event memory starts after a trusted venue learning context is pinned. Beacon will not blend history across an undefined floorplan or operating regime.
        </NeonText>
      </Surface>
    );
  }

  if (loading && !memory) {
    return (
      <Surface padded style={styles.card}>
        <NeonText variant="label" tone="accent">VENUE MEMORY</NeonText>
        <NeonText variant="bodyMuted" style={styles.copy}>Loading your prior measured venue evidence…</NeonText>
      </Surface>
    );
  }

  if (!memory) return null;

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <NeonText variant="label" tone="accent">VENUE MEMORY</NeonText>
          <NeonText variant="h2" style={styles.title}>What your previous events actually taught Beacon</NeonText>
        </View>
        <Pill label={`${memory.benchmark.historicalEventCount} EVENTS`} tone="neutral" />
      </View>

      <NeonText variant="bodyMuted" style={styles.copy}>{memory.narrative}</NeonText>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">COMPATIBLE EVIDENCE</NeonText>
          <NeonText variant="h1" tone="accent">{memory.compatibleMeasurementCount}</NeonText>
          <NeonText variant="bodyMuted">measured interventions</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">HISTORICAL MEDIAN</NeonText>
          <NeonText variant="h1">{signed(memory.benchmark.historicalMedianEffect)}</NeonText>
          <NeonText variant="bodyMuted">bounded before/after effect</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">CURRENT VS HISTORY</NeonText>
          <NeonText
            variant="h1"
            tone={memory.benchmark.currentVsHistoryDelta != null && memory.benchmark.currentVsHistoryDelta > 0.05 ? 'success' : 'text'}
          >
            {signed(memory.benchmark.currentVsHistoryDelta)}
          </NeonText>
          <NeonText variant="bodyMuted">confidence-weighted delta</NeonText>
        </View>
      </View>

      {memory.entries.length > 0 ? (
        <View style={styles.playbook}>
          <NeonText variant="label" tone="muted">MEASURED PLAYBOOK</NeonText>
          {memory.entries.slice(0, 4).map((entry) => (
            <View key={`${entry.commandKind}:${entry.commandId}`} style={styles.entry}>
              <View style={styles.entryHeader}>
                <View style={styles.entryCopy}>
                  <NeonText variant="h2">{entry.commandId}</NeonText>
                  <NeonText variant="label" tone="muted" style={styles.entryMeta}>
                    {entry.commandKind.toUpperCase()} · {entry.eventCount} EVENTS · {entry.sampleSize} MEASUREMENTS
                  </NeonText>
                </View>
                <Pill label={entry.status.toUpperCase()} tone={statusTone(entry.status)} />
              </View>
              <View style={styles.inlineMetrics}>
                <NeonText variant="label" tone="muted">EFFECT {signed(entry.weightedMeanEffect)}</NeonText>
                <NeonText variant="label" tone="muted">POSITIVE {percent(entry.weightedPositiveRate)}</NeonText>
                <NeonText variant="label" tone="muted">EVIDENCE {percent(entry.evidenceScore)}</NeonText>
              </View>
              <NeonText variant="bodyMuted" style={styles.entryDetail}>{entry.explanation}</NeonText>
            </View>
          ))}
        </View>
      ) : null}

      {payload?.errors.length ? (
        <NeonText variant="bodyMuted" style={styles.errorCopy}>
          Some historical evidence is unavailable. Beacon is showing the bounded subset it could verify instead of filling gaps.
        </NeonText>
      ) : null}

      <View style={styles.boundary}>
        <NeonText variant="label" tone="premium">AUTHORITY BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.copy}>
          Historical evidence may change what Beacon inspects first. It cannot make an intervention action-ready, bypass current telemetry, override a pinned release, or substitute for fresh control admission.
        </NeonText>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headerCopy: { flex: 1 },
  title: { marginTop: spacing.xs },
  copy: { marginTop: spacing.sm, lineHeight: 20 },
  metrics: { marginTop: spacing.lg, flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, minHeight: 96, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  playbook: { marginTop: spacing.lg, gap: spacing.sm },
  entry: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.hairline },
  entryHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  entryCopy: { flex: 1 },
  entryMeta: { marginTop: 3 },
  inlineMetrics: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  entryDetail: { marginTop: spacing.sm, lineHeight: 19 },
  boundary: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.hairline },
  errorCopy: { marginTop: spacing.md, color: palette.textMuted },
});
