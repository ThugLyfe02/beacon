import React from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { palette, radii, spacing } from '../../theme';

interface Props extends ViewProps {
  elevated?: boolean;
  glow?: boolean;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Surface({ elevated, glow, padded, style, children, ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        styles.base,
        elevated && styles.elevated,
        glow && styles.glow,
        padded && styles.padded,
        style as ViewStyle,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  elevated: {
    backgroundColor: palette.surfaceElevated,
    borderColor: palette.hairlineStrong,
  },
  glow: {
    shadowColor: palette.accent,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  padded: { padding: spacing.lg },
});
