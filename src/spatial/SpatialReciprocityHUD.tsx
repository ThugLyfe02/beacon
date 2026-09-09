import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialReciprocityState } from './SpatialReciprocityEngine';

interface Props {
  state: SpatialReciprocityState;
  accent: string;
  onOpenPrimary: () => void;
}

const LABELS = {
  'open-commitment': 'Open commitment',
  'request-time': 'Request time',
  'open-mutuals': 'Open mutuals',
  'review-vault': 'Review Vault',
  none: 'Complete',
} as const;

export default function SpatialReciprocityHUD({ state, accent, onOpenPrimary }: Readonly<Props>) {
  const primary = state.primary;
  if (!primary) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, { borderColor: `${accent}66` }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.eyebrow, { color: accent }]}>RECIPROCITY PATH</Text>
          <Text style={styles.state}>{primary.state.toUpperCase()}</Text>
        </View>

        <Text style={styles.title}>{primary.title}</Text>
        <Text style={styles.detail}>{primary.explanation}</Text>

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{Math.round(primary.readiness * 100)}%</Text>
            <Text style={styles.metricLabel}>readiness</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{primary.evidence.length}</Text>
            <Text style={styles.metricLabel}>verified proofs</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{state.reciprocalCount}</Text>
            <Text style={styles.metricLabel}>reciprocal paths</Text>
          </View>
        </View>

        {primary.evidence.length > 0 && (
          <Text style={styles.evidence}>{primary.evidence.slice(0, 3).map((item) => item.label).join(' · ')}</Text>
        )}

        <View style={styles.footerRow}>
          <Text style={styles.systemNarrative} numberOfLines={2}>{state.systemNarrative}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={primary.nextAction === 'none'}
            onPress={onOpenPrimary}
            style={[
              styles.button,
              { borderColor: accent },
              primary.nextAction === 'none' && styles.disabled,
            ]}
          >
            <Text style={[styles.buttonText, { color: accent }]}>{LABELS[primary.nextAction]}</Text>
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
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(4, 7, 16, 0.95)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.25 },
  state: { color: '#94A3B8', fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  title: { marginTop: 8, color: '#F8FAFC', fontSize: 17, lineHeight: 22, fontWeight: '900' },
  detail: { marginTop: 5, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  metricsRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  metric: { flex: 1, borderRadius: 12, padding: 9, backgroundColor: 'rgba(15,23,42,0.72)' },
  metricValue: { color: '#F8FAFC', fontSize: 14, fontWeight: '900' },
  metricLabel: { marginTop: 2, color: '#64748B', fontSize: 9, fontWeight: '700' },
  evidence: { marginTop: 10, color: '#CBD5E1', fontSize: 10, lineHeight: 14 },
  footerRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  systemNarrative: { flex: 1, color: '#7C8AA0', fontSize: 9, lineHeight: 13 },
  button: {
    minHeight: 34,
    paddingHorizontal: 13,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.82)',
  },
  disabled: { opacity: 0.45 },
  buttonText: { fontSize: 10, fontWeight: '900' },
});
