import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialWorldIntelligence } from './SpatialWorldIntelligenceEngine';

interface Props {
  intelligence: SpatialWorldIntelligence;
}

export default function SpatialWorldIntelligenceHUD({ intelligence }: Readonly<Props>) {
  const memory = intelligence.memoryInsights[0];
  const clusterCount = intelligence.clusters.length;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>WORLD INTELLIGENCE</Text>
          <Text style={styles.trust}>{intelligence.trust.band.toUpperCase()}</Text>
        </View>
        <Text style={styles.story}>{intelligence.story.narrative}</Text>
        {clusterCount > 0 && (
          <Text style={styles.line}>
            {clusterCount} independent activit{clusterCount === 1 ? 'y zone is' : 'y zones are'} forming across {intelligence.activeSectorCount} sector{intelligence.activeSectorCount === 1 ? '' : 's'}.
          </Text>
        )}
        {intelligence.forecast && (
          <Text style={styles.forecast}>
            Momentum is building on the {intelligence.forecast.directionLabel} · {Math.round(intelligence.forecast.confidence * 100)}% confidence · next {intelligence.forecast.horizonMinutes}m
          </Text>
        )}
        {memory && (
          <Text style={styles.memory}>{memory.title}: {memory.detail}</Text>
        )}
        <Text style={styles.footnote}>{intelligence.trust.explanation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 126,
    alignItems: 'flex-start',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(5,8,18,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#A78BFA', fontSize: 9, fontWeight: '900', letterSpacing: 1.25 },
  trust: { color: '#94A3B8', fontSize: 9, fontWeight: '800', letterSpacing: 0.9 },
  story: { color: '#F8FAFC', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 7 },
  line: { color: '#CBD5E1', fontSize: 11, lineHeight: 16, marginTop: 6 },
  forecast: { color: '#FBBF24', fontSize: 11, lineHeight: 16, fontWeight: '700', marginTop: 7 },
  memory: { color: '#C4B5FD', fontSize: 10, lineHeight: 15, marginTop: 7 },
  footnote: { color: '#64748B', fontSize: 9, lineHeight: 13, marginTop: 7 },
});
