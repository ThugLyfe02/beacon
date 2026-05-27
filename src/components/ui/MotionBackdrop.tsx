import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { palette } from '../../theme';
import { GridBackground } from './GridBackground';

interface Props {
  /**
   * `require('../../assets/motion/foo.mp4')` — when null/undefined, falls back to GridBackground.
   */
  source?: number | null;
  /** 0–1, scales the video's effective opacity. Default 0.85. */
  intensity?: number;
  /** Tint shown over the video so it integrates with the cyan/void palette. */
  tint?: 'accent' | 'premium' | 'none';
  /** Show the animated grid layered above the video for extra HUD texture. */
  showGrid?: boolean;
  style?: ViewStyle;
}

export function MotionBackdrop({
  source,
  intensity = 0.85,
  tint = 'accent',
  showGrid = false,
  style,
}: Readonly<Props>) {
  if (!source) {
    return <GridBackground intensity={intensity} style={style} />;
  }

  return (
    <MotionBackdropPlayer
      source={source}
      intensity={intensity}
      tint={tint}
      showGrid={showGrid}
      style={style}
    />
  );
}

function MotionBackdropPlayer({
  source,
  intensity,
  tint,
  showGrid,
  style,
}: Readonly<Required<Omit<Props, 'style'>> & { style?: ViewStyle }>) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  const tintColor =
    tint === 'accent'
      ? 'rgba(0,229,255,0.10)'
      : tint === 'premium'
      ? 'rgba(255,210,74,0.08)'
      : 'transparent';

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.root, style]}>
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { opacity: intensity }]}
        contentFit="cover"
        nativeControls={false}
      />
      {tint !== 'none' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} />
      ) : null}
      <View style={styles.scrim} />
      {showGrid ? <GridBackground intensity={0.35} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.void, overflow: 'hidden' },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,7,13,0.35)',
  },
});
