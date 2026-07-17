import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AlmostDiscoveredMoment } from './SpatialInteractionEngine';
import type { SpatialWorldOrchestration } from './SpatialWorldOrchestrator';
import type { TemporalArchitectureState } from './TemporalArchitectureEngine';

interface SpatialNarrativeHUDProps {
  temporal: TemporalArchitectureState;
  orchestration: SpatialWorldOrchestration;
  almostDiscovered: AlmostDiscoveredMoment[];
  accent: string;
}

export default function SpatialNarrativeHUD({
  temporal,
  orchestration,
  almostDiscovered,
  accent,
}: Readonly<SpatialNarrativeHUDProps>) {
  const almost = almostDiscovered[0];
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.card, { borderColor: `${accent}55` }]}>
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: accent }]}>{temporal.phase.toUpperCase()}</Text>
          <Text style={styles.coherence}>{Math.round(orchestration.worldCoherence * 100)}% coherent</Text>
        </View>
        <Text style={styles.title}>{temporal.title}</Text>
        <Text style={styles.detail}>{orchestration.systemNarrative}</Text>
        {almost && <Text style={styles.almost}>{almost.copy}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 128,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    backgroundColor: 'rgba(6, 8, 18, 0.88)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  coherence: { color: '#64748B', fontSize: 10, fontWeight: '700' },
  title: { marginTop: 6, color: '#F8FAFC', fontSize: 15, fontWeight: '800' },
  detail: { marginTop: 4, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  almost: { marginTop: 8, color: '#CBD5E1', fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
});
