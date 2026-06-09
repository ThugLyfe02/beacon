import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import { useRegretRecorder } from "../presence/useRegretRecorder";
import { logPresenceMetrics } from "../presence/TelemetryLogger";
import TensionBar from "../components/TensionBar";
import { FEATURE_FLAGS } from "../config/featureFlags";
import { useAuth } from "../hooks/useAuth";
import { getEventById } from "../services/event.service";
import type { ProximitySignal } from "../presence/PresenceEngine";

type EventLobbyParams = { EventLobby: { eventId: string; eventName?: string } };

export default function EventLobbyScreen() {
  const route = useRoute<RouteProp<EventLobbyParams, "EventLobby">>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const event = await getEventById(eventId);
      if (cancelled) return;
      setEventEnd(event?.ends_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Real proximity feeds aren't wired yet — start with zeros so the screen renders.
  const rawSignals: ProximitySignal[] = useMemo(() => [], []);
  const signalsSent = 0;
  const mutualMatches = 0;
  const officeHoursActive = false;

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: eventEnd ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    signalsSent,
    mutualMatches,
    officeHoursActive,
  });

  useRegretRecorder({
    signals: FEATURE_FLAGS.regretRecorder ? presence?.visibleTargets ?? [] : [],
    eventId,
    userId,
  });

  const surgeMode = presence?.urgencyLevel === "surge";

  const opportunityWindow = useMemo(() => {
    if (!presence) return false;
    return (
      presence.density >= 5 &&
      presence.premiumDensity >= 2 &&
      presence.timeRemainingMinutes < 20
    );
  }, [presence]);

  useEffect(() => {
    if (presence) logPresenceMetrics(presence);
  }, [presence]);

  useEffect(() => {
    if (opportunityWindow) {
      console.log("[Presence] Opportunity Window Activated");
    }
  }, [opportunityWindow]);

  if (loading || !presence) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <View style={[styles.container, surgeMode && styles.surgeBackground]}>
      <TensionBar tensionScore={presence.tensionScore} urgencyLevel={presence.urgencyLevel} />

      {opportunityWindow && (
        <View style={styles.opportunityBanner}>
          <Text style={styles.bannerText}>Peak Opportunity Window Active</Text>
        </View>
      )}

      <View style={styles.metricsContainer}>
        <Text style={styles.metric}>Nearby Signals: {presence.density}</Text>
        <Text style={styles.metric}>Premium Nearby: {presence.premiumDensity}</Text>
        <Text style={styles.metric}>Time Remaining: {presence.timeRemainingMinutes}m</Text>
        <Text style={styles.metric}>Momentum: {presence.momentumScore}</Text>
      </View>

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
    padding: 16,
    backgroundColor: "#0a0a0a",
  },
  centered: { alignItems: "center", justifyContent: "center" },
  surgeBackground: { backgroundColor: "#0f0f0f" },
  opportunityBanner: {
    backgroundColor: "#1f2937",
    padding: 12,
    marginVertical: 10,
    borderRadius: 8,
  },
  bannerText: { color: "#f59e0b", fontWeight: "600" },
  metricsContainer: { marginTop: 20 },
  metric: { fontSize: 14, marginBottom: 4, color: "#e5e7eb" },
  regretContainer: {
    marginTop: 24,
    padding: 12,
    backgroundColor: "#111827",
    borderRadius: 8,
  },
  regretText: { color: "#ef4444", fontSize: 13 },
});
