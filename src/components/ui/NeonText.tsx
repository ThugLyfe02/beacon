import React from 'react';
import { StyleSheet, Text, TextProps, TextStyle } from 'react-native';
import { palette, typography } from '../../theme';

type Tone = 'accent' | 'text' | 'muted' | 'dim' | 'premium' | 'danger' | 'success';
type Variant = keyof typeof typography;

interface Props extends TextProps {
  tone?: Tone;
  variant?: Variant;
  glow?: boolean;
  style?: TextStyle | TextStyle[];
}

export function NeonText({ tone = 'text', variant = 'body', glow, style, children, ...rest }: Props) {
  const color = toneColor(tone);
  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color },
        glow && styles.glow,
        glow && { textShadowColor: color },
        style as TextStyle,
      ]}
    >
      {children}
    </Text>
  );
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case 'accent':
      return palette.accent;
    case 'muted':
      return palette.textMuted;
    case 'dim':
      return palette.textDim;
    case 'premium':
      return palette.premium;
    case 'danger':
      return palette.danger;
    case 'success':
      return palette.success;
    default:
      return palette.text;
  }
}

const styles = StyleSheet.create({
  glow: {
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});
