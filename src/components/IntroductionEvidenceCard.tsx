import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { EVENT_INTENT_LABELS } from '../services/event-intent.service';
import {
  getWarmIntroductionDomains,
  getWarmIntroductionSummary,
  type WarmIntroductionDomainSummary,
  type WarmIntroductionSummary,
} from '../services/warm-introduction.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/**
 * Host-facing cohort-gated evidence. The server owns every denominator, and the
 * card never receives requester, connector, or target identities.
 */
export default function IntroductionEvidenceCard({ eventId }: Readonly<Props>) {
  const [summary, setSummary] = useState<WarmIntroductionSummary | null>(null);
  const [domains, setDomains] = useState<WarmIntroductionDomainSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [summaryResult, domainResult] = await Promise.all([
      getWarmIntroductionSummary(eventId),
      getWarmIntroductionDomains(eventId),
    ]);
    const firstError = summaryResult.error ?? domainResult.error;
    setError(firstError?.message ?? null);
    if (!summaryResult.error) setSummary(summaryResult.data);
    if (!domainResult.error) setDomains(domainResult.data);
  }, [eventId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="premium">WARM INTRODUCTION EVIDENCE</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>Does trusted routing become a real mutual?</NeonText>
        </View>
        <Pill
          label={summary?.supported ? 'SUPPORTED' : 'COHORT BUILDING'}
          tone={summary?.supported ? 'success' : 'neutral'}
        />
      </View>

      {error ? (
        <NeonText variant="bodyMuted" tone="danger" style={styles.bodyCopy}>{error}</NeonText>
      ) : summary?.supported ? (
        <>
          <View style={styles.metricGrid}>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">REQUESTS</NeonText>
              <NeonText variant="h1">{summary.total_requests ?? '—'}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">CONNECTOR ACCEPT</NeonText>
              <NeonText variant="h1" tone="premium">{percent(summary.connector_accept_rate)}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">TARGET ACCEPT</NeonText>
              <NeonText variant="h1" tone="accent">{percent(summary.target_accept_rate)}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">ACCEPTED → MUTUAL</NeonText>
              <NeonText variant="h1" tone="success">{percent(summary.match_after_accept_rate)}</NeonText>
            </View>
          </View>

          <NeonText variant="bodyMuted" style={styles.bodyCopy}>
            These rates use persisted protocol states with explicit denominators: connector accepts divided by requests, target accepts divided by connector accepts, and resulting mutuals divided by accepted introductions.
          </NeonText>

          {domains.length > 0 ? (
            <View style={styles.domainList}>
              <NeonText variant="label" tone="muted">SUPPORTED INTRODUCTION DOMAINS</NeonText>
              {domains.slice(0, 5).map((domain) => (
                <View key={domain.intent_key} style={styles.domainRow}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{EVENT_INTENT_LABELS[domain.intent_key]}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      {domain.request_count} requests · {domain.target_accept_count} accepted · {domain.matched_count} mutuals
                    </NeonText>
                  </View>
                  <Pill label={`${percent(domain.match_after_accept_rate)} MUTUAL`} tone="neutral" />
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <NeonText variant="bodyMuted" style={styles.bodyCopy}>
          Beacon withholds introduction counts until at least five requests exist. Domain rows require five requests in that domain as well, so the host cannot reconstruct a small three-party interaction.
        </NeonText>
      )}

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="warning">WHAT THIS DOES NOT MEAN</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          A connector acceptance is not an endorsement, and a resulting mutual is not proof of commercial success. Hosts receive aggregate protocol evidence only—never the identities or connection graph behind it.
        </NeonText>
      </Surface>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    borderRadius: radii.xl,
    borderColor: palette.premiumSoft,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  bodyCopy: { marginTop: spacing.md, lineHeight: 20 },
  metricGrid: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    width: '48%',
    minHeight: 82,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
  },
  domainList: { marginTop: spacing.lg, gap: spacing.sm },
  domainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  boundaryCard: {
    marginTop: spacing.lg,
    borderRadius: radii.md,
    borderColor: palette.warning,
    backgroundColor: palette.warningSoft,
  },
});
