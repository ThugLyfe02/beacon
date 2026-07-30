import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SpatialOutcomeBridge } from './SpatialOutcomeBridgeEngine';

interface Props {
  bridge: SpatialOutcomeBridge;
  accent: string;
  onPrimaryAction: () => void;
}

const LABELS: Record<SpatialOutcomeBridge['primaryAction'], string> = {
  'keep-scouting': 'Scout the field',
  'open-mutual': 'Open mutuals',
  'finish-contract': 'Finish next step',
  'review-vault': 'Review Vault',
};

export default function SpatialOutcomeBridgeHUD({ bridge, accent, onPrimaryAction }: Readonly<Props>) {
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, { borderColor: `${accent}55` }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.eyebrow, { color: accent }]}>REAL-WORLD HANDOFF</Text>
          <Text style={styles.state}>{bridge.state.toUpperCase()}</Text>
        </View>
        <Text style={styles.title}>{bridge.headline}</Text>
        <Text style={styles.detail}>{bridge.detail}</Text>
        {bridge.completionEvidence.length > 0 && (
          <Text style={styles.evidence}>{bridge.completionEvidence.slice(0, 3).join(' · ')}</Text>
        )}
        <View style={styles.footerRow}>
          <Text style={styles.unresolved}>{bridge.unresolvedValueCount} live item{bridge.unresolvedValueCount === 1 ? '' : 's'} remain</Text>
          <Pressable accessibilityRole="button" onPress={onPrimaryAction} style={[styles.button, { borderColor: accent }]}>
            <Text style={[styles.buttonText, { color: accent }]}>{LABELS[bridge.primaryAction]}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 126, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(5, 8, 18, 0.92)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  state: { color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  title: { marginTop: 7, color: '#F8FAFC', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  detail: { marginTop: 4, color: '#A8B2C1', fontSize: 11, lineHeight: 16 },
  evidence: { marginTop: 8, color: '#CBD5E1', fontSize: 10, lineHeight: 14 },
  footerRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  unresolved: { color: '#64748B', fontSize: 10, flex: 1 },
  button: {
    minHeight: 32,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
  },
  buttonText: { fontSize: 10, fontWeight: '800' },
});
