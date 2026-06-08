import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import { useSurgeEngine } from "../presence/useSurgeEngine";
import { useRegretRecorder } from "../presence/useRegretRecorder";
import TensionBar from "../components/TensionBar";
import SurgeIndicator from "../components/SurgeIndicator";
import OpportunityWindowBanner from "../components/OpportunityWindowBanner";
import { isAtLeast } from "../presence/SurgeEngine";
import { isFeatureEnabled } from "../config/featureFlags";
import { palette, radii, spacing } from "../theme";

interface EventLobbyScreenProps {
  eventId: string;
  eventEnd: string;
  userId: string;
  rawSignals: any[];
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
  /** Whether the current user has premium. Drives surge differentiation. */
  isPremium?: boolean;
  /** Optional handler for premium pre-activation of Office Hours during surge. */
  onPreactivateOfficeHours?: () => void;
}

function formatClock(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function EventLobbyScreen({
  eventId,
  eventEnd,
  userId,
  rawSignals,
  signalsSent,
  mutualMatches,
  officeHoursActive,
  isPremium = false,
  onPreactivateOfficeHours,
}: EventLobbyScreenProps) {
  const surgeEnabled = isFeatureEnabled("surgeEngine");

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd,
    signalsSent,
    mutualMatches,
    officeHoursActive,
  });

  useRegretRecorder({
    signals: presence?.visibleTargets ?? [],
    eventId,
    userId,
  });

  const surge = useSurgeEngine({
    presence,
    isPremium,
    signalsSent,
    mutualMatches,
    officeHoursActive,
    eventId,
  });

  // Live seconds remaining in the event (ticks at the presence cadence).
  const closingClock = useMemo(() => {
    if (!surge || surge.surgeLevel !== "closing") return null;
    return formatClock(new Date(eventEnd).getTime() - Date.now());
  }, [surge?.surgeLevel, eventEnd, presence]);

  if (!presence) return null;

  const showSurge = surgeEnabled && !!surge;
  const surgeMode = surge?.surgeLevel === "closing";

  return (
    <View style={[styles.container, surgeMode && styles.surgeBackground]}>
      <TensionBar
        tensionScore={presence.tensionScore}
        urgencyLevel={presence.urgencyLevel}
      />

      {/* Surge banner — visible from BUILDING upward */}
      {showSurge && isAtLeast(surge!.surgeLevel, "building") && (
        <View style={styles.surgeRow}>
          <SurgeIndicator level={surge!.surgeLevel} premiumAura={surge!.auraAmplified} />
          {closingClock && (
            <Text style={styles.countdown}>{closingClock}</Text>
          )}
        </View>
      )}

      {/* Advisory — honest, event-aware. Non-premium see it only once active. */}
      {showSurge && surge!.advisoryMessage && (
        <View style={styles.advisory}>
          <Text style={styles.advisoryText}>{surge!.advisoryMessage}</Text>
        </View>
      )}

      {/* Premium-only predictive window hint (~2 min early) */}
      {showSurge && surge!.predictiveHint && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>{surge!.predictiveHint}</Text>
        </View>
      )}

      {/* Timed opportunity window */}
      {showSurge && (
        <View style={styles.windowSlot}>
          <OpportunityWindowBanner
            active={surge!.windowActive}
            kind={surge!.surgeLevel}
            remainingSeconds={surge!.windowRemainingSeconds}
          />
        </View>
      )}

      {/* Premium-only Office Hours pre-activation (role-enforced in the hook) */}
      {showSurge && surge!.canPreactivateOfficeHours && onPreactivateOfficeHours && (
        <Pressable style={styles.preactivate} onPress={onPreactivateOfficeHours}>
          <Text style={styles.preactivateText}>Pre-activate Office Hours</Text>
        </Pressable>
      )}

      {/* Density summary */}
      <View style={styles.metricsContainer}>
        <Text style={styles.metric}>Nearby Signals: {presence.density}</Text>
        <Text style={styles.metric}>Premium Nearby: {presence.premiumDensity}</Text>
        <Text style={styles.metric}>
          Time Remaining: {presence.timeRemainingMinutes}m
        </Text>
        <Text style={styles.metric}>Momentum: {presence.momentumScore}</Text>
        {showSurge && (
          <Text style={styles.metric}>Surge: {surge!.surgeScore}</Text>
        )}
      </View>

      {/* Missed signals indicator */}
      {presence.missedSignals > 0 && (
        <View style={styles.regretContainer}>
          <Text style={styles.regretText}>
            You passed within activation range of {presence.missedSignals}{" "}
            high-signal profiles.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: palette.void },
  surgeBackground: { backgroundColor: palette.space },
  surgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  countdown: {
    color: palette.danger,
    fontVariant: ["tabular-nums"],
    fontSize: 16,
    fontWeight: "700",
  },
  advisory: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  advisoryText: { color: palette.text, fontSize: 14, fontWeight: "500" },
  hint: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: palette.premiumSoft,
  },
  hintText: { color: palette.premium, fontSize: 13 },
  windowSlot: { marginTop: spacing.md },
  preactivate: {
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.premium,
    backgroundColor: palette.premiumSoft,
  },
  preactivateText: { color: palette.premium, fontWeight: "600" },
  metricsContainer: { marginTop: spacing.xl },
  metric: { fontSize: 14, marginBottom: 4, color: palette.textMuted },
  regretContainer: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
  },
  regretText: { color: palette.danger, fontSize: 13 },
});
