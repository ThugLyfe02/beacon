import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  getHostVenuePortfolio,
  type HostVenuePortfolioRow,
} from '../services/venue-portfolio.service';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

function signed(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function trendLabel(value: number | null): string {
  if (value == null) return 'NOT ENOUGH HISTORY';
  if (value > 0.06) return 'IMPROVING';
  if (value < -0.06) return 'REGRESSING';
  return 'STABLE';
}

function trendTone(value: number | null): 'success' | 'danger' | 'neutral' | 'premium' {
  if (value == null) return 'neutral';
  if (value > 0.06) return 'success';
  if (value < -0.06) return 'danger';
  return 'premium';
}

export default function VenuePortfolioScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [rows, setRows] = useState<HostVenuePortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await getHostVenuePortfolio();
      if (result.error) throw new Error(result.error.message);
      setRows(result.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load venue portfolio.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const totals = useMemo(() => {
    const totalEvents = rows.reduce((sum, row) => sum + row.ended_event_count, 0);
    const measured = rows.reduce((sum, row) => sum + row.total_measured_interventions, 0);
    const positive = rows.reduce((sum, row) => sum + row.total_positive_interventions, 0);
    const weightedNumerator = rows.reduce(
      (sum, row) => sum + (row.weighted_mean_effect ?? 0) * row.total_measured_interventions,
      0,
    );
    return {
      totalEvents,
      measured,
      positive,
      meanEffect: measured > 0 ? weightedNumerator / measured : null,
      positiveRate: measured > 0 ? positive / measured : null,
    };
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading event portfolio
        </NeonText>
      </View>
    );
  }

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
        <Pill label="Host private" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          Event portfolio
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          A durable view of what your own ended events produced across venues. Beacon does not mix another organizer's event history into this surface.
        </NeonText>
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">PORTFOLIO UNAVAILABLE</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
          <Pressable onPress={() => load('refresh')} style={styles.retryButton}>
            <NeonText variant="label" tone="accent">RETRY</NeonText>
          </Pressable>
        </Surface>
      ) : null}

      <View style={styles.metrics}>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">ENDED EVENTS</NeonText>
          <NeonText variant="h1" tone="accent">{totals.totalEvents}</NeonText>
        </Surface>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">MEASURED ACTIONS</NeonText>
          <NeonText variant="h1">{totals.measured}</NeonText>
        </Surface>
        <Surface padded style={styles.metricCard}>
          <NeonText variant="label" tone="muted">WEIGHTED EFFECT</NeonText>
          <NeonText variant="h1" tone={totals.meanEffect != null && totals.meanEffect > 0.08 ? 'success' : 'text'}>
            {signed(totals.meanEffect)}
          </NeonText>
        </Surface>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <NeonText variant="label" tone="accent">VENUES</NeonText>
          <NeonText variant="label" tone="muted">{percent(totals.positiveRate)} positive</NeonText>
        </View>

        {rows.length === 0 ? (
          <Surface padded style={styles.emptyCard}>
            <NeonText variant="h2">Your first closeout becomes the baseline.</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              Beacon keeps live event closure separate from destructive deletion so measured venue evidence can compound into future planning.
            </NeonText>
          </Surface>
        ) : rows.map((row) => (
          <Surface key={row.venue_key} elevated padded style={styles.venueCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.venueHeading}>
                <NeonText variant="h2">{row.venue_key}</NeonText>
                <NeonText variant="label" tone="muted" style={styles.smallTop}>
                  LAST CLOSED {formatDate(row.last_closed_at).toUpperCase()}
                </NeonText>
              </View>
              <Pill label={trendLabel(row.trend_delta)} tone={trendTone(row.trend_delta)} />
            </View>

            <View style={styles.venueMetrics}>
              <View style={styles.venueMetric}>
                <NeonText variant="label" tone="muted">EVENTS</NeonText>
                <NeonText variant="h2">{row.ended_event_count}</NeonText>
              </View>
              <View style={styles.venueMetric}>
                <NeonText variant="label" tone="muted">MEASURED</NeonText>
                <NeonText variant="h2">{row.total_measured_interventions}</NeonText>
              </View>
              <View style={styles.venueMetric}>
                <NeonText variant="label" tone="muted">EFFECT</NeonText>
                <NeonText variant="h2">{signed(row.weighted_mean_effect)}</NeonText>
              </View>
              <View style={styles.venueMetric}>
                <NeonText variant="label" tone="muted">EVIDENCE</NeonText>
                <NeonText variant="h2">{percent(row.mean_evidence_coverage)}</NeonText>
              </View>
            </View>

            <NeonText variant="bodyMuted" style={styles.venueCopy}>
              {row.measured_event_count} event{row.measured_event_count === 1 ? '' : 's'} contain measured interventions · {percent(row.weighted_positive_rate)} positive · {percent(row.mean_measurement_confidence)} mean measurement confidence.
            </NeonText>

            {row.trend_delta != null ? (
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                Recent three-event effect versus the previous three: {signed(row.trend_delta)}. This is a portfolio trend, not causal attribution.
              </NeonText>
            ) : null}

            <Pressable
              onPress={() => navigation.navigate('VenueOperations', { eventId: row.latest_event_id })}
              style={styles.openButton}
            >
              <NeonText variant="label" tone="accent">OPEN LATEST CLOSEOUT</NeonText>
              <NeonText variant="h2" tone="accent">→</NeonText>
            </Pressable>
          </Surface>
        ))}
      </View>

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="premium">PORTFOLIO BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          This is your own operational history, not an anonymous competitor leaderboard. Cross-customer benchmarking would require an explicit product and privacy contract rather than silently reusing another host's evidence.
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
  metricCard: { flex: 1, minHeight: 96, justifyContent: 'space-between', borderRadius: radii.lg },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  venueHeading: { flex: 1 },
  venueCard: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
  venueMetrics: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  venueMetric: { flex: 1, minHeight: 72, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  venueCopy: { marginTop: spacing.md, lineHeight: 19 },
  smallTop: { marginTop: spacing.xs },
  openButton: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.hairline, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyCard: { borderRadius: radii.lg },
  errorCard: { marginHorizontal: spacing.xl, marginTop: spacing.lg, borderColor: palette.danger },
  retryButton: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  boundaryCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
});
