import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import {
  EVENT_INTENT_LABELS,
  getDeclaredFitMutualDomains,
  getDeclaredFitMutualSummary,
  getEventIntentMix,
  type DeclaredFitMutualDomain,
  type DeclaredFitMutualSummary,
  type EventIntentMixRow,
} from '../services/event-intent.service';
import {
  buildEventIntentProgramming,
  type EventIntentProgrammingPosture,
} from '../spatial/EventIntentProgramming';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Params = { EventIntentMix: { eventId: string } };

type Tone = 'success' | 'warning' | 'premium' | 'neutral';

function balanceTone(balance: EventIntentMixRow['balance']): Tone {
  if (balance === 'need-heavy') return 'warning';
  if (balance === 'offer-heavy') return 'premium';
  return 'success';
}

function balanceLabel(balance: EventIntentMixRow['balance']): string {
  if (balance === 'need-heavy') return 'MORE NEED THAN SUPPLY';
  if (balance === 'offer-heavy') return 'MORE SUPPLY THAN NEED';
  return 'BALANCED';
}

function postureTone(posture: EventIntentProgrammingPosture): Tone {
  if (posture === 'add-structure') return 'warning';
  if (posture === 'activate-supply') return 'premium';
  if (posture === 'protect') return 'success';
  return 'neutral';
}

