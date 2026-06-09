import React, { Suspense, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Canvas } from "@react-three/fiber/native";
import AvatarRenderer from "./AvatarRenderer";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import TensionBar from "../components/TensionBar";
import { useAuth } from "../hooks/useAuth";
import { usePresenceFeed } from "../hooks/usePresenceFeed";
import { getEventById } from "../services/event.service";

type SpatialFieldParams = { SpatialField: { eventId: string } };

export default function SpatialFieldScreen() {
  const route = useRoute<RouteProp<SpatialFieldParams, "SpatialField">>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [eventEnd, setEventEnd] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const event = await getEventById(eventId);
      if (cancelled) return;
      setEventEnd(event?.ends_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString());
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const { rawSignals, signalsSent, mutualMatches } = usePresenceFeed(eventId, userId);

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: eventEnd ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    signalsSent,
    mutualMatches,
    officeHoursActive: false,
  });

  if (!presence) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Canvas camera={{ position: [0, 0, 12], fov: 60 }} style={styles.canvas}>
        <color attach="background" args={["#0a0a0a"]} />
        <fog attach="fog" args={["#0a0a0a", 10, 60]} />
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={0.8} />
        <Suspense fallback={null}>
          {presence.visibleTargets.map((target) => (
            <AvatarRenderer key={target.targetId} avatar={target} />
          ))}
        </Suspense>
      </Canvas>
      <View style={styles.overlay}>
        <TensionBar tensionScore={presence.tensionScore} urgencyLevel={presence.urgencyLevel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  canvas: { flex: 1 },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
  },
});
