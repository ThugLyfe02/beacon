import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { glow, palette, radii, spacing } from '../../theme';
import { GlowButton } from './GlowButton';
import { NeonText } from './NeonText';
import { Pill } from './Pill';
import { Surface } from './Surface';

interface Props {
  visible: boolean;
  onClose: () => void;
  isPremium: boolean;
  isDiscoverable: boolean;
  premiumSince: string | null;
  onTogglePremiumDev: () => Promise<void>;
  onToggleDiscoverable: (v: boolean) => Promise<void>;
  showDevControls?: boolean;
}

export function PremiumDrawer({
  visible,
  onClose,
  isPremium,
  isDiscoverable,
  premiumSince,
  onTogglePremiumDev,
  onToggleDiscoverable,
  showDevControls = __DEV__,
}: Readonly<Props>) {
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 1 : 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: visible ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slide, fade]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[styles.sheetWrap, { transform: [{ translateY }] }]}
        pointerEvents="box-none"
      >
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <NeonText variant="label" tone="premium">PREMIUM</NeonText>
            <NeonText variant="display" tone={isPremium ? 'premium' : 'text'} glow={isPremium}>
              ✦
            </NeonText>
            <NeonText variant="h1" style={{ marginTop: spacing.xs }}>
              {isPremium ? 'You are premium.' : 'Unlock the room.'}
            </NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.xs, lineHeight: 22 }}>
              {isPremium
                ? 'See other premium signals at the same event. Toggle Discoverable to be seen back.'
                : 'See and be seen by other premium signals at events. Mutual-visibility, opt-in.'}
            </NeonText>
            {isPremium && premiumSince ? (
              <Pill
                label={`Since ${new Date(premiumSince).toLocaleDateString()}`}
                tone="premium"
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </View>

          {isPremium ? (
            <Surface elevated padded style={styles.row}>
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <NeonText variant="h2" style={{ fontSize: 16 }}>Discoverable</NeonText>
                <NeonText variant="bodyMuted">
                  Show your signal to other premium users at events.
                </NeonText>
              </View>
              <Switch
                value={isDiscoverable}
                onValueChange={async (v) => {
                  try {
                    await onToggleDiscoverable(v);
                  } catch {
                    Alert.alert('Update failed', 'Could not change discoverability.');
                  }
                }}
                trackColor={{ false: palette.hairlineStrong, true: 'rgba(255,210,74,0.55)' }}
                thumbColor={isDiscoverable ? palette.premium : palette.textMuted}
                ios_backgroundColor={palette.hairlineStrong}
              />
            </Surface>
          ) : null}

          <View style={styles.cta}>
            {isPremium ? (
              showDevControls ? (
                <GlowButton
                  label="DEV: revoke premium"
                  onPress={async () => {
                    try {
                      await onTogglePremiumDev();
                    } catch {
                      Alert.alert('Update failed', 'Could not toggle premium.');
                    }
                  }}
                  variant="ghost"
                  fullWidth
                />
              ) : null
            ) : (
              <>
                <GlowButton
                  label="Upgrade to Premium"
                  onPress={() =>
                    Alert.alert(
                      'Coming soon',
                      'Payments are still being wired up. Reach out for early access.'
                    )
                  }
                  variant="premium"
                  fullWidth
                  size="lg"
                />
                {showDevControls ? (
                  <GlowButton
                    label="DEV: grant premium"
                    onPress={async () => {
                      try {
                        await onTogglePremiumDev();
                      } catch {
                        Alert.alert('Update failed', 'Could not toggle premium.');
                      }
                    }}
                    variant="ghost"
                    fullWidth
                    style={{ marginTop: spacing.sm }}
                  />
                ) : null}
              </>
            )}
            <GlowButton
              label="Close"
              onPress={onClose}
              variant="ghost"
              fullWidth
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,7,13,0.72)',
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: palette.space,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 1,
    borderColor: palette.hairlineStrong,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
    ...glow.premium,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.hairlineStrong,
    marginBottom: spacing.sm,
  },
  header: { alignItems: 'flex-start', gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
  },
  cta: { gap: 0 },
});
