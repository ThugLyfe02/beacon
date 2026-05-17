import React from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import { glow, palette } from '../../theme';
import { NeonText } from './NeonText';

interface Props {
  onPress: () => void;
  style?: ViewStyle;
}

export function ComposeFab({ onPress, style }: Readonly<Props>) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }, style]}
      accessibilityLabel="Compose post"
    >
      <NeonText variant="display" style={styles.plus}>
        +
      </NeonText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...glow.accent,
  },
  plus: { fontSize: 32, lineHeight: 36, color: palette.void },
});
