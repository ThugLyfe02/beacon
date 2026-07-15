import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { SurgeEvaluation } from "../presence/SurgeEngine";

interface Props {
  surge: SurgeEvaluation;
  onPrimaryAction?: () => void;
  actionLabel?: string;
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export default function OpportunityWindowBanner({
  surge,
  onPrimaryAction,
  actionLabel = "View opportunity",
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [now, setNow] = useState(Date.now());

  const expiresAt = surge.opportunityWindow.expiresAt;
  const remainingSeconds = useMemo(() => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - now) / 1000));
  }, [expiresAt, now]);

  useEffect(() => {
    if (!surge.opportunityWindow.active || !expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, surge.opportunityWindow.active]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: surge.opportunityWindow.active && remainingSeconds > 0 ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [opacity, remainingSeconds, surge.opportunityWindow.active]);

  if (!surge.opportunityWindow.active || remainingSeconds <= 0) return null;

  const title = surge.level === "closing" ? "Final opportunity window" : "Opportunity window active";
  const evidence = surge.evidence.slice(0, 2).join(" · ");

  return (
    <Animated.View style={[styles.shell, { opacity }]} accessibilityRole="alert">
      <View style={styles.headerRow}>
        <View style={styles.pulseDot} />
        <Text style={styles.eyebrow}>{title}</Text>
        <Text style={styles.timer}>{formatRemaining(remainingSeconds)}</Text>
      </View>

      <Text style={styles.advisory}>{surge.advisory}</Text>
      {evidence.length > 0 && <Text style={styles.evidence}>{evidence}</Text>}

      {onPrimaryAction && (
        <Pressable
          accessibilityRole="button"
          onPress={onPrimaryAction}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 14,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#121826",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.32)",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#F59E0B",
  },
  eyebrow: {
    flex: 1,
    color: "#FCD34D",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  timer: {
    color: "#F9FAFB",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  advisory: {
    marginTop: 10,
    color: "#F9FAFB",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  evidence: {
    marginTop: 8,
    color: "#9CA3AF",
    fontSize: 12,
    lineHeight: 17,
  },
  action: {
    marginTop: 14,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#F59E0B",
  },
  actionPressed: {
    opacity: 0.82,
  },
  actionText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "800",
  },
});
