import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialContractBoard } from './SpatialContractEngine';

interface SpatialContractHUDProps {
  board: SpatialContractBoard;
  accent: string;
  isPremium: boolean;
}

export default function SpatialContractHUD({
  board,
  accent,
  isPremium,
}: Readonly<SpatialContractHUDProps>) {
  const { active } = board;
  const locked = active.state === 'locked';

  return (
    <View pointerEvents="none" style={styles.shell}>
      <View style={[styles.card, { borderColor: `${accent}66` }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>LIVE CONTRACT</Text>
            <Text style={styles.title}>{locked ? 'NEXT CONTRACT' : active.title}</Text>
          </View>
          <View style={[styles.multiplier, { borderColor: `${accent}55` }]}>
            <Text style={[styles.multiplierText, { color: accent }]}>×{board.fieldMultiplier.toFixed(2)}</Text>
          </View>
        </View>

        <Text style={styles.detail}>{active.detail}</Text>

        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: accent,
                width: `${Math.max(3, active.progress * 100)}%`,
                opacity: locked ? 0.35 : 1,
              },
            ]}
          />
        </View>

        <View style={styles.progressRow}>
          <Text style={styles.progressText}>{active.current}/{active.target}</Text>
          <Text style={styles.completed}>{board.completedCount}/4 complete</Text>
        </View>

        {isPremium && active.premiumInsight && (
          <View style={styles.intelBox}>
            <Text style={[styles.intelLabel, { color: accent }]}>FIELD INTEL</Text>
            <Text style={styles.intelText}>{active.premiumInsight}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 16,
    bottom: 78,
  },
  card: {
    width: 270,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    backgroundColor: 'rgba(7, 10, 16, 0.9)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  eyebrow: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    marginTop: 4,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  multiplier: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
  },
  multiplierText: {
    fontSize: 10,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  detail: {
    marginTop: 8,
    color: '#CBD5E1',
    fontSize: 11,
    lineHeight: 16,
  },
  track: {
    height: 5,
    marginTop: 12,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  progressRow: {
    marginTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: '#94A3B8',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  completed: {
    color: '#64748B',
    fontSize: 10,
  },
  intelBox: {
    marginTop: 10,
    borderRadius: 12,
    padding: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  intelLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  intelText: {
    marginTop: 4,
    color: '#D7E0EC',
    fontSize: 10,
    lineHeight: 14,
  },
});
