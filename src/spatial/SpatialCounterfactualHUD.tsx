import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialCounterfactualState } from './SpatialCounterfactualEngine';

interface Props {
  state: SpatialCounterfactualState;
  accent: string;
  onPrimaryAction: () => void;
}

export default function SpatialCounterfactualHUD({ state, accent, onPrimaryAction }: Readonly<Props>) {
  const primary = state.primary;
  if (!primary) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, { borderColor: `${accent}55` }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.eyebrow, { color: accent }]}>OPPORTUNITY DELTA</Text>
          <Text style={styles.delta}>+{Math.round(state.opportunityDelta * 100)} pts</Text>
        </View>
        <Text style={styles.title}>{primary.title}</Text>
        <Text style={styles.detail}>{primary.detail}</Text>
        <Text style={styles.evidence}>{primary.evidence.slice(0, 3).join(' · ')}</Text>
        <View style={styles.footerRow}>
          <Text style={styles.metric}>{Math.round(primary.projectedImpact * 100)}% projected impact</Text>
          <Text style={styles.metric}>{Math.round(primary.confidence * 100)}% confidence</Text>
          <Pressable accessibilityRole="button" onPress={onPrimaryAction} style={[styles.button, { borderColor: accent }]}>
            <Text style={[styles.buttonText, { color: accent }]}>Act on delta</Text>
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
    maxWidth: 440,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: 'rgba(4, 8, 16, 0.95)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  delta: { color: '#F8FAFC', fontSize: 10, fontWeight: '900' },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 16, lineHeight: 21, fontWeight: '900' },
  detail: { marginTop: 4, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  evidence: { marginTop: 8, color: '#CBD5E1', fontSize: 10, lineHeight: 14 },
  footerRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' },
  metric: { color: '#64748B', fontSize: 9 },
  button: {
    marginLeft: 'auto',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  buttonText: { fontSize: 10, fontWeight: '900' },
});
