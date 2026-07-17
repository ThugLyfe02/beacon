import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialProgressionState } from './SpatialProgressionEngine';

interface SpatialProgressHUDProps {
  progression: SpatialProgressionState;
  accent: string;
}

export default function SpatialProgressHUD({
  progression,
  accent,
}: Readonly<SpatialProgressHUDProps>) {
  return (
    <View style={styles.shell} pointerEvents="none">
      <View style={[styles.card, { borderColor: `${accent}55` }]}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.eyebrow}>FIELD PROGRESS</Text>
            <Text style={styles.rank}>{progression.headline}</Text>
          </View>
          <View style={styles.levelBadge}>
            <Text style={[styles.levelText, { color: accent }]}>LV {progression.level}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: accent,
                width: `${Math.max(4, progression.progress * 100)}%`,
              },
            ]}
          />
        </View>

        <View style={styles.statsRow}>
          <Text style={styles.stat}>{progression.currentPoints} pts</Text>
          <View style={styles.heatRow}>
            {Array.from({ length: 5 }).map((_, index) => (
              <View
                key={`heat-${index}`}
                style={[
                  styles.heatPip,
                  index < progression.heat && { backgroundColor: accent, opacity: 1 },
                ]}
              />
            ))}
          </View>
        </View>

        <Text style={styles.nextAction}>{progression.nextAction}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 78,
    alignItems: 'flex-end',
  },
  card: {
    width: 250,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(7, 10, 16, 0.86)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  eyebrow: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  rank: {
    marginTop: 4,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
  },
  levelBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
  },
  levelText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  progressTrack: {
    height: 5,
    marginTop: 12,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  statsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stat: {
    color: '#94A3B8',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  heatRow: {
    flexDirection: 'row',
    gap: 4,
  },
  heatPip: {
    width: 13,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#334155',
    opacity: 0.45,
  },
  nextAction: {
    marginTop: 10,
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 15,
  },
});
