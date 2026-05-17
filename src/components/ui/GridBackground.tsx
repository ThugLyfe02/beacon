import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { palette } from '../../theme';

type Variant = 'floor' | 'flat';

interface Props {
  variant?: Variant;
  intensity?: number;
  style?: ViewStyle;
}

const LINE_COUNT_X = 18;
const LINE_COUNT_Y = 24;

export function GridBackground({ variant = 'floor', intensity = 1, style }: Props) {
  const drift = useRef(new Animated.Value(0)).current;
  const { width, height } = Dimensions.get('window');

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const translateY = drift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, height / LINE_COUNT_Y],
  });

  const vLines = Array.from({ length: LINE_COUNT_X });
  const hLines = Array.from({ length: LINE_COUNT_Y });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, style]}>
      <View style={styles.gradientTop} />
      <Animated.View
        style={[
          styles.grid,
          variant === 'floor' && styles.floor,
          {
            transform: [
              ...(variant === 'floor'
                ? [{ perspective: 700 }, { rotateX: '62deg' }, { scale: 1.6 }]
                : []),
              { translateY },
            ],
            opacity: 0.9 * intensity,
          },
        ]}
      >
        {vLines.map((_, i) => (
          <View
            key={`v-${i}`}
            style={[
              styles.vLine,
              { left: (width * 1.6 * i) / (LINE_COUNT_X - 1) - width * 0.3 },
            ]}
          />
        ))}
        {hLines.map((_, i) => (
          <View
            key={`h-${i}`}
            style={[
              styles.hLine,
              {
                top: (height * 1.4 * i) / (LINE_COUNT_Y - 1),
                opacity: variant === 'floor' ? 0.25 + (i / LINE_COUNT_Y) * 0.75 : 0.5,
              },
            ]}
          />
        ))}
      </Animated.View>
      <View style={styles.vignette} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: palette.void,
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    bottom: 0,
  },
  floor: {
    height: '160%',
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: palette.gridLine,
  },
  hLine: {
    position: 'absolute',
    left: '-30%',
    right: '-30%',
    height: 1,
    backgroundColor: palette.gridLine,
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    backgroundColor: palette.space,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
});
