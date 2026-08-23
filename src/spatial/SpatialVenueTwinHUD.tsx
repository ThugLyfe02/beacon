import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { VenueTwinSnapshot } from './SpatialVenueTwinEngine';

interface Props {
  twin: VenueTwinSnapshot;
}

export default function SpatialVenueTwinHUD({ twin }: Readonly<Props>) {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>VENUE TWIN</Text>
          <Text style={styles.confidence}>{Math.round(twin.overallConfidence * 100)}% confidence</Text>
        </View>
        <Text style={styles.title}>{twin.operationalNarrative}</Text>
        <View style={styles.metrics}>
          <Text style={styles.metric}>{twin.activeZoneCount} active zones</Text>
          <Text style={styles.metric}>{twin.saturatedZoneCount} saturated</Text>
          <Text style={styles.metric}>{twin.transitions.length} aggregate flows</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, top: 318, width: 360 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
    borderRadius: 18,
    padding: 13,
    backgroundColor: 'rgba(5,8,18,0.9)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#C4B5FD', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  confidence: { color: '#64748B', fontSize: 9, fontWeight: '700' },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  metrics: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { color: '#94A3B8', fontSize: 9, fontWeight: '700' },
});
