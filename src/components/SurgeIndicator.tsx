/**
 * SurgeIndicator
 *
 * Subtle, premium status chip for the current surge level. No flashing, no
 * gamification — at peak/closing it breathes slowly (low-amplitude opacity)
 * to signal elevated state without shouting.
 *
 * Renders nothing while STABLE — calm is the absence of noise.
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { palette, radii, spacing, typography } from "../theme";
import type { SurgeLevel } from "../presence/SurgeEngine";

interface Props {
  level: SurgeLevel;
  /** Premium amplified aura while in peak/closing surge. */
  premiumAura?: boolean;
}

const CONFIG: Record<
  SurgeLevel,
  { label: string; color: string; soft: string } | null
> = {
  stable: null,
  building: {
    label: "Building",
    color: palette.accent,
    soft: palette.accentSoft,
  },
  peak: {
    label: "Peak Window",
    color: palette.premium,
    soft: palette.premiumSoft,
  },
  closing: {
    label: "Closing Surge",
    color: palette.danger,
    soft: palette.dangerSoft,
  },
};

export default function SurgeIndicator({ level, premiumAura }: Props) {
  const breathe = useRef(new Animated.Value(1)).current;
  const elevated = level === "peak" || level === "closing";

  useEffect(() => {
    if (elevated) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 0.55,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(breathe, {
            toValue: 1,
            duration: 1400,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    breathe.stopAnimation();
    breathe.setValue(1);
  }, [elevated, breathe]);

  const cfg = CONFIG[level];
  if (!cfg) return null;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={`Surge ${cfg.label}`}>
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: cfg.color, opacity: elevated ? breathe : 1 },
          premiumAura && elevated && {
            shadowColor: cfg.color,
            shadowOpacity: 0.8,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <View style={[styles.chip, { backgroundColor: cfg.soft, borderColor: cfg.color }]}>
        <Animated.Text
          style={[
            styles.label,
            { color: cfg.color, opacity: elevated ? breathe : 1 },
          ]}
        >
          {cfg.label}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  label: {
    ...typography.label,
  },
});
