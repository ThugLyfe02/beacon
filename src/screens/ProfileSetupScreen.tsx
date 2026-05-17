import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { updateUserProfile } from '../services/user.service';
import {
  GlowButton,
  GlowInput,
  GridBackground,
  NeonText,
  Pill,
} from '../components/ui';
import { palette, spacing } from '../theme';

interface ProfileSetupScreenProps {
  userId: string;
  onComplete: () => void;
}

export default function ProfileSetupScreen({ userId, onComplete }: Readonly<ProfileSetupScreenProps>) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Hold up', 'Please enter your name.');
      return;
    }
    setIsSubmitting(true);
    try {
      await updateUserProfile(userId, {
        name: name.trim(),
        role: role.trim() || null,
        one_liner: oneLiner.trim() || null,
      });
      onComplete();
    } catch (error) {
      console.error('[ProfileSetup] Failed to update profile:', error);
      Alert.alert('Save failed', 'Could not save your profile. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
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
              <Pill label="Step 01 · Identity" tone="accent" dot />
              <NeonText variant="h1" tone="text" glow style={{ marginTop: spacing.md }}>
                Forge your signal.
              </NeonText>
              <NeonText variant="bodyMuted" style={styles.subtitle}>
                This is how the room sees you. Concise wins.
              </NeonText>
            </View>

            <View style={styles.form}>
              <GlowInput
                label="Name *"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoCapitalize="words"
                maxLength={50}
              />
              <GlowInput
                label="Role"
                value={role}
                onChangeText={setRole}
                placeholder="e.g. Software engineer, designer"
                autoCapitalize="words"
                maxLength={50}
              />
              <GlowInput
                label="One-liner"
                value={oneLiner}
                onChangeText={setOneLiner}
                placeholder="A single line. The best one you've got."
                multiline
                numberOfLines={3}
                maxLength={150}
                hint={`${oneLiner.length}/150`}
                style={styles.textarea}
              />

              <GlowButton
                label={isSubmitting ? 'Saving…' : 'Continue'}
                onPress={handleSubmit}
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
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  header: { marginBottom: spacing.xxl },
  subtitle: { marginTop: spacing.sm, lineHeight: 22 },
  form: { gap: spacing.lg },
  textarea: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
});
