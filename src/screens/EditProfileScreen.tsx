import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { getCurrentUser, updateUserProfile } from '../services/user.service';
import {
  GlowButton,
  GlowInput,
  GridBackground,
  Loader,
  NeonText,
  Pill,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { palette, spacing } from '../theme';

const NAME_MAX = 50;
const ROLE_MAX = 50;
const ONE_LINER_MAX = 150;

export default function EditProfileScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [oneLiner, setOneLiner] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      const u = await getCurrentUser(userId);
      if (cancelled || !u) {
        setLoading(false);
        return;
      }
      setName(u.name ?? '');
      setRole(u.role ?? '');
      setOneLiner(u.one_liner ?? '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Hold up', 'Your name keeps the room oriented. Add one.');
      return;
    }
    setSubmitting(true);
    try {
      await updateUserProfile(userId, {
        name: name.trim(),
        role: role.trim() || null,
        one_liner: oneLiner.trim() || null,
      });
      navigation.goBack();
    } catch (error) {
      console.error('[EditProfile] Failed to update profile:', error);
      Alert.alert('Save failed', 'Could not save your profile. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <GridBackground />
        <View style={styles.centered}>
          <Loader size={48} />
          <NeonText variant="label" tone="accent" style={{ marginTop: spacing.md }}>
            Loading signal
          </NeonText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            disabled={submitting}
          >
            <NeonText variant="label" tone="muted">CANCEL</NeonText>
          </Pressable>
          <NeonText variant="label" tone="accent">EDIT PROFILE</NeonText>
          <View style={{ width: 60 }} />
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
              <Pill label="Identity" tone="accent" dot />
              <NeonText variant="h1" tone="text" glow style={{ marginTop: spacing.md }}>
                Tune your signal.
              </NeonText>
              <NeonText variant="bodyMuted" style={styles.subtitle}>
                This is how the room sees you. Concise wins.
              </NeonText>
            </View>

            <View style={styles.form}>
              <GlowInput
                label="Name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                autoCapitalize="words"
                maxLength={NAME_MAX}
                editable={!submitting}
              />
              <GlowInput
                label="Role"
                value={role}
                onChangeText={setRole}
                placeholder="e.g. Software engineer, designer"
                autoCapitalize="words"
                maxLength={ROLE_MAX}
                editable={!submitting}
              />
              <GlowInput
                label="One-liner"
                value={oneLiner}
                onChangeText={setOneLiner}
                placeholder="A single line. The best one you've got."
                multiline
                numberOfLines={3}
                maxLength={ONE_LINER_MAX}
                hint={`${oneLiner.length}/${ONE_LINER_MAX}`}
                style={styles.textarea}
                editable={!submitting}
              />

              <GlowButton
                label={submitting ? 'Saving…' : 'Save'}
                onPress={handleSave}
                loading={submitting}
                fullWidth
                size="lg"
                style={{ marginTop: spacing.md }}
              />

              <GlowButton
                label="Choose 3D Avatar"
                onPress={() => navigation.navigate('ChooseAvatar')}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: { marginBottom: spacing.xxl },
  subtitle: { marginTop: spacing.sm, lineHeight: 22 },
  form: { gap: spacing.lg },
  textarea: { minHeight: 96, paddingTop: spacing.md, textAlignVertical: 'top' },
});
