import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialTourController } from './useSpatialTour';

interface Props {
  tour: SpatialTourController;
  landmarkCount: number;
  accent: string;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds >= 60 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`;
}

export default function SpatialTourHUD({ tour, landmarkCount, accent }: Readonly<Props>) {
  if (landmarkCount === 0) return null;

  if (tour.status === 'idle') {
    return (
      <View pointerEvents="box-none" style={styles.compactWrap}>
        <View style={[styles.compactCard, { borderColor: `${accent}55` }]}>
          <View style={styles.compactCopy}>
            <Text style={[styles.eyebrow, { color: accent }]}>FIELD SCOUT</Text>
            <Text style={styles.compactTitle}>
              {tour.unseenCount > 0
                ? `${tour.unseenCount} new world change${tour.unseenCount === 1 ? '' : 's'} to frame`
                : `${landmarkCount} explainable landmark${landmarkCount === 1 ? '' : 's'} available`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a guided tour of the live field"
            onPress={tour.start}
            style={[styles.primaryButton, { borderColor: accent }]}
          >
            <Text style={[styles.primaryText, { color: accent }]}>Scout field</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const step = tour.currentStep;
  const total = tour.plan?.steps.length ?? 0;

  if (tour.status === 'complete') {
    return (
      <View pointerEvents="box-none" style={styles.activeWrap}>
        <View style={[styles.card, { borderColor: `${accent}66` }]}>
          <Text style={[styles.eyebrow, { color: accent }]}>FIELD SCOUT COMPLETE</Text>
          <Text style={styles.title}>You have seen the current shape of the room.</Text>
          <Text style={styles.detail}>
            Beacon will mark newly formed landmarks as the event changes. The live world remains available behind this summary.
          </Text>
          <View style={styles.controls}>
            <Pressable accessibilityRole="button" onPress={tour.replay} style={styles.button}>
              <Text style={styles.buttonText}>Replay</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={tour.stop} style={[styles.button, styles.exitButton]}>
              <Text style={styles.buttonText}>Return to field</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!step) return null;

  return (
    <View pointerEvents="box-none" style={styles.activeWrap}>
      <View style={[styles.card, { borderColor: `${accent}66` }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.eyebrow, { color: accent }]}>GUIDED FIELD SCOUT</Text>
            <Text style={styles.counter}>{tour.stepIndex + 1} / {total}</Text>
          </View>
          <Text style={styles.duration}>{formatDuration(step.durationMs)} frame</Text>
        </View>

        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.detail}>{step.detail}</Text>
        <Text style={styles.confidence}>{Math.round(step.confidence * 100)}% evidence confidence</Text>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.max(4, tour.progress * 100)}%`, backgroundColor: accent }]} />
        </View>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            disabled={tour.stepIndex === 0}
            onPress={tour.previous}
            style={[styles.button, tour.stepIndex === 0 && styles.disabled]}
          >
            <Text style={styles.buttonText}>Previous</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={tour.status === 'running' ? tour.pause : tour.resume}
            style={[styles.button, styles.primaryControl, { borderColor: accent }]}
          >
            <Text style={[styles.buttonText, { color: accent }]}>{tour.status === 'running' ? 'Pause' : 'Resume'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={tour.next} style={styles.button}>
            <Text style={styles.buttonText}>Next</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={tour.stop} style={[styles.button, styles.exitButton]}>
            <Text style={styles.buttonText}>Exit</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 118,
    alignItems: 'center',
  },
  compactCard: {
    width: '100%',
    maxWidth: 430,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(5, 8, 18, 0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  compactCopy: { flex: 1 },
  compactTitle: { marginTop: 4, color: '#E2E8F0', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  activeWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 92,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderWidth: 1,
    borderRadius: 20,
    padding: 15,
    backgroundColor: 'rgba(4, 7, 16, 0.94)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  counter: { marginTop: 3, color: '#64748B', fontSize: 10, fontWeight: '700' },
  duration: { color: '#64748B', fontSize: 9, fontWeight: '700' },
  title: { marginTop: 8, color: '#F8FAFC', fontSize: 16, lineHeight: 21, fontWeight: '800' },
  detail: { marginTop: 5, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  confidence: { marginTop: 7, color: '#64748B', fontSize: 9 },
  track: {
    marginTop: 12,
    height: 4,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  fill: { height: '100%', borderRadius: 999 },
  controls: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  button: {
    minHeight: 34,
    paddingHorizontal: 11,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.22)',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
  },
  primaryButton: {
    minHeight: 36,
    paddingHorizontal: 13,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
  },
  primaryControl: { backgroundColor: 'rgba(15, 23, 42, 0.9)' },
  exitButton: { borderColor: 'rgba(251, 113, 133, 0.28)' },
  disabled: { opacity: 0.35 },
  buttonText: { color: '#CBD5E1', fontSize: 10, fontWeight: '800' },
  primaryText: { fontSize: 10, fontWeight: '900' },
});
