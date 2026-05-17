import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createEvent } from '../services/event.service';
import { getCurrentLocation, geocodeAddress } from '../services/location.service';
import type { LocationType } from '../types/database';
import {
  GlowButton,
  GlowInput,
  GridBackground,
  NeonText,
  Pill,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';

interface CreateEventScreenProps {
  userId: string;
  onEventCreated: (eventId: string) => void;
  onCancel: () => void;
}

export default function CreateEventScreen({
  userId,
  onEventCreated,
  onCancel,
}: Readonly<CreateEventScreenProps>) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('live');
  const [address, setAddress] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [accessCode, setAccessCode] = useState('');
  const [showParticipantCount, setShowParticipantCount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateEvent = async () => {
    if (!name.trim()) {
      Alert.alert('Hold up', 'Enter an event name.');
      return;
    }
    if (locationType === 'fixed' && !address.trim()) {
      Alert.alert('Hold up', 'Enter an address for a fixed location.');
      return;
    }
    setIsSubmitting(true);
    try {
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (locationType === 'live') {
        const currentLocation = await getCurrentLocation();
        if (!currentLocation) {
          Alert.alert('Location off', 'Enable location services to broadcast live.');
          setIsSubmitting(false);
          return;
        }
        latitude = currentLocation.latitude;
        longitude = currentLocation.longitude;
      } else {
        const coords = await geocodeAddress(address.trim());
        if (!coords) {
          Alert.alert('Address not found', 'Try a more specific address.');
          setIsSubmitting(false);
          return;
        }
        latitude = coords.latitude;
        longitude = coords.longitude;
      }
      const event = await createEvent(userId, {
        name: name.trim(),
        description: description.trim() || undefined,
        location_type: locationType,
        latitude,
        longitude,
        address: locationType === 'fixed' ? address.trim() : undefined,
        requires_approval: requiresApproval,
        access_code: accessCode.trim() || undefined,
        show_participant_count: showParticipantCount,
      });
      Alert.alert('Beacon lit', `Join code: ${event.join_code}`);
      onEventCreated(event.id);
    } catch (error) {
      console.error('Failed to create event:', error);
      Alert.alert('Create failed', 'Could not create event. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            accessibilityLabel="Close"
          >
            <NeonText variant="h2" tone="muted" style={styles.closeGlyph}>✕</NeonText>
          </Pressable>
        </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <Pill label="Host · new beacon" tone="accent" dot />
                <Pressable onPress={onCancel} hitSlop={12}>
                  <NeonText variant="label" tone="muted">CANCEL</NeonText>
                </Pressable>
              </View>
              <NeonText variant="display" tone="text" glow style={{ marginTop: spacing.md }}>
                Light a beacon.
              </NeonText>
            </View>

          <View style={styles.form}>
            <GlowInput
              label="Event name *"
              value={name}
              onChangeText={setName}
              placeholder="e.g., Tech Meetup"
              maxLength={100}
            />
            <GlowInput
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="What's this beacon about?"
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            <View style={styles.inputGroup}>
              <NeonText variant="label" tone="accent">LOCATION MODE</NeonText>
              <View style={styles.buttonGroup}>
                <TypeOption
                  active={locationType === 'live'}
                  onPress={() => setLocationType('live')}
                  glyph="◉"
                  title="Live"
                  description="Broadcast my live position"
                />
                <TypeOption
                  active={locationType === 'fixed'}
                  onPress={() => setLocationType('fixed')}
                  glyph="◇"
                  title="Fixed"
                  description="Pin to a single address"
                />
              </View>
            </View>

            {locationType === 'fixed' ? (
              <GlowInput
                label="Address *"
                value={address}
                onChangeText={setAddress}
                placeholder="123 Main St, City, State"
                maxLength={200}
              />
            ) : null}

            <SettingRow
              title="Require approval"
              description="Approve join requests manually"
              value={requiresApproval}
              onValueChange={setRequiresApproval}
            />

            {requiresApproval ? (
              <GlowInput
                label="Access code (optional)"
                value={accessCode}
                onChangeText={(t) => setAccessCode(t.toUpperCase())}
                placeholder="Bypass code"
                autoCapitalize="characters"
                maxLength={20}
                hint="Anyone with this code skips approval."
              />
            ) : null}

            <SettingRow
              title="Show participant count"
              description="Display headcount on the map marker"
              value={showParticipantCount}
              onValueChange={setShowParticipantCount}
            />

            <GlowButton
              label={isSubmitting ? 'Lighting…' : 'Light beacon'}
              onPress={handleCreateEvent}
              loading={isSubmitting}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.md }}
            />
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function TypeOption({
  active,
  onPress,
  glyph,
  title,
  description,
}: Readonly<{
  active: boolean;
  onPress: () => void;
  glyph: string;
  title: string;
  description: string;
}>) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Surface elevated={active} padded style={[styles.option, active && styles.optionActive]}>
        <NeonText variant="h1" tone={active ? 'accent' : 'muted'} glow={active}>
          {glyph}
        </NeonText>
        <View style={{ flex: 1 }}>
          <NeonText variant="h2" tone={active ? 'text' : 'muted'}>{title}</NeonText>
          <NeonText variant="bodyMuted">{description}</NeonText>
        </View>
      </Surface>
    </Pressable>
  );
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
}: Readonly<{
  title: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}>) {
  return (
    <Surface elevated padded style={styles.settingRow}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <NeonText variant="h2" style={{ fontSize: 16 }}>{title}</NeonText>
        <NeonText variant="bodyMuted">{description}</NeonText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: palette.hairlineStrong, true: palette.accentDim }}
        thumbColor={value ? palette.accent : palette.textMuted}
        ios_backgroundColor={palette.hairlineStrong}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  closeGlyph: { fontSize: 18, lineHeight: 22 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: { marginBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  form: { gap: spacing.lg },
  inputGroup: { gap: spacing.sm },
  buttonGroup: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
  },
  optionActive: { borderColor: palette.accent },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
  },
});
