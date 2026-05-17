import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { glow, palette, radii, spacing, typography } from '../../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'premium';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function GlowButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  style,
  fullWidth,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        variant === 'primary' && !isDisabled && glow.accent,
        variant === 'premium' && !isDisabled && glow.premium,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={textColor(variant)} />
        ) : (
          <Text style={[typography.body, styles.label, { color: textColor(variant) }]}>
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function textColor(variant: Variant): string {
  switch (variant) {
    case 'primary':
      return palette.void;
    case 'premium':
      return palette.void;
    case 'secondary':
      return palette.accent;
    case 'ghost':
      return palette.text;
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.5,
  } as TextStyle,
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
});

const sizeStyles = StyleSheet.create({
  sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 36 },
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, minHeight: 48 },
  lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl, minHeight: 56 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: palette.accent },
  premium: { backgroundColor: palette.premium },
  secondary: {
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
});
