import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { palette } from '../../theme';
import { NeonText } from './NeonText';

interface Props {
  count?: number;
  premium?: boolean;
}

export function BeaconMarker({ count, premium }: Readonly<Props>) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const color = premium ? palette.premium : palette.accent;

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          { borderColor: color, transform: [{ scale }], opacity },
        ]}
      />
      <View style={[styles.core, { backgroundColor: color, shadowColor: color }]}>
        <View style={[styles.coreInner, { borderColor: palette.void }]} />
      </View>
      {count !== undefined ? (
        <View style={[styles.badge, { borderColor: color }]}>
          <NeonText variant="label" tone={premium ? 'premium' : 'accent'} style={styles.badgeText}>
            {count}
          </NeonText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
  core: {
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 4,
    backgroundColor: palette.void,
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  badgeText: { fontSize: 10, letterSpacing: 0 },
});
