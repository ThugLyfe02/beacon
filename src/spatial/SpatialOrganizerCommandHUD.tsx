import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SpatialOrganizerCommandState } from './SpatialOrganizerCommandEngine';
import type { VenueOperationsRuntimeState } from './VenueOperationsRuntime';

interface Props {
  state: SpatialOrganizerCommandState;
  runtime?: VenueOperationsRuntimeState;
}

function statusLabel(runtime?: VenueOperationsRuntimeState): string {
  if (!runtime) return 'RECOMMENDATION';
  if (runtime.frozen) return 'HOLD';
  if (runtime.primary?.actionReady) return 'ACTION READY';
  if (runtime.primary?.admission.decision === 'review') return 'REVIEW';
  return 'MONITOR';
}

export default function SpatialOrganizerCommandHUD({ state, runtime }: Readonly<Props>) {
  const admitted = runtime?.primary ?? null;
  const primary = admitted?.command ?? state.primary;
  if (!primary) return null;

  const admission = admitted?.admission;
  const status = statusLabel(runtime);
  const score = admission?.score ?? state.operatorScore;
  const policyReason = runtime?.frozen
    ? runtime.narrative
    : admission?.reasons[0] ?? null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.card, admitted?.actionReady ? styles.cardReady : undefined]}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>VENUE OPERATIONS</Text>
          <View style={styles.statusGroup}>
            <Text style={styles.status}>{status}</Text>
            <Text style={styles.score}>{Math.round(score * 100)}% evidence</Text>
          </View>
        </View>
        <Text style={styles.title}>{primary.title}</Text>
        <Text style={styles.detail}>{primary.detail}</Text>
        <View style={styles.divider} />
        <Text style={styles.actionLabel}>OPERATOR ACTION</Text>
        <Text style={styles.action}>{primary.operatorAction}</Text>
        <Text style={styles.measure}>{primary.measurement}</Text>
        {policyReason && <Text style={styles.policy}>{policyReason}</Text>}
        {runtime && (
          <View style={styles.queueRow}>
            <Text style={styles.queueText}>{runtime.actionableCount} ready</Text>
            <Text style={styles.queueText}>{runtime.reviewCount} review</Text>
            <Text style={styles.queueText}>{runtime.blockedCount} blocked</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 18, right: 16, width: 372 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.38)',
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 13,
    backgroundColor: 'rgba(4,9,14,0.94)',
  },
  cardReady: { borderColor: 'rgba(34,197,94,0.42)' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: '#86EFAC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  statusGroup: { alignItems: 'flex-end', gap: 2 },
  status: { color: '#CBD5E1', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  score: { color: '#64748B', fontSize: 9, fontWeight: '700' },
  title: { marginTop: 8, color: '#F8FAFC', fontSize: 16, lineHeight: 21, fontWeight: '900' },
  detail: { marginTop: 4, color: '#CBD5E1', fontSize: 11, lineHeight: 16 },
  divider: { marginTop: 10, height: 1, backgroundColor: 'rgba(148,163,184,0.12)' },
  actionLabel: { marginTop: 9, color: '#64748B', fontSize: 8, fontWeight: '900', letterSpacing: 0.9 },
  action: { marginTop: 3, color: '#DCFCE7', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  measure: { marginTop: 7, color: '#94A3B8', fontSize: 9, lineHeight: 13 },
  policy: { marginTop: 7, color: '#64748B', fontSize: 9, lineHeight: 13 },
  queueRow: { marginTop: 10, flexDirection: 'row', gap: 12 },
  queueText: { color: '#64748B', fontSize: 8, fontWeight: '800' },
});
