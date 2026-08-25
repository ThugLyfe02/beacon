import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialCameraMode, SpatialNavigationState } from './SpatialNavigationEngine';

interface Props {
  navigation: SpatialNavigationState;
  onModeChange: (mode: SpatialCameraMode) => void;
}

const MODES: Array<{ mode: SpatialCameraMode; label: string }> = [
  { mode: 'overview', label: 'Overview' },
  { mode: 'explore', label: 'Explore' },
  { mode: 'focus', label: 'Focus' },
  { mode: 'landmark', label: 'Landmark' },
  { mode: 'convergence', label: 'Converge' },
  { mode: 'reflection', label: 'Reflect' },
];

export default function SpatialNavigationHUD({ navigation, onModeChange }: Readonly<Props>) {
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.eyebrow}>WORLD CAMERA</Text>
            <Text style={styles.orientation}>TRUE NORTH FRAME · N ↑</Text>
          </View>
          <Text style={styles.intensity}>{Math.round(navigation.cinematicIntensity * 100)}%</Text>
        </View>
        <Text style={styles.title}>{navigation.title}</Text>
        <Text style={styles.detail}>{navigation.detail}</Text>
        <View style={styles.controls}>
          {MODES.map(({ mode, label }) => {
            const active = navigation.mode === mode;
            const disabled = (mode === 'focus' && !navigation.canFocus)
              || (mode === 'landmark' && !navigation.canFrameLandmark);
            return (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled }}
                disabled={disabled}
                onPress={() => onModeChange(mode)}
                style={[styles.button, active && styles.buttonActive, disabled && styles.buttonDisabled]}
              >
                <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 14,
    bottom: 118,
    alignItems: 'flex-end',
  },
  card: {
    width: 330,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.28)',
    backgroundColor: 'rgba(5, 8, 18, 0.88)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#818cf8', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  orientation: { marginTop: 2, color: '#64748B', fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  intensity: { color: '#64748b', fontSize: 10, fontWeight: '700' },
  title: { marginTop: 7, color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  detail: { marginTop: 4, color: '#a8b2c1', fontSize: 11, lineHeight: 16 },
  controls: { marginTop: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  button: {
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
  },
  buttonActive: { borderColor: '#818cf8', backgroundColor: 'rgba(99, 102, 241, 0.22)' },
  buttonDisabled: { opacity: 0.35 },
  buttonText: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  buttonTextActive: { color: '#e0e7ff' },
});
