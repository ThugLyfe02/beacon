import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { createPost } from '../services/post.service';
import {
  GlowButton,
  GridBackground,
  NeonText,
  Pill,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';

type ComposeParams = {
  Compose: { userId: string; eventId?: string; eventName?: string };
};

const BODY_MAX = 500;

export default function ComposePostScreen() {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute<RouteProp<ComposeParams, 'Compose'>>();
  const { userId, eventId, eventName } = route.params ?? ({} as ComposeParams['Compose']);
  const [body, setBody] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      Alert.alert('Hold up', 'Add some text to your post.');
      return;
    }
    setSubmitting(true);
    try {
      await createPost({
        authorId: userId,
        body: trimmed,
        eventId: eventId ?? null,
        imageUri,
      });
      navigation.goBack();
    } catch (e) {
      console.error(e);
      Alert.alert('Could not post', 'Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = BODY_MAX - body.length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground intensity={0.4} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <NeonText variant="label" tone="muted">CANCEL</NeonText>
            </Pressable>
            <NeonText variant="label" tone="accent">NEW POST</NeonText>
            <NeonText
              variant="label"
              tone={remaining < 20 ? 'danger' : 'dim'}
              style={{ textAlign: 'right', minWidth: 40 }}
            >
              {remaining}
            </NeonText>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {eventId ? (
              <Pill label={`POSTING TO · ${eventName ?? 'EVENT'}`} tone="accent" dot />
            ) : (
              <Pill label="POSTING TO · GLOBAL FEED" tone="neutral" dot />
            )}

            <TextInput
              value={body}
              onChangeText={(t) => setBody(t.slice(0, BODY_MAX))}
              multiline
              autoFocus
              placeholder="What's the signal?"
              placeholderTextColor={palette.textDim}
              selectionColor={palette.accent}
              underlineColorAndroid="transparent"
              style={styles.input}
            />

            {imageUri ? (
              <Surface style={styles.preview}>
                <Image source={{ uri: imageUri }} style={styles.previewImg} resizeMode="cover" />
                <Pressable
                  onPress={() => setImageUri(null)}
                  style={({ pressed }) => [styles.removeImg, pressed && { opacity: 0.7 }]}
                  hitSlop={8}
                >
                  <NeonText variant="label" tone="text">✕</NeonText>
                </Pressable>
              </Surface>
            ) : null}
          </ScrollView>

          <View style={styles.bottomBar}>
            <Pressable
              onPress={handlePickImage}
              style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.7 }]}
              hitSlop={8}
            >
              <NeonText variant="h2" tone="accent">◫</NeonText>
              <NeonText variant="label" tone="muted">IMAGE</NeonText>
            </Pressable>
            <GlowButton
              label="Transmit"
              onPress={handleSubmit}
              loading={submitting}
              disabled={body.trim().length === 0}
              size="md"
              style={{ minWidth: 140 }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },
  scroll: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  input: {
    minHeight: 160,
    color: palette.text,
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 24,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
    includeFontPadding: false,
  },
  preview: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  previewImg: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  removeImg: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(5,7,13,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    backgroundColor: palette.space,
    gap: spacing.lg,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
    backgroundColor: palette.surface,
  },
});
