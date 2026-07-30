import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialCommitmentState } from './SpatialCommitmentEngine';

interface Props {
  state: SpatialCommitmentState;
  accent: string;
  onOpenPrimary: () => void;
}

export default function SpatialCommitmentHUD({ state, accent, onOpenPrimary }: Readonly<Props>) {
  const primary = state.primary;
  if (!primary) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, { borderColor: `${accent}66` }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.eyebrow, { color: accent }]}>COMMITMENT QUEUE</Text>
          <Text style={styles.count}>{state.remainingCount} open</Text>
        </View>
        <Text style={styles.title}>{primary.title}</Text>
        <Text style={styles.detail}>{primary.detail}</Text>
        <Text style={styles.evidence}>{primary.evidence.slice(0, 2).join(' · ') || 'Verified live-field evidence'}</Text>
        <View style={styles.footerRow}>
          <View style={styles.track}>
            <View style={[styles.fill, { backgroundColor: accent, width: `${Math.max(5, state.completionRatio * 100)}%` }]} />
          </View>
          <Pressable accessibilityRole="button" onPress={onOpenPrimary} style={[styles.button, { borderColor: accent }]}>
            <Text style={[styles.buttonText, { color: accent }]}>Open next move</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 126, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 430,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: 'rgba(5, 8, 18, 0.94)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  count: { color: '#64748B', fontSize: 9, fontWeight: '800' },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 16, lineHeight: 21, fontWeight: '900' },
  detail: { marginTop: 4, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  evidence: { marginTop: 8, color: '#CBD5E1', fontSize: 10, lineHeight: 14 },
  footerRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 5, overflow: 'hidden', borderRadius: 999, backgroundColor: 'rgba(148,163,184,0.16)' },
  fill: { height: '100%', borderRadius: 999 },
  button: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.8)' },
  buttonText: { fontSize: 10, fontWeight: '900' },
});
