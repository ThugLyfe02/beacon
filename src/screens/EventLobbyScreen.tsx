import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from "@react-navigation/native";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import { useOpportunityIntelligence } from "../presence/useOpportunityIntelligence";
import { useRegretRecorder } from "../presence/useRegretRecorder";
import { logPresenceMetrics } from "../presence/TelemetryLogger";
import TensionBar from "../components/TensionBar";
import OpportunityWindowBanner from "../components/OpportunityWindowBanner";
import VenueServiceStatusCard from "../components/VenueServiceStatusCard";
import EventFocusWindowCard from "../components/EventFocusWindowCard";
import CommunityExchangePreview from "../components/CommunityExchangePreview";
import IntroductionInboxPreview from "../components/IntroductionInboxPreview";
import { FEATURE_FLAGS } from "../config/featureFlags";
import { useAuth } from "../hooks/useAuth";
import { usePresenceFeed } from "../hooks/usePresenceFeed";
import { getEventById } from "../services/event.service";

type EventLobbyParams = { EventLobby: { eventId: string; eventName?: string } };

interface EventTiming {
  startsAt: string;
  endsAt: string;
}

export default function EventLobbyScreen() {
  const route = useRoute<RouteProp<EventLobbyParams, "EventLobby">>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [timing, setTiming] = useState<EventTiming | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const event = await getEventById(eventId);
      if (cancelled) return;

      const fallbackStart = new Date(Date.now() - 15 * 60_000).toISOString();
      const fallbackEnd = new Date(Date.now() + 60 * 60_000).toISOString();
      setTiming({
        startsAt: event?.starts_at ?? fallbackStart,
        endsAt: event?.ends_at ?? fallbackEnd,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const { rawSignals, signalsSent, mutualMatches, lastError, hasLocation } =
    usePresenceFeed(eventId, userId);

  const declaredFitSummary = useMemo(() => {
    const fits = rawSignals.filter((signal) => (signal.declaredFitStrength ?? 0) > 0);
    return {
      total: fits.length,
      twoWay: fits.filter((signal) => signal.declaredFitTwoWay).length,
      strongest: fits
        .slice()
        .sort((a, b) => (b.declaredFitStrength ?? 0) - (a.declaredFitStrength ?? 0))[0] ?? null,
    };
  }, [rawSignals]);

  // Existing office-hours services own this state. Keep false until that
  // event-scoped status is surfaced by the feed rather than fabricating it.
  const officeHoursActive = false;

  const eventEndsAt = timing?.endsAt ?? new Date(Date.now() + 60 * 60_000).toISOString();
  const eventStartsAt = timing?.startsAt ?? new Date(Date.now() - 15 * 60_000).toISOString();

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: eventEndsAt,
    signalsSent,
    mutualMatches,
    officeHoursActive,
  });

  const intelligence = useOpportunityIntelligence({
    presence,
    eventStartsAt,
    eventEndsAt,
    activity: [],
    userHasMutual: mutualMatches > 0,
    now: clock,
  });

  useRegretRecorder({
    signals: FEATURE_FLAGS.regretRecorder ? presence.visibleTargets : [],
    eventId,
    userId,
  });

  useEffect(() => {
    if (FEATURE_FLAGS.presenceEngine) logPresenceMetrics(presence);
  }, [presence]);

  useEffect(() => {
    if (FEATURE_FLAGS.opportunitySurge && intelligence.surge.shouldInterrupt) {
      console.log("[Opportunity Intelligence]", {
        eventId,
        level: intelligence.surge.level,
        score: intelligence.surge.score,
        evidence: intelligence.surge.evidence,
      });
    }
  }, [eventId, intelligence.surge]);

  if (loading || !timing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  const surgeMode = intelligence.surge.level === "peak" || intelligence.surge.level === "closing";

  return (
    <ScrollView
      style={[styles.container, surgeMode && styles.surgeBackground]}
      contentContainerStyle={styles.content}
    >
      <TensionBar tensionScore={presence.tensionScore} urgencyLevel={presence.urgencyLevel} />

      <View style={styles.phaseRow}>
        <View style={styles.phaseChip}>
          <Text style={styles.phaseLabel}>{intelligence.phase.phase}</Text>
        </View>
        <Text style={styles.phaseContext}>
          {intelligence.phase.phase === "closing"
            ? `${intelligence.phase.remainingMinutes}m until this room closes`
            : `${Math.round(intelligence.phase.progress * 100)}% through the event`}
        </Text>
      </View>

      {FEATURE_FLAGS.opportunityWindowBanner && (
        <OpportunityWindowBanner surge={intelligence.surge} />
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate("EventIntent", { eventId })}
        style={styles.intentCard}
      >
        <View style={styles.intentHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.intentEyebrow}>YOUR EVENT FOCUS</Text>
            <Text style={styles.intentTitle}>
              {declaredFitSummary.total > 0
                ? `${declaredFitSummary.total} declared fit${declaredFitSummary.total === 1 ? " is" : "s are"} live nearby`
                : "Tell Beacon what would make this room useful to you"}
            </Text>
          </View>
          <Text style={styles.intentArrow}>→</Text>
        </View>
        <Text style={styles.intentDetail}>
          {declaredFitSummary.total > 0
            ? `${declaredFitSummary.twoWay} two-way fit${declaredFitSummary.twoWay === 1 ? "" : "s"}. These come only from explicit event-scoped selections shared by both sides.`
            : "Choose what you are looking for help with and what you are open to helping with. Beacon uses only pairwise intersections—not inferred browsing or movement behavior."}
        </Text>
        {declaredFitSummary.strongest ? (
          <Text style={styles.intentMeta}>
            STRONGEST LIVE FIT · {Math.round((declaredFitSummary.strongest.declaredFitStrength ?? 0) * 100)}% PAIRWISE EVIDENCE
          </Text>
        ) : null}
      </Pressable>

      <EventFocusWindowCard eventId={eventId} />
      <CommunityExchangePreview eventId={eventId} />
      <IntroductionInboxPreview eventId={eventId} />
      <VenueServiceStatusCard eventId={eventId} />

      <View style={styles.fieldCard}>
        <Text style={styles.fieldEyebrow}>LIVE FIELD</Text>
        <Text style={styles.fieldHeadline}>
          {intelligence.surge.advisory ?? "Beacon is watching for a high-confidence opportunity window."}
        </Text>

        <View style={styles.metricsGrid}>
          <View style={styles.metricCell}>
            <Text style={styles.metricValue}>{presence.density}</Text>
            <Text style={styles.metricLabel}>nearby signals</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricValue}>{declaredFitSummary.total}</Text>
            <Text style={styles.metricLabel}>declared fits nearby</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricValue}>{presence.timeRemainingMinutes}</Text>
            <Text style={styles.metricLabel}>minutes remain</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={styles.metricValue}>{intelligence.surge.score}</Text>
            <Text style={styles.metricLabel}>window readiness</Text>
          </View>
        </View>
      </View>

      {presence.missedSignals > 0 && (
        <View style={styles.insightCard}>
          <Text style={styles.insightEyebrow}>PRIVATE EVENT MEMORY</Text>
          <Text style={styles.insightText}>
            You crossed activation range with {presence.missedSignals} potential {presence.missedSignals === 1 ? "opportunity" : "opportunities"} that did not become mutual.
          </Text>
          <Text style={styles.insightFootnote}>
            Beacon records derived event state only; it does not display a public ranking or raw movement trail.
          </Text>
        </View>
      )}

      {!hasLocation && (
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>{lastError ?? "Waiting for your location…"}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#070A10",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  surgeBackground: {
    backgroundColor: "#0B0A0A",
  },
  phaseRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  phaseChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(37, 99, 235, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
  },
  phaseLabel: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  phaseContext: {
    flex: 1,
    textAlign: "right",
    color: "#9CA3AF",
    fontSize: 12,
  },
  intentCard: {
    marginTop: 16,
    borderRadius: 22,
    padding: 17,
    backgroundColor: "rgba(8, 27, 34, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(34, 211, 238, 0.28)",
  },
  intentHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  intentEyebrow: { color: "#67E8F9", fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  intentTitle: { marginTop: 5, color: "#ECFEFF", fontSize: 17, lineHeight: 22, fontWeight: "800" },
  intentArrow: { color: "#67E8F9", fontSize: 24, lineHeight: 26 },
  intentDetail: { marginTop: 8, color: "#A5B4C4", fontSize: 12, lineHeight: 18 },
  intentMeta: { marginTop: 10, color: "#67E8F9", fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  fieldCard: {
    marginTop: 16,
    borderRadius: 22,
    padding: 18,
    backgroundColor: "#0F1521",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  fieldEyebrow: {
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  fieldHeadline: {
    marginTop: 8,
    color: "#F8FAFC",
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "700",
  },
  metricsGrid: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCell: {
    width: "47%",
    borderRadius: 14,
    padding: 13,
    backgroundColor: "rgba(15, 23, 42, 0.88)",
  },
  metricValue: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    marginTop: 3,
    color: "#94A3B8",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  insightCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.18)",
  },
  insightEyebrow: {
    color: "#FDA4AF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  insightText: {
    marginTop: 8,
    color: "#F8FAFC",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  insightFootnote: {
    marginTop: 8,
    color: "#9CA3AF",
    fontSize: 11,
    lineHeight: 16,
  },
  statusCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#111827",
  },
  statusText: {
    color: "#FCA5A5",
    fontSize: 13,
  },
});
