import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';
import { glow, palette, radii, spacing } from '../../theme';
import { NeonText } from './NeonText';

const GLYPHS: Record<string, string> = {
  Home: '⌂',
  Map: '◉',
  Host: '✦',
  Discover: '◈',
  Matches: '⌬',
  Me: '◑',
};

export function NeonTabBar({ state, descriptors, navigation }: Readonly<BottomTabBarProps>) {
  return (
    <View style={styles.outer}>
      <View style={styles.glowLine} />
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        <View style={styles.bar}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;
            const label =
              (typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name) ||
              route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                onPress={onPress}
                onLongPress={onLongPress}
                style={({ pressed }) => [
                  styles.tab,
                  isFocused && styles.tabActive,
                  isFocused && glow.accentSoft,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <NeonText
                  variant="h2"
                  tone={isFocused ? 'accent' : 'muted'}
                  glow={isFocused}
                  style={styles.glyph}
                >
                  {GLYPHS[route.name] ?? '◇'}
                </NeonText>
                <NeonText
                  variant="label"
                  tone={isFocused ? 'accent' : 'dim'}
                  style={styles.label}
                >
                  {label}
                </NeonText>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: palette.space,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },
  glowLine: {
    height: 1,
    backgroundColor: palette.accent,
    opacity: 0.35,
    shadowColor: palette.accent,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  safe: { backgroundColor: palette.space },
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    gap: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  glyph: { fontSize: 22, lineHeight: 26 },
  label: { fontSize: 9, letterSpacing: 1.2 },
});
