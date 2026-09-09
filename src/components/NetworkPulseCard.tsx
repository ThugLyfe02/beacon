import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { getMyNetworkPulse, type NetworkPulse } from '../services/networkPulse.service';
import { palette, radii, spacing } from '../theme';
import { NeonText, Pill, Surface } from './ui';

function shapeLabel(shape: NetworkPulse['shape']): string {
  switch (shape) {
    case 'bridging': return 'BRIDGING';
    case 'forming': return 'FORMING';
    default: return 'WARMING UP';
  }
}

function reachLabel(reach: NetworkPulse['reachBand']): string {
  switch (reach) {
    case 'broad': return 'BROAD REACH';
    case 'expanding': return 'EXPANDING';
    case 'local': return 'LOCAL REACH';
    default: return 'DIRECT ONLY';
  }
}

export default function NetworkPulseCard() {
  const [pulse, setPulse] = useState<NetworkPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPulse(await getMyNetworkPulse());
    } catch {
      setPulse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Surface padded style={styles.card}>
        <Pill label="NETWORK PULSE" tone="neutral" dot />
        <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>Reading your verified network activity…</NeonText>
      </Surface>
    );
  }

  if (!pulse) return null;

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Pill label="NETWORK PULSE · YOUR VIEW" tone="accent" dot />
          <NeonText variant="h2" style={{ marginTop: spacing.sm }}>
            {shapeLabel(pulse.shape)} · {reachLabel(pulse.reachBand)}
          </NeonText>
        </View>
        <NeonText variant="display" tone="accent" glow style={styles.score}>{Math.round(pulse.momentum)}</NeonText>
      </View>

      <View style={styles.metrics}>
        <Metric label="EVENTS" value={pulse.eventCount} />
        <Metric label="MUTUALS" value={pulse.mutualCount} />
        <Metric label="OFFICE HOURS" value={pulse.officeHoursCompleted} />
        <Metric label="OUTCOMES" value={pulse.outcomesCompleted} />
      </View>

      <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 18 }}>
        {pulse.secondDegreeReach > 0
          ? `Your confirmed relationships currently touch ${pulse.secondDegreeReach} additional relationship${pulse.secondDegreeReach === 1 ? '' : 's'} at aggregate two-hop distance.`
          : 'Your Pulse grows only from verified activity. Build mutuals and follow-through to expand it.'}
      </NeonText>

      <Pressable onPress={() => setExpanded((value) => !value)} style={styles.explainButton}>
        <NeonText variant="label" tone="accent">{expanded ? 'HIDE HOW THIS WORKS' : 'HOW THIS WORKS'}</NeonText>
      </Pressable>

      {expanded ? (
        <View style={styles.explainBox}>
          <NeonText variant="bodyMuted" style={{ lineHeight: 18 }}>
            {pulse.privacyNote} The deeper Constellation system is not exposed here; this card only summarizes your own verified activity and coarse aggregate reach.
          </NeonText>
        </View>
      ) : null}
    </Surface>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <View style={styles.metric}>
      <NeonText variant="h2" tone="accent">{value}</NeonText>
      <NeonText variant="label" tone="muted">{label}</NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.xl, borderColor: palette.hairlineStrong, marginTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  score: { fontSize: 34, lineHeight: 40 },
  metrics: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metric: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: palette.surface },
  explainButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
  explainBox: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: palette.hairline, paddingTop: spacing.sm },
});
