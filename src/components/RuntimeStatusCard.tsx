import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  describeRuntimeHealth,
  type RuntimeReliabilitySnapshot,
} from '../reliability/RuntimeReliabilityEngine';

interface Props {
  snapshot: RuntimeReliabilitySnapshot;
  onRetry?: () => void;
}

export default function RuntimeStatusCard({ snapshot, onRetry }: Props) {
  if (snapshot.health === 'healthy') return null;

  const retryable = snapshot.health === 'degraded' || snapshot.health === 'stale';
  const tone = snapshot.health === 'blocked' ? styles.blocked : styles.degraded;

  return (
    <View style={[styles.shell, tone]} accessibilityRole="summary">
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>RUNTIME HEALTH</Text>
        <Text style={styles.title}>{describeRuntimeHealth(snapshot)}</Text>
        {snapshot.reason ? <Text style={styles.reason}>{snapshot.reason}</Text> : null}
      </View>
      {retryable && onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry live presence now"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>RETRY</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  degraded: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  blocked: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(248, 113, 113, 0.28)',
  },
  copy: { flex: 1 },
  eyebrow: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    marginTop: 4,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
  },
  reason: {
    marginTop: 5,
    color: '#A8B3C5',
    fontSize: 12,
    lineHeight: 17,
  },
  retry: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  retryText: {
    color: '#FCD34D',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  pressed: { opacity: 0.72 },
});
