import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  getCommunityExchangeOutcomeReceiptSummary,
  type CommunityExchangeOutcomeReceiptSummary,
} from '../services/outcome-receipt.service';
import { NeonText, Pill } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  exchangeId: string;
}

function percent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

export default function CommunityOutcomeReceiptEvidence({ exchangeId }: Readonly<Props>) {
  const [evidence, setEvidence] = useState<CommunityExchangeOutcomeReceiptSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCommunityExchangeOutcomeReceiptSummary(exchangeId).then((result) => {
      if (!cancelled && !result.error) setEvidence(result.data);
    });
    return () => { cancelled = true; };
  }, [exchangeId]);

  if (!evidence) return null;

  if (!evidence.supported) {
    return (
      <View style={styles.boundary}>
        <Pill label="OUTCOME COHORT BUILDING" tone="neutral" />
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          Receipt evidence remains withheld until both communities satisfy the exchange cohort boundary and at least five cross-community mutuals carry participant-owned receipts linked to this exchange.
        </NeonText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <NeonText variant="label" tone="premium">PARTICIPANT-ATTESTED EXCHANGE EVIDENCE</NeonText>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">CROSS-COMMUNITY MUTUALS</NeonText>
          <NeonText variant="h1">{evidence.crossCommunityMutualCount ?? '—'}</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">WITH RECEIPT</NeonText>
          <NeonText variant="h1" tone="accent">{evidence.mutualsWithParticipantReceipt ?? '—'}</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">COMPATIBLE PAIR EVIDENCE</NeonText>
          <NeonText variant="h1">{evidence.compatibleReceiptMatchCount ?? '—'}</NeonText>
        </View>
        <View style={styles.metric}>
          <NeonText variant="label" tone="muted">SAME FACT · BOTH SIDES</NeonText>
          <NeonText variant="h1" tone="premium">{evidence.bilateralConfirmedMatchCount ?? '—'}</NeonText>
        </View>
      </View>
      <NeonText variant="bodyMuted" style={styles.smallTop}>
        {percent(evidence.receiptShareOfCrossCommunityMutuals)} of supported cross-community mutuals currently carry at least one participant receipt. This is receipt composition, not a causal partnership conversion rate.
      </NeonText>
      <NeonText variant="bodyMuted" style={styles.boundaryCopy}>
        Community owners never receive the member pair, private receipt revision history, or a public contributor score.
      </NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.premiumSoft, backgroundColor: palette.surface },
  boundary: { marginTop: spacing.md, padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  metrics: { marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { width: '47%', padding: spacing.sm, borderRadius: radii.md, backgroundColor: palette.void },
  smallTop: { marginTop: 4 },
  boundaryCopy: { marginTop: spacing.sm, fontSize: 10, lineHeight: 15 },
});
