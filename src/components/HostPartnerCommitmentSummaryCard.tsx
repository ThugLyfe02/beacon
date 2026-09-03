import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  getEventPartnerCommitmentSummary,
  type EventPartnerCommitmentSummary,
} from '../services/partner-commitment.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
  onOpen: () => void;
}

export default function HostPartnerCommitmentSummaryCard({ eventId, onOpen }: Readonly<Props>) {
  const [summary, setSummary] = useState<EventPartnerCommitmentSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEventPartnerCommitmentSummary(eventId);
    setSummary(result.error ? null : result.data);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!summary || summary.exchangeLedgerCount === 0) return null;

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="premium">PARTNER COMMITMENTS</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>Shared operating contracts</NeonText>
        </View>
        <Pill label={`${summary.exchangeLedgerCount} LEDGER${summary.exchangeLedgerCount === 1 ? '' : 'S'}`} tone="premium" />
      </View>

      <NeonText variant="bodyMuted" style={styles.copy}>
        Event-level counts only. Resource quantities stay inside each bilateral ledger because mentor slots, founder seats and facilitator hours are not interchangeable units of “partner value.”
      </NeonText>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <NeonText variant="h2">{summary.acceptedCommitmentCount}</NeonText>
          <NeonText variant="label" tone="muted">ACCEPTED</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="h2">{summary.scheduledOrDeliveringCount}</NeonText>
          <NeonText variant="label" tone="muted">IN DELIVERY</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="h2">{summary.fulfilledCommitmentCount}</NeonText>
          <NeonText variant="label" tone="muted">FULFILLED</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="h2">{summary.unresolvedCommitmentCount}</NeonText>
          <NeonText variant="label" tone="muted">OPEN</NeonText>
        </View>
      </View>

      {summary.partiallyFulfilledCount > 0 ? (
        <NeonText variant="bodyMuted" style={styles.copy}>
          {summary.partiallyFulfilledCount} commitment{summary.partiallyFulfilledCount === 1 ? '' : 's'} currently show measured partial delivery. This is operational state, not partner scoring.
        </NeonText>
      ) : null}

      {summary.pendingAmendmentCount > 0 ? <NeonText variant="bodyMuted" style={styles.copy}>{summary.pendingAmendmentCount} accepted commitment{summary.pendingAmendmentCount === 1 ? ' has' : 's have'} a pending amendment. Existing accepted terms remain in force until the amendment earns fresh acceptance.</NeonText> : null}
      {summary.manualReviewPendingCount > 0 ? <NeonText variant="bodyMuted" style={styles.copy}>{summary.manualReviewPendingCount} manual measurement{summary.manualReviewPendingCount === 1 ? ' is' : 's are'} awaiting required counterparty acknowledgement.</NeonText> : null}
      {summary.manualDisputeCount > 0 ? <NeonText variant="bodyMuted" style={styles.copy}>{summary.manualDisputeCount} manual measurement{summary.manualDisputeCount === 1 ? ' has' : 's have'} an explicit dispute. The ledger records disagreement; it does not score either partner.</NeonText> : null}
      {summary.closedWithoutMeasurementCount > 0 ? <NeonText variant="bodyMuted" style={styles.copy}>{summary.closedWithoutMeasurementCount} accepted commitment{summary.closedWithoutMeasurementCount === 1 ? ' closed' : 's closed'} without sufficient measurement evidence. Missing evidence is not treated as zero delivery.</NeonText> : null}

      <Pressable disabled={loading} onPress={onOpen} style={styles.openButton}>
        <NeonText variant="label" tone="accent">OPEN SHARED LEDGERS →</NeonText>
      </Pressable>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.lg, borderColor: palette.premiumSoft },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  smallTop: { marginTop: 4 },
  copy: { marginTop: spacing.sm },
  metrics: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '47%', borderRadius: radii.md, padding: spacing.sm, backgroundColor: palette.surface },
  openButton: { marginTop: spacing.md, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentSoft },
});