function postureLabel(posture: EventIntentProgrammingPosture): string {
  if (posture === 'add-structure') return 'ADD STRUCTURE';
  if (posture === 'activate-supply') return 'ACTIVATE SUPPLY';
  if (posture === 'protect') return 'PROTECT';
  return 'OBSERVE';
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export default function EventIntentMixScreen() {
  const route = useRoute<RouteProp<Params, 'EventIntentMix'>>();
  const { eventId } = route.params;
  const [rows, setRows] = useState<EventIntentMixRow[]>([]);
  const [mutualSummary, setMutualSummary] = useState<DeclaredFitMutualSummary | null>(null);
  const [mutualDomains, setMutualDomains] = useState<DeclaredFitMutualDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [mixResult, outcomeResult, domainResult] = await Promise.all([
        getEventIntentMix(eventId),
        getDeclaredFitMutualSummary(eventId),
        getDeclaredFitMutualDomains(eventId),
      ]);
      if (mixResult.error) throw new Error(mixResult.error.message);
      setRows(mixResult.data);
      setMutualSummary(outcomeResult.error ? null : outcomeResult.data);
      setMutualDomains(domainResult.error ? [] : domainResult.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load declared event demand.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId]);

  useFocusEffect(useCallback(() => {
    load('initial');
  }, [load]));

  const summary = useMemo(() => {
    const needHeavy = rows
      .filter((row) => row.balance === 'need-heavy')
      .sort((a, b) => (b.seeking_count - b.offering_count) - (a.seeking_count - a.offering_count))[0] ?? null;
    const offerHeavy = rows
      .filter((row) => row.balance === 'offer-heavy')
      .sort((a, b) => (b.offering_count - b.seeking_count) - (a.offering_count - a.seeking_count))[0] ?? null;
    const contributors = rows.reduce((max, row) => Math.max(max, row.contributor_count), 0);
    return { needHeavy, offerHeavy, contributors };
  }, [rows]);

  const programming = useMemo(
    () => buildEventIntentProgramming({ mix: rows, mutualDomains }),
    [mutualDomains, rows],
  );

  if (loading && rows.length === 0 && !mutualSummary) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Reading declared event demand
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
        <Pill label="Declared demand" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          What this room says it actually needs.
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          This view aggregates explicit participant selections. It does not infer demand from profile views, movement, dwell, or click behavior, and it never exposes who selected a category.
        </NeonText>
      </View>

      {error ? (
        <Surface padded style={styles.errorCard}>
          <NeonText variant="label" tone="danger">DECLARED DEMAND UNAVAILABLE</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>{error}</NeonText>
        </Surface>
      ) : null}

      <Surface elevated padded style={styles.outcomeCard}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="premium">MUTUAL ALIGNMENT</NeonText>
            <NeonText variant="h2" style={styles.smallTop}>Do declared fits show up in real mutual connections?</NeonText>
          </View>
          <Pill label={mutualSummary?.supported ? 'SUPPORTED' : 'COHORT BUILDING'} tone={mutualSummary?.supported ? 'success' : 'neutral'} />
        </View>

        {mutualSummary?.supported ? (
          <>
            <View style={styles.outcomeMetrics}>
              <View style={styles.outcomeMetric}>
                <NeonText variant="label" tone="muted">MUTUALS</NeonText>
                <NeonText variant="h1">{mutualSummary.total_mutual_matches ?? '—'}</NeonText>
              </View>
              <View style={styles.outcomeMetric}>
                <NeonText variant="label" tone="muted">WITH DECLARED FIT</NeonText>
                <NeonText variant="h1" tone="accent">{percent(mutualSummary.declared_fit_share)}</NeonText>
              </View>
              <View style={styles.outcomeMetric}>
                <NeonText variant="label" tone="muted">TWO-WAY FIT</NeonText>
                <NeonText variant="h1" tone="premium">{percent(mutualSummary.two_way_share)}</NeonText>
              </View>
            </View>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              This is outcome composition, not a conversion rate. Beacon records declared-fit context when a real mutual is created, but does not persist every person-to-person fit exposure just to manufacture a funnel denominator.
            </NeonText>

            {mutualDomains.length > 0 ? (
              <View style={styles.outcomeDomains}>
                <NeonText variant="label" tone="muted">SUPPORTED MUTUAL DOMAINS</NeonText>
                {mutualDomains.slice(0, 6).map((domain) => (
                  <View key={domain.intent_key} style={styles.outcomeDomainRow}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{EVENT_INTENT_LABELS[domain.intent_key]}</NeonText>
                      <NeonText variant="bodyMuted" style={styles.smallTop}>
                        {domain.mutual_match_count} mutual matches carried this explicit overlap.
                      </NeonText>
                    </View>
                    <Pill label={`${percent(domain.two_way_share)} TWO-WAY`} tone="neutral" />
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Counts remain withheld until at least five mutual matches exist. Domain-level outcome rows require at least five mutual matches in that domain as well, so the host cannot reverse-engineer a small number of participant pairs.
          </NeonText>
        )}
      </Surface>

      {programming.length > 0 ? (
        <View style={styles.section}>
          <NeonText variant="label" tone="accent">PROGRAMMING QUEUE</NeonText>
          <NeonText variant="bodyMuted">
            Deterministic actions from the released need/supply mix and cohort-gated mutual composition. Nothing here identifies a participant or executes automatically.
          </NeonText>
          {programming.slice(0, 3).map((action) => (
            <Surface key={action.id} elevated padded style={styles.programCard}>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <NeonText variant="label" tone="muted">{EVENT_INTENT_LABELS[action.intentKey].toUpperCase()}</NeonText>
                  <NeonText variant="h2" style={styles.smallTop}>{action.title}</NeonText>
                </View>
                <Pill label={postureLabel(action.posture)} tone={postureTone(action.posture)} />
              </View>
              <NeonText variant="bodyMuted" style={styles.smallTop}>{action.rationale}</NeonText>
              <View style={styles.actionBlock}>
                <NeonText variant="label" tone="accent">POSSIBLE HOST ACTION</NeonText>
                <NeonText variant="bodyMuted" style={styles.smallTop}>{action.suggestedAction}</NeonText>
              </View>
              <NeonText variant="bodyMuted" style={styles.measurementCopy}>{action.measurement}</NeonText>
              <NeonText variant="label" tone="muted" style={styles.priorityCopy}>
                EVIDENCE WEIGHT {Math.round(action.priority * 100)} / 100
              </NeonText>
            </Surface>
          ))}
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Surface elevated padded style={styles.emptyCard}>
          <NeonText variant="h2">No category has enough support to release yet.</NeonText>
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Beacon suppresses categories until at least five approved participants have declared something in that domain. This avoids turning a small cohort into an identifiable host report.
          </NeonText>
        </Surface>
      ) : (
        <>
          <View style={styles.summaryRow}>
            <Surface padded style={styles.summaryCard}>
              <NeonText variant="label" tone="muted">VISIBLE DOMAINS</NeonText>
              <NeonText variant="h1" tone="accent" style={styles.metricValue}>{rows.length}</NeonText>
            </Surface>
            <Surface padded style={styles.summaryCard}>
              <NeonText variant="label" tone="muted">LARGEST SUPPORTED COHORT</NeonText>
              <NeonText variant="h1" style={styles.metricValue}>{summary.contributors}</NeonText>
            </Surface>
          </View>

          {summary.needHeavy || summary.offerHeavy ? (
            <Surface elevated padded style={styles.readCard}>
              <NeonText variant="label" tone="premium">PROGRAMMING READ</NeonText>
              {summary.needHeavy ? (
                <NeonText variant="bodyMuted" style={styles.smallTop}>
                  Strongest current unmet domain: {EVENT_INTENT_LABELS[summary.needHeavy.intent_key]} — {summary.needHeavy.seeking_count} looking for help versus {summary.needHeavy.offering_count} explicitly open to helping.
                </NeonText>
              ) : null}
              {summary.offerHeavy ? (
                <NeonText variant="bodyMuted" style={styles.smallTop}>
                  Strongest current excess supply: {EVENT_INTENT_LABELS[summary.offerHeavy.intent_key]} — {summary.offerHeavy.offering_count} open to helping versus {summary.offerHeavy.seeking_count} looking for it.
                </NeonText>
              ) : null}
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                Use this as an aggregate programming or facilitation signal—not as proof of individual demand, intent, or conversion.
              </NeonText>
            </Surface>
          ) : null}

          <View style={styles.section}>
            <NeonText variant="label" tone="accent">SUPPORTED DOMAINS</NeonText>
            {rows.map((row) => {
              const total = Math.max(1, row.seeking_count + row.offering_count);
              const seekShare = row.seeking_count / total;
              return (
                <Surface key={row.intent_key} padded style={styles.domainCard}>
                  <View style={styles.headerRow}>
                    <View style={{ flex: 1 }}>
                      <NeonText variant="h2">{EVENT_INTENT_LABELS[row.intent_key]}</NeonText>
                      <NeonText variant="label" tone="muted" style={styles.smallTop}>
                        {row.contributor_count} DECLARING PARTICIPANTS
                      </NeonText>
                    </View>
                    <Pill label={balanceLabel(row.balance)} tone={balanceTone(row.balance)} />
                  </View>

                  <View style={styles.countRow}>
                    <View style={styles.countCell}>
                      <NeonText variant="label" tone="muted">LOOKING FOR HELP</NeonText>
                      <NeonText variant="h1">{row.seeking_count}</NeonText>
                    </View>
                    <View style={styles.countCell}>
                      <NeonText variant="label" tone="muted">CAN HELP</NeonText>
                      <NeonText variant="h1">{row.offering_count}</NeonText>
                    </View>
                  </View>

                  <View style={styles.barTrack}>
                    <View style={[styles.seekBar, { flex: Math.max(0.04, seekShare) }]} />
                    <View style={[styles.offerBar, { flex: Math.max(0.04, 1 - seekShare) }]} />
                  </View>
                </Surface>
              );
            })}
          </View>
        </>
      )}

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="warning">AGGREGATE BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          This is not a participant list, popularity score, lead score, or cross-customer benchmark. Small cohorts are suppressed, and the host cannot use this surface to discover who selected an intent or which pair produced a mutual.
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
  heroCopy: { marginTop: spacing.sm, lineHeight: 20 },
  errorCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.lg, borderColor: palette.danger },
  emptyCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.lg },
  outcomeCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.lg, borderColor: palette.premiumSoft },
  outcomeMetrics: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  outcomeMetric: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  outcomeDomains: { marginTop: spacing.lg, gap: spacing.sm },
  outcomeDomainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  summaryCard: { flex: 1, minHeight: 96, borderRadius: radii.lg },
  metricValue: { marginTop: spacing.sm },
  readCard: { marginHorizontal: spacing.xl, marginTop: spacing.md, borderRadius: radii.lg, borderColor: palette.premiumSoft },
  section: { paddingHorizontal: spacing.xl, marginTop: spacing.xl, gap: spacing.sm },
  programCard: { borderRadius: radii.lg, borderColor: palette.hairlineStrong },
  actionBlock: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.accentSoft },
  measurementCopy: { marginTop: spacing.sm, fontSize: 11, lineHeight: 16 },
  priorityCopy: { marginTop: spacing.sm },
  domainCard: { borderRadius: radii.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  countRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  countCell: { flex: 1, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  barTrack: { flexDirection: 'row', height: 5, overflow: 'hidden', borderRadius: 999, marginTop: spacing.md, backgroundColor: palette.hairline },
  seekBar: { backgroundColor: palette.warning },
  offerBar: { backgroundColor: palette.accent },
  boundaryCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg },
});
