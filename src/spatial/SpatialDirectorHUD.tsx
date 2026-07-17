import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialDirectorState } from './SpatialDirectorEngine';

interface SpatialDirectorHUDProps {
  director: SpatialDirectorState;
}

export default function SpatialDirectorHUD({ director }: Readonly<SpatialDirectorHUDProps>) {
  return (
    <View pointerEvents="none" style={styles.shell}>
      <View style={[styles.card, { borderColor: `${director.accent}66` }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.act, { color: director.accent }]}>{director.act.toUpperCase()}</Text>
          <View style={styles.intensityTrack}>
            <View
              style={[
                styles.intensityFill,
                {
                  width: `${Math.max(6, Math.round(director.worldIntensity * 100))}%`,
                  backgroundColor: director.accent,
                },
              ]}
            />
          </View>
        </View>
        <Text style={styles.title}>{director.title}</Text>
        <Text style={styles.direction}>{director.direction}</Text>
        {director.degraded && (
          <Text style={styles.degraded}>Field detail reduced until live presence is healthy again.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    top: 18,
    left: 16,
    right: 16,
    alignItems: 'flex-start',
  },
  card: {
    maxWidth: 390,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(5, 8, 14, 0.88)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  act: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  intensityTrack: {
    width: 92,
    height: 3,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  intensityFill: {
    height: '100%',
    borderRadius: 999,
  },
  title: {
    marginTop: 8,
    color: '#F8FAFC',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  direction: {
    marginTop: 5,
    color: '#A8B2C1',
    fontSize: 12,
    lineHeight: 17,
  },
  degraded: {
    marginTop: 8,
    color: '#FCA5A5',
    fontSize: 10,
    lineHeight: 14,
  },
});
