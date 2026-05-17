import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { palette, radii, spacing, typography } from '../../theme';
import { NeonText } from './NeonText';

type Tone = 'accent' | 'premium' | 'neutral' | 'danger' | 'success';

interface Props {
  label: string;
  tone?: Tone;
  dot?: boolean;
  style?: ViewStyle;
}

export function Pill({ label, tone = 'accent', dot, style }: Props) {
  return (
    <View style={[styles.base, toneStyles[tone], style]}>
      {dot ? <View style={[styles.dot, toneDot[tone]]} /> : null}
      <NeonText variant="label" tone={tone === 'neutral' ? 'muted' : tone === 'accent' ? 'accent' : tone}>
        {label}
      </NeonText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});

const toneStyles = StyleSheet.create({
  accent: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  premium: { backgroundColor: 'rgba(255,210,74,0.12)', borderColor: palette.premium },
  neutral: { backgroundColor: palette.surface, borderColor: palette.hairlineStrong },
  danger: { backgroundColor: 'rgba(255,77,106,0.12)', borderColor: palette.danger },
  success: { backgroundColor: 'rgba(34,227,158,0.12)', borderColor: palette.success },
});

const toneDot = StyleSheet.create({
  accent: { backgroundColor: palette.accent },
  premium: { backgroundColor: palette.premium },
  neutral: { backgroundColor: palette.textMuted },
  danger: { backgroundColor: palette.danger },
  success: { backgroundColor: palette.success },
});
