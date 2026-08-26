import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import {
  getWarmIntroductionPreference,
  setWarmIntroductionPreference,
} from '../services/warm-introduction.service';
import { NeonText, Pill, Surface } from './ui';
import { palette, radii, spacing } from '../theme';

interface Props {
  eventId: string;
}

const ACTIVE_LIMITS = [1, 2, 3, 4] as const;

/**
 * Explicit participant control over whether Beacon may ask them to broker a
 * three-party introduction. This setting never publishes the participant's
 * connection graph. A requester learns the connector's identity only after the
 * connector accepts a specific request.
 */
export default function WarmIntroductionPreferenceCard({ eventId }: Readonly<Props>) {
  const [enabled, setEnabled] = useState(false);
  const [maxActive, setMaxActive] = useState(2);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getWarmIntroductionPreference(eventId);
    if (result.error) {
      setError(result.error.message);
    } else {
      setError(null);
      setEnabled(result.data?.enabled ?? false);
      setMaxActive(result.data?.max_active ?? 2);
      setSavedAt(result.data?.updated_at ?? null);
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    const result = await setWarmIntroductionPreference({
      eventId,
      enabled,
      maxActive,
    });
    if (result.error || !result.data) {
      const message = result.error?.message ?? 'Your introduction preference was not saved.';
      setError(message);
      Alert.alert('Could not save', message);
    } else {
      setEnabled(result.data.enabled);
      setMaxActive(result.data.max_active);
      setSavedAt(result.data.updated_at);
      Alert.alert(
        result.data.enabled ? 'Warm introductions enabled' : 'Warm introductions paused',
        result.data.enabled
          ? 'Beacon may ask you to connect two people only when you already have a verified mutual with both. You still approve every request.'
          : 'Beacon will not assign new introduction requests to you for this event.',
      );
    }
    setSaving(false);
  }, [enabled, eventId, maxActive]);

  return (
    <Surface elevated padded style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <NeonText variant="label" tone="premium">WARM INTRODUCTIONS</NeonText>
          <NeonText variant="h2" style={styles.smallTop}>Open to introducing people?</NeonText>
        </View>
        {loading ? (
          <ActivityIndicator color={palette.premium} />
        ) : (
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            disabled={saving}
            trackColor={{ false: palette.hairlineStrong, true: palette.premiumSoft }}
            thumbColor={enabled ? palette.premium : palette.textMuted}
            ios_backgroundColor={palette.hairlineStrong}
          />
        )}
      </View>

      <NeonText variant="bodyMuted" style={styles.bodyCopy}>
        Beacon can ask you to introduce two people only when you already have a real mutual connection with both of them and the requester has an explicit event fit with the target.
      </NeonText>

      <Surface padded style={styles.boundaryCard}>
        <NeonText variant="label" tone="accent">YOUR GRAPH STAYS PRIVATE</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          Requesters do not receive a list of your connections. Your identity stays hidden until you accept one specific introduction, and the target still makes the final decision.
        </NeonText>
      </Surface>

      {enabled ? (
        <View style={styles.limitSection}>
          <View style={styles.limitHeader}>
            <View style={{ flex: 1 }}>
              <NeonText variant="label" tone="muted">SIMULTANEOUS REQUESTS</NeonText>
              <NeonText variant="bodyMuted" style={styles.smallTop}>
                Beacon will not assign more than this many unresolved requests to you at once.
              </NeonText>
            </View>
            <Pill label={`${maxActive} MAX`} tone="premium" />
          </View>
          <View style={styles.limitRow}>
            {ACTIVE_LIMITS.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: maxActive === value }}
                disabled={saving}
                onPress={() => setMaxActive(value)}
                style={[styles.limitButton, maxActive === value && styles.limitButtonActive]}
              >
                <NeonText variant="h2" tone={maxActive === value ? 'premium' : 'muted'}>
                  {value}
                </NeonText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {error ? (
        <NeonText variant="bodyMuted" tone="danger" style={styles.errorCopy}>{error}</NeonText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={loading || saving}
        onPress={save}
        style={[styles.saveButton, (loading || saving) && styles.disabled]}
      >
        <NeonText variant="label" tone="premium">
          {saving ? 'SAVING…' : enabled ? 'SAVE INTRODUCTION AVAILABILITY' : 'PAUSE INTRODUCTION AVAILABILITY'}
        </NeonText>
      </Pressable>

      {savedAt ? (
        <NeonText variant="bodyMuted" style={styles.savedCopy}>
          Last changed {new Date(savedAt).toLocaleString()}.
        </NeonText>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    borderRadius: radii.xl,
    borderColor: palette.premiumSoft,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: { flex: 1 },
  smallTop: { marginTop: 4 },
  bodyCopy: { marginTop: spacing.sm, lineHeight: 20 },
  boundaryCard: {
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderColor: palette.accentDim,
    backgroundColor: palette.accentSoft,
  },
  limitSection: { marginTop: spacing.lg },
  limitHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  limitRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  limitButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  limitButtonActive: {
    borderColor: palette.premium,
    backgroundColor: palette.premiumSoft,
  },
  errorCopy: { marginTop: spacing.md },
  saveButton: {
    minHeight: 48,
    marginTop: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: palette.premiumSoft,
  },
  disabled: { opacity: 0.42 },
  savedCopy: { marginTop: spacing.sm, textAlign: 'center', fontSize: 10 },
});
