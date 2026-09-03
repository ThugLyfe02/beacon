import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getEventHandshakeHealth, type EventHandshakeHealth } from '../services/offline-handshake.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
}

const REFRESH_MS = 30_000;

function metric(value: number | null): string {
  return value == null ? '—' : String(value);
}

/**
 * Host-scoped operational health for the explicit handshake protocol.
 *
 * This surface intentionally reports protocol behavior, not participant quality
 * or relationship outcomes. The RPC suppresses all counts until the event has a
 * minimum supported cohort and never returns participant identities, tokens,
 * acknowledgement material, or pair-level history.
 */
export default function HandshakeHealthCard({ eventId }: Readonly<Props>) {
  const [health, setHealth] = useState<EventHandshakeHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await getEventHandshakeHealth(eventId);
    if (result.error) {
      setError('Handshake health is temporarily unavailable. Participant handshakes continue to reconcile independently.');
      return;
    }
    setError(null);
    setHealth(result.data);
  }, [eventId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!health && !error) return null;

  if (error) {
    return (
      <Surface padded style={styles.card}>
        <Pill label="PROTOCOL HEALTH" tone="neutral" />
        <NeonText variant="bodyMuted" style={styles.copy}>{error}</NeonText>
      </Surface>
    );
  }

  if (!health?.supported) {
    return (
      <Surface padded style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="accent">MEET IN BEACON · PROTOCOL HEALTH</NeonText>
            <NeonText variant="h2" style={styles.title}>Evidence is still cohort building.</NeonText>
          </View>
          <Pill label="SUPPRESSED" tone="neutral" />
        </View>
        <NeonText variant="bodyMuted" style={styles.copy}>
          Beacon withholds handshake counts until at least five event-scoped capabilities exist. This avoids turning an operational diagnostic into a small-group interaction report.
        </NeonText>
      </Surface>
    );
  }

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <NeonText variant="label" tone="accent">MEET IN BEACON · PROTOCOL HEALTH</NeonText>
          <NeonText variant="h2" style={styles.title}>Can explicit meetings survive degraded connectivity?</NeonText>
        </View>
        <Pill label="SUPPORTED" tone="success" dot />
      </View>

      <View style={styles.metrics}>
        <View style={styles.metricCell}>
          <NeonText variant="label" tone="muted">VERIFIED</NeonText>
          <NeonText variant="h1" tone="accent">{metric(health.verifiedCount)}</NeonText>
        </View>
        <View style={styles.metricCell}>
          <NeonText variant="label" tone="muted">WAITING</NeonText>
          <NeonText variant="h1">{metric(health.pendingCount)}</NeonText>
        </View>
        <View style={styles.metricCell}>
          <NeonText variant="label" tone="muted">OFFLINE RECONCILED</NeonText>
          <NeonText variant="h1" tone="premium">{metric(health.offlineVerifiedCount)}</NeonText>
        </View>
        <View style={styles.metricCell}>
          <NeonText variant="label" tone="muted">LIVE SERVER</NeonText>
          <NeonText variant="h1">{metric(health.serverLiveVerifiedCount)}</NeonText>
        </View>
      </View>

      <View style={styles.secondaryRow}>
        <NeonText variant="bodyMuted">Expired {metric(health.expiredCount)}</NeonText>
        <NeonText variant="bodyMuted">Conflict / replay {metric(health.conflictCount)}</NeonText>
        <NeonText variant="bodyMuted">Safety-held {metric(health.safetyBlockCount)}</NeonText>
      </View>

      <NeonText variant="bodyMuted" style={styles.boundary}>
        These are protocol-health counts only. They do not identify who met, rank participants, measure networking quality, or imply that a verified handshake created a relationship outcome.
      </NeonText>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    borderRadius: radii.lg,
    borderColor: 'rgba(110,231,183,0.24)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: { marginTop: 4 },
  copy: { marginTop: spacing.sm, lineHeight: 18 },
  metrics: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricCell: {
    width: '47%',
    minHeight: 78,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
  },
  secondaryRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  boundary: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
    fontSize: 10,
    lineHeight: 15,
  },
});
