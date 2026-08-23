import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialOrganizerCommandState } from './SpatialOrganizerCommandEngine';

interface Props {
  state: SpatialOrganizerCommandState;
}

export default function SpatialOrganizerCommandHUD({ state }: Readonly<Props>) {
  const primary = state.primary;
  if (!primary) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>VENUE COMMAND</Text>
          <Text style={styles.score}>{Math.round(state.operatorScore * 100)}% operator confidence</Text>
        </View>
        <Text style={styles.title}>{primary.title}</Text>
        <Text style={styles.detail}>{primary.detail}</Text>
        <Text style={styles.action}>{primary.operatorAction}</Text>
        <Text style={styles.measure}>{primary.measurement}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 18, right: 16, width: 360 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.34)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(4,9,14,0.92)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  eyebrow: { color: '#86EFAC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  score: { color: '#64748B', fontSize: 9, fontWeight: '700' },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 15, lineHeight: 20, fontWeight: '900' },
  detail: { marginTop: 4, color: '#CBD5E1', fontSize: 11, lineHeight: 16 },
  action: { marginTop: 8, color: '#DCFCE7', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  measure: { marginTop: 7, color: '#64748B', fontSize: 9, lineHeight: 13 },
});
