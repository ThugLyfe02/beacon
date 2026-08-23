import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VenueScenarioState } from './SpatialVenueScenarioEngine';

interface Props {
  state: VenueScenarioState;
}

export default function SpatialVenueScenarioHUD({ state }: Readonly<Props>) {
  const recommended = state.recommended;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>VENUE SCENARIO</Text>
          <Text style={styles.gain}>+{Math.round(state.projectedGain * 100)} flow pts</Text>
        </View>
        <Text style={styles.title}>{recommended.title}</Text>
        <Text style={styles.detail}>{recommended.rationale}</Text>
        <View style={styles.metrics}>
          <Text style={styles.metric}>Flow {Math.round(recommended.projectedFlowHealth * 100)}%</Text>
          <Text style={styles.metric}>Bottlenecks {recommended.projectedBottlenecks}</Text>
          <Text style={styles.metric}>Confidence {Math.round(recommended.confidence * 100)}%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 168, right: 16, width: 360 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.28)',
    borderRadius: 18,
    padding: 13,
    backgroundColor: 'rgba(4,9,16,0.9)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#7DD3FC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  gain: { color: '#BAE6FD', fontSize: 9, fontWeight: '800' },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 14, lineHeight: 19, fontWeight: '900' },
  detail: { marginTop: 4, color: '#CBD5E1', fontSize: 10, lineHeight: 15 },
  metrics: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { color: '#64748B', fontSize: 9, fontWeight: '700' },
});
