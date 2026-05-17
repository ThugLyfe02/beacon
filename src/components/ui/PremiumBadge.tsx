import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { palette, radii, spacing } from '../../theme';
import { NeonText } from './NeonText';

interface Props {
  size?: 'sm' | 'md';
  label?: string;
  style?: ViewStyle;
}

export function PremiumBadge({ size = 'sm', label = 'PREMIUM', style }: Readonly<Props>) {
  const isMd = size === 'md';
  return (
    <View
      style={[
        styles.base,
        isMd ? styles.md : styles.sm,
        style,
      ]}
    >
      <NeonText
        variant="label"
        tone="premium"
        glow
        style={isMd ? styles.glyphMd : styles.glyphSm}
      >
        ✦
      </NeonText>
      <NeonText variant="label" tone="premium" style={isMd ? styles.labelMd : styles.labelSm}>
        {label}
      </NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: 'rgba(255, 210, 74, 0.10)',
    alignSelf: 'flex-start',
    gap: 4,
  },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  md: { paddingHorizontal: spacing.md, paddingVertical: 4 },
  glyphSm: { fontSize: 11, lineHeight: 13 },
  glyphMd: { fontSize: 14, lineHeight: 16 },
  labelSm: { fontSize: 9 },
  labelMd: { fontSize: 11 },
});
