/**
 * OpportunityWindowBanner
 *
 * Calm, informational banner shown while a timed opportunity window is active.
 * Premium aesthetic only: no flashing, no countdown anxiety theatrics. The
 * remaining time is shown plainly when provided.
 *
 * Renders nothing when no window is active.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { glow, palette, radii, spacing } from "../theme";
import { NeonText } from "./ui/NeonText";
import type { SurgeLevel } from "../presence/SurgeEngine";

interface Props {
  active: boolean;
  kind?: SurgeLevel | null;
  remainingSeconds?: number;
}

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function OpportunityWindowBanner({
  active,
  kind,
  remainingSeconds,
}: Props) {
  if (!active) return null;

  const closing = kind === "closing";
  const accent = closing ? palette.danger : palette.premium;

  return (
    <View
      style={[
        styles.banner,
        { borderColor: accent },
        closing ? glow.danger : glow.premium,
      ]}
    >
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <NeonText variant="label" tone={closing ? "danger" : "premium"}>
          {closing ? "Closing Window" : "Peak Window"}
        </NeonText>
        <NeonText variant="bodyMuted">
          {closing
            ? "Final activation window open in your proximity."
            : "High-signal connection window open in your proximity."}
        </NeonText>
      </View>
      {typeof remainingSeconds === "number" && remainingSeconds > 0 ? (
        <NeonText variant="mono" tone={closing ? "danger" : "premium"} glow>
          {formatRemaining(remainingSeconds)}
        </NeonText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: palette.surfaceElevated,
  },
  bar: { width: 3, alignSelf: "stretch", borderRadius: radii.sm },
  body: { flex: 1, gap: 2 },
});
