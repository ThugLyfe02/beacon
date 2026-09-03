import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { EVENT_INTENT_LABELS, type EventIntentKey } from '../services/event-intent.service';
import {
  getEventOutcomeReceiptDomains,
  getEventOutcomeReceiptSummary,
  getEventOutcomeReceiptTypes,
  type EventOutcomeReceiptDomainEvidence,
  type EventOutcomeReceiptSummary,
  type EventOutcomeReceiptTypeEvidence,
} from '../services/outcome-receipt.service';
import { getOutcomeReceiptDefinition } from '../outcomes/OutcomeReceiptModel';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
}

const REFRESH_MS = 30_000;

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export default function OutcomeReceiptEvidenceCard({ eventId }: Readonly<Props>) {
  const [summary, setSummary] = useState<EventOutcomeReceiptSummary | null>(null);
  const [types, setTypes] = useState<EventOutcomeReceiptTypeEvidence[]>([]);
  const [domains, setDomains] = useState<EventOutcomeReceiptDomainEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    const [summaryResult, typeResult, domainResult] = await Promise.all([
      getEventOutcomeReceiptSummary(eventId),
      getEventOutcomeReceiptTypes(eventId),
      getEventOutcomeReceiptDomains(eventId),
    ]);
    const firstError = summaryResult.error ?? typeResult.error ?? domainResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setError(null);
    }
    if (!summaryResult.error) setSummary(summaryResult.data);
    if (!typeResult.error) setTypes(typeResult.data);
    if (!domainResult.error) setDomains(domainResult.data);
    if (manual) setRefreshing(false);
  }, [eventId]);

  useEffect(() => {
    void load(false);
    const timer = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!summary && !error) return null;

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="premium">PARTICIPANT-OWNED OUTCOME EVIDENCE</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>What participants deliberately say happened next</NeonText>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void load(true)} disabled={refreshing} style={styles.refreshButton}>
          <NeonText variant="label" tone="accent">{refreshing ? '…' : '↻'}</NeonText>
        </Pressable>
      </View>

      {error ? (
        <NeonText variant="bodyMuted" style={styles.errorText}>{error}</NeonText>
      ) : null}

      {summary && !summary.supported ? (
        <View style={styles.buildingPanel}>
          <Pill label="COHORT BUILDING" tone="neutral" />
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            Receipt-specific counts stay withheld until at least five distinct mutuals carry a current participant attestation. A tiny outcome cohort should not become a pair-discovery surface for the host.
          </NeonText>
        </View>
      ) : null}

      {summary?.supported ? (
        <>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">SUPPORTED MUTUALS</NeonText>
              <NeonText variant="h1">{summary.totalMutualMatches ?? '—'}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">WITH A RECEIPT</NeonText>
              <NeonText variant="h1" tone="accent">{summary.mutualsWithParticipantReceipt ?? '—'}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">COMPATIBLE PAIR EVIDENCE</NeonText>
              <NeonText variant="h1">{summary.mutualsWithCompatibleReceipts ?? '—'}</NeonText>
            </View>
            <View style={styles.metric}>
              <NeonText variant="label" tone="muted">SAME FACT · BOTH SIDES</NeonText>
              <NeonText variant="h1" tone="premium">{summary.mutualsWithBilateralConfirmation ?? '—'}</NeonText>
            </View>
          </View>

          <View style={styles.shareRow}>
            <View style={styles.shareItem}>
              <NeonText variant="label" tone="muted">RECEIPT SHARE OF MUTUALS</NeonText>
              <NeonText variant="h2">{percent(summary.receiptShareOfMutuals)}</NeonText>
            </View>
            <View style={styles.shareItem}>
              <NeonText variant="label" tone="muted">BILATERAL SHARE OF MUTUALS</NeonText>
              <NeonText variant="h2">{percent(summary.bilateralConfirmationShareOfMutuals)}</NeonText>
            </View>
          </View>

          {types.length > 0 ? (
            <View style={styles.evidenceSection}>
              <NeonText variant="label" tone="accent">SUPPORTED RECEIPT TYPES</NeonText>
              {types.slice(0, 5).map((row) => (
                <View key={row.receiptType} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{getOutcomeReceiptDefinition(row.receiptType).label}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      {row.mutualMatchCount} mutuals carry this current attestation · {row.bilateralConfirmedMatchCount} independently confirmed by both sides
                    </NeonText>
                  </View>
                  <Pill label={percent(row.shareOfAttestedMutuals)} tone="neutral" />
                </View>
              ))}
            </View>
          ) : null}

          {domains.length > 0 ? (
            <View style={styles.evidenceSection}>
              <NeonText variant="label" tone="accent">SUPPORTED DECLARED DOMAINS</NeonText>
              {domains.slice(0, 5).map((row) => (
                <View key={row.intentKey} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <NeonText variant="h2">{EVENT_INTENT_LABELS[row.intentKey as EventIntentKey] ?? row.intentKey}</NeonText>
                    <NeonText variant="bodyMuted" style={styles.smallTop}>
                      {row.mutualMatchCount} attested mutuals · {row.compatibleReceiptMatchCount} with compatible independent evidence · {row.bilateralConfirmedMatchCount} exact bilateral confirmations
                    </NeonText>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <View style={styles.boundary}>
        <NeonText variant="label" tone="warning">EVIDENCE BOUNDARY</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          These are participant attestations among real mutuals. “Both confirmed” means two people independently recorded compatible facts. Beacon does not expose the pair, inspect messages, or claim a deal, hire, investment, partnership, or causal conversion occurred.
        </NeonText>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.xl, borderColor: palette.premiumSoft },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  refreshButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, borderWidth: 1, borderColor: palette.hairlineStrong },
  smallTop: { marginTop: 4 },
  errorText: { marginTop: spacing.md, color: palette.danger },
  buildingPanel: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: palette.surface },
  metrics: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '47%', padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  shareRow: { marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm },
  shareItem: { flex: 1, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.hairline },
  evidenceSection: { marginTop: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  boundary: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairlineStrong },
});
