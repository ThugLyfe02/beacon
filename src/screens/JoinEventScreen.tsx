import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getEventByCode } from '../services/event.service';
import {
  requestToJoinEvent,
  joinEventWithCode,
  getParticipantStatus,
} from '../services/participant.service';
import {
  GlowButton,
  GlowInput,
  GridBackground,
  NeonText,
  Pill,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';

interface JoinEventScreenProps {
  userId: string;
  onEventJoined: () => void;
  onCancel?: () => void;
}

export function JoinEventScreen({
  userId,
  onEventJoined,
  onCancel,
}: Readonly<JoinEventScreenProps>) {
  const [joinCode, setJoinCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJoinEvent = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Hold up', 'Enter an event code.');
      return;
    }
    setIsSubmitting(true);
    try {
      const event = await getEventByCode(joinCode.trim());
      if (!event) {
        Alert.alert('Not found', 'No event with that code.');
        return;
      }
      const existingStatus = await getParticipantStatus(event.id, userId);
      if (existingStatus) {
        if (existingStatus === 'approved') {
          onEventJoined();
        } else if (existingStatus === 'pending') {
          Alert.alert('Pending', 'Your request is waiting for the host.');
        } else {
          Alert.alert('Rejected', 'Your join request was declined.');
        }
        return;
      }
      if (accessCode.trim()) {
        try {
          await joinEventWithCode(event.id, userId, accessCode.trim());
          onEventJoined();
        } catch {
          Alert.alert('Invalid code', 'That access code didn’t match.');
        }
        return;
      }
      const participant = await requestToJoinEvent(event.id, userId);
      const isApproved = participant.status === 'approved';
      Alert.alert(
        isApproved ? 'You’re in' : 'Request sent',
        isApproved ? 'You have joined the event.' : 'Waiting for host approval.',
        [{ text: 'OK', onPress: onEventJoined }]
      );
    } catch (error) {
      console.error('Failed to join event:', error);
      Alert.alert('Join failed', 'Could not join. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <GridBackground />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        {onCancel ? (
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
        ) : null}
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
              <Pill label="Join · enter code" tone="accent" dot />
              <NeonText variant="display" tone="text" glow style={{ marginTop: spacing.md }}>
                Drop the code.
              </NeonText>
              <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 22 }}>
                Six characters from the host. We'll do the rest.
              </NeonText>
            </View>

          <View style={styles.form}>
            <GlowInput
              label="Event code"
              placeholder="ABC123"
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              editable={!isSubmitting}
              style={styles.codeInput}
            />

            {showAccessCode ? (
              <GlowInput
                label="Access code"
                placeholder="Bypass approval"
                value={accessCode}
                onChangeText={(t) => setAccessCode(t.toUpperCase())}
                autoCapitalize="characters"
                editable={!isSubmitting}
                hint="Skip approval if the host gave you this."
                style={styles.codeInput}
              />
            ) : (
              <Pressable onPress={() => setShowAccessCode(true)} style={styles.linkRow}>
                <NeonText variant="label" tone="accent">+ have an access code?</NeonText>
              </Pressable>
            )}

            <GlowButton
              label={isSubmitting ? 'Joining…' : 'Request to join'}
              onPress={handleJoinEvent}
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
    justifyContent: 'center',
  },
  header: { marginBottom: spacing.xxl },
  form: { gap: spacing.lg },
  codeInput: {
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '700',
  },
  linkRow: { alignSelf: 'center', paddingVertical: spacing.sm },
});
