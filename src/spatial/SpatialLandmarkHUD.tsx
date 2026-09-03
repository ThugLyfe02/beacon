import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialLandmarkState } from './SpatialLandmarkEngine';

interface Props {
  state: SpatialLandmarkState;
  onPrevious: () => void;
  onNext: () => void;
  onOpen: () => void;
}

export default function SpatialLandmarkHUD({ state, onPrevious, onNext, onOpen }: Readonly<Props>) {
  if (!state.active) return null;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, state.active.kind === 'declared-fit' && styles.cardDeclaredFit]}>
        <View style={styles.headerRow}>
          <Text style={[styles.eyebrow, state.active.kind === 'declared-fit' && styles.eyebrowDeclaredFit]}>
            {state.active.kind === 'declared-fit' ? 'DECLARED FIT' : 'WORLD LANDMARK'}
          </Text>
          <Text style={styles.counter}>{state.activeIndex + 1}/{state.landmarks.length}</Text>
        </View>
        <Text style={styles.title}>{state.active.title}</Text>
        <Text style={styles.detail}>{state.active.detail}</Text>
        <Text style={[styles.confidence, state.active.evidenceLabel && styles.verifiedEvidence]}>
          {state.active.evidenceLabel ?? `${Math.round(state.active.confidence * 100)}% evidence confidence`}
        </Text>
        <View style={styles.controls}>
          <Pressable accessibilityRole="button" disabled={!state.canCycle} onPress={onPrevious} style={[styles.button, !state.canCycle && styles.disabled]}>
            <Text style={styles.buttonText}>Previous</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            style={[styles.button, styles.primary, state.active.kind === 'declared-fit' && styles.primaryDeclaredFit]}
          >
            <Text style={[styles.buttonText, styles.primaryText]}>Frame landmark</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!state.canCycle} onPress={onNext} style={[styles.button, !state.canCycle && styles.disabled]}>
            <Text style={styles.buttonText}>Next</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, bottom: 118 },
  card: {
    width: 320,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.28)',
    backgroundColor: 'rgba(5, 8, 18, 0.88)',
  },
  cardDeclaredFit: { borderColor: 'rgba(34, 211, 238, 0.34)' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#fbbf24', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  eyebrowDeclaredFit: { color: '#67e8f9' },
  counter: { color: '#64748b', fontSize: 10, fontWeight: '700' },
  title: { marginTop: 7, color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  detail: { marginTop: 4, color: '#a8b2c1', fontSize: 11, lineHeight: 16 },
  confidence: { marginTop: 6, color: '#78716c', fontSize: 10 },
  verifiedEvidence: { color: '#94a3b8', fontWeight: '700' },
  controls: { marginTop: 10, flexDirection: 'row', gap: 6 },
  button: {
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  primary: { borderColor: '#fbbf24', backgroundColor: 'rgba(245, 158, 11, 0.18)' },
  primaryDeclaredFit: { borderColor: '#22d3ee', backgroundColor: 'rgba(8, 145, 178, 0.16)' },
  disabled: { opacity: 0.35 },
  buttonText: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  primaryText: { color: '#f8fafc' },
});
