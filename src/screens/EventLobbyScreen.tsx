import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import { useRegretRecorder } from "../presence/useRegretRecorder";
import TensionBar from "../components/TensionBar";
import { FEATURE_FLAGS } from "../config/featureFlags";

export default function EventLobbyScreen({
  eventId,
  eventEnd,
  userId,
  rawSignals,
  signalsSent,
  mutualMatches,
  officeHoursActive,
  premiumNearby
}) {

  const presence = usePresenceEngine({
    rawSignals,
    premiumNearby,
    eventEnd,
    signalsSent,
    mutualMatches,
    officeHoursActive
  });

  useRegretRecorder({
    signals: presence?.signals ?? [],
    eventId,
    userId
  });

  const surgeMode = useMemo(() => {
    return presence?.urgencyLevel === "surge";
  }, [presence?.urgencyLevel]);

  const opportunityWindow = useMemo(() => {
    if (!presence) return false;
    return (
      presence.density >= 5 &&
      presence.premiumDensity >= 2 &&
      presence.timeRemainingMinutes < 20
    );
  }, [presence]);

  useEffect(() => {
    if (opportunityWindow) {
      console.log("[Presence] Opportunity Window Activated");
    }
  }, [opportunityWindow]);

  if (!presence) return null;

  return (
    <View style={[
      styles.container,
      surgeMode && styles.surgeBackground
    ]}>

      {/* Tension Bar */}
      <TensionBar
        tensionScore={presence.tensionScore}
        urgencyLevel={presence.urgencyLevel}
      />

      {/* Dynamic Context Banner */}
      {opportunityWindow && (
        <View style={styles.opportunityBanner}>
          <Text style={styles.bannerText}>
            Peak Opportunity Window Active
          </Text>
        </View>
      )}

      {/* Density Summary */}
      <View style={styles.metricsContainer}>
        <Text style={styles.metric}>
          Nearby Signals: {presence.density}
        </Text>
        <Text style={styles.metric}>
          Premium Nearby: {presence.premiumDensity}
        </Text>
        <Text style={styles.metric}>
          Time Remaining: {presence.timeRemainingMinutes}m
        </Text>
        <Text style={styles.metric}>
          Momentum: {presence.momentumScore}
        </Text>
      </View>

      {/* Missed Signals Indicator */}
      {presence.missedSignals > 0 && (
        <View style={styles.regretContainer}>
          <Text style={styles.regretText}>
            You passed within activation range of {presence.missedSignals} high-signal profiles.
          </Text>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16
  },
  surgeBackground: {
    backgroundColor: "#0f0f0f"
  },
  opportunityBanner: {
    backgroundColor: "#1f2937",
    padding: 12,
    marginVertical: 10,
    borderRadius: 8
  },
  bannerText: {
    color: "#f59e0b",
    fontWeight: "600"
  },
  metricsContainer: {
    marginTop: 20
  },
  metric: {
    fontSize: 14,
    marginBottom: 4
  },
  regretContainer: {
    marginTop: 24,
    padding: 12,
    backgroundColor: "#111827",
    borderRadius: 8
  },
  regretText: {
    color: "#ef4444",
    fontSize: 13
  }
});
