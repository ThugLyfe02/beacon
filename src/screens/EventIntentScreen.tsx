import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import {
  EVENT_INTENT_KEYS,
  EVENT_INTENT_LABELS,
  getMyEventIntent,
  setMyEventIntent,
  type EventIntentKey,
} from '../services/event-intent.service';
import type { ParticipantPlaybookMode } from '../intents/ParticipantEventPlaybook';
import ParticipantEventPlaybookCard from '../components/ParticipantEventPlaybookCard';
import { GridBackground, Loader, NeonText, Pill, Surface } from '../components/ui';
import { palette, radii, spacing } from '../theme';

type Params = { EventIntent: { eventId: string } };

function toggleKey(current: EventIntentKey[], key: EventIntentKey): EventIntentKey[] {
  if (current.includes(key)) return current.filter((item) => item !== key);
  if (current.length >= 6) return current;
  return [...current, key].sort();
}

function IntentChip({
  label,
  selected,
  onPress,
}: Readonly<{
  label: string;
  selected: boolean;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <NeonText variant="label" tone={selected ? 'accent' : 'muted'}>{label}</NeonText>
    </Pressable>
  );
}

export default function EventIntentScreen() {
  const route = useRoute<RouteProp<Params, 'EventIntent'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
  const [seeking, setSeeking] = useState<EventIntentKey[]>([]);
  const [offering, setOffering] = useState<EventIntentKey[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMyEventIntent(eventId);
      if (result.error) throw new Error(result.error.message);
      setSeeking(result.data?.seeking ?? []);
      setOffering(result.data?.offering ?? []);
      setEnabled(result.data?.enabled ?? true);
      setSavedAt(result.data?.updated_at ?? null);
    } catch (error) {
      Alert.alert('Could not load your event focus', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const reciprocalDomains = useMemo(
    () => seeking.filter((key) => offering.includes(key)),
    [offering, seeking],
  );

  const applyPlaybookSuggestion = useCallback((
    key: EventIntentKey,
    mode: ParticipantPlaybookMode,
  ) => {
    const needsSeeking = mode !== 'offering' && !seeking.includes(key);
    const needsOffering = mode !== 'seeking' && !offering.includes(key);

    // The playbook is only a draft aid. It never evicts a current choice to make
    // room for historical evidence, and it never saves on the participant's behalf.
    if ((needsSeeking && seeking.length >= 6) || (needsOffering && offering.length >= 6)) {
      return;
    }

    if (needsSeeking) setSeeking((current) => [...current, key].sort());
    if (needsOffering) setOffering((current) => [...current, key].sort());
  }, [offering, seeking]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await setMyEventIntent({ eventId, seeking, offering, enabled });
      if (result.error || !result.data) throw new Error(result.error?.message ?? 'The event focus was not saved.');
      setSavedAt(result.data.updated_at);
      Alert.alert(
        'Saved',
        enabled
          ? 'Beacon will use only explicit pairwise overlaps from these selections. It will not infer intent from your movement or browsing.'
          : 'Declared fit is paused for this event. Your saved selections are not used in pairwise fit while disabled.',
      );
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  }, [enabled, eventId, offering, seeking]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={58} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading your event focus
        </NeonText>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <GridBackground intensity={0.34} />

      <View style={styles.hero}>
        <Pill label="Declared fit" tone="accent" dot />
        <NeonText variant="display" glow style={{ marginTop: spacing.sm }}>
          Tell Beacon what would actually make this event useful.
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.heroCopy}>
          These are explicit event-scoped selections. Beacon compares only the parts of two participants' declarations that intersect. It does not infer private intent from clicks, dwell time, profile views, or movement.
        </NeonText>
      </View>

      <Surface elevated padded style={styles.controlCard}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <NeonText variant="h2">Use declared fit in this event</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              Turn this off without deleting your selections.
            </NeonText>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: palette.hairlineStrong, true: palette.accentDim }}
            thumbColor={enabled ? palette.accent : palette.textMuted}
            ios_backgroundColor={palette.hairlineStrong}
          />
        </View>
      </Surface>

      <ParticipantEventPlaybookCard
        eventId={eventId}
        seeking={seeking}
        offering={offering}
        onApply={applyPlaybookSuggestion}
      />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="accent">I'M LOOKING FOR HELP WITH</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              Pick up to six domains. A peer sees only the domains where their own “can help” selection intersects with yours.
            </NeonText>
          </View>
          <Pill label={`${seeking.length}/6`} tone={seeking.length >= 6 ? 'warning' : 'neutral'} />
        </View>
        <View style={styles.chipGrid}>
          {EVENT_INTENT_KEYS.map((key) => (
            <IntentChip
              key={`seeking-${key}`}
              label={EVENT_INTENT_LABELS[key]}
              selected={seeking.includes(key)}
              onPress={() => setSeeking((current) => toggleKey(current, key))}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <NeonText variant="label" tone="accent">I CAN HELP WITH</NeonText>
            <NeonText variant="bodyMuted" style={styles.smallTop}>
              These are things you are deliberately open to being approached about during this event.
            </NeonText>
          </View>
          <Pill label={`${offering.length}/6`} tone={offering.length >= 6 ? 'warning' : 'neutral'} />
        </View>
        <View style={styles.chipGrid}>
          {EVENT_INTENT_KEYS.map((key) => (
            <IntentChip
              key={`offering-${key}`}
              label={EVENT_INTENT_LABELS[key]}
              selected={offering.includes(key)}
              onPress={() => setOffering((current) => toggleKey(current, key))}
            />
          ))}
        </View>
      </View>

      <Surface padded style={styles.explainCard}>
        <NeonText variant="label" tone="premium">HOW THE FIT WORKS</NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          If you select “Capital” under looking for and another attendee explicitly selects “Capital” under can help, Beacon can mark that pair as a declared fit. If the reverse is also true on any domain, the pair becomes a two-way declared fit.
        </NeonText>
        <NeonText variant="bodyMuted" style={styles.smallTop}>
          Beacon never publishes a popularity score or a full list of what another person selected. Only the intersection that is relevant to you can enter your private field.
        </NeonText>
        {reciprocalDomains.length > 0 ? (
          <NeonText variant="bodyMuted" style={styles.smallTop}>
            You currently both seek and offer: {reciprocalDomains.map((key) => EVENT_INTENT_LABELS[key]).join(', ')}. That is allowed; it simply means you are open to both sides of those conversations.
          </NeonText>
        ) : null}
      </Surface>

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={save}
        style={[styles.saveButton, saving && styles.disabled]}
      >
        <NeonText variant="label" tone="accent">{saving ? 'SAVING…' : 'SAVE EVENT FOCUS'}</NeonText>
      </Pressable>

      {savedAt ? (
        <NeonText variant="bodyMuted" style={styles.savedCopy}>
          Last saved {new Date(savedAt).toLocaleString()}.
        </NeonText>
      ) : null}

      <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
        <NeonText variant="label" tone="muted">BACK TO EVENT</NeonText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  content: { paddingBottom: spacing.xxxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  hero: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md },
  heroCopy: { marginTop: spacing.sm, lineHeight: 20 },
  controlCard: { marginHorizontal: spacing.xl, marginTop: spacing.sm, borderRadius: radii.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  smallTop: { marginTop: 4 },
  chipGrid: { marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
  chipSelected: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  explainCard: { marginHorizontal: spacing.xl, marginTop: spacing.xl, borderRadius: radii.lg, borderColor: palette.premiumSoft },
  saveButton: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  disabled: { opacity: 0.45 },
  savedCopy: { marginHorizontal: spacing.xl, marginTop: spacing.sm, textAlign: 'center' },
  closeButton: { alignSelf: 'center', marginTop: spacing.lg, padding: spacing.md },
});
