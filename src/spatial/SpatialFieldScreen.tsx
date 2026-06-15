import React, { Suspense, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from "@react-navigation/native";
import { Canvas } from "@react-three/fiber/native";
import { DoubleSide, GridHelper, Color } from "three";
import AvatarRenderer from "./AvatarRenderer";
import { RING_RADII } from "./fieldConstants";
import AvatarActionSheet from "./AvatarActionSheet";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import TensionBar from "../components/TensionBar";
import { useAuth } from "../hooks/useAuth";
import { usePresenceFeed } from "../hooks/usePresenceFeed";
import { getEventById } from "../services/event.service";
import { sendConnectionRequest } from "../services/match.service";
import type { ProximitySignal } from "../presence/PresenceEngine";

type SpatialFieldParams = { SpatialField: { eventId: string } };

// ---------------------------------------------------------------------------
// FieldFloor — large grid + 3 distance rings + a horizon glow. The rings
// double as distance markers (matching the presence engine's bucket cutoffs
// at ~10ft / 30ft / 60ft equivalents), so the user reads depth from "Alex is
// inside the closest ring" rather than just relative head sizes.
// ---------------------------------------------------------------------------

function FieldFloor() {
  const grid = useMemo(() => {
    const helper = new GridHelper(60, 30, new Color("#1f2347"), new Color("#10112a"));
    helper.position.y = -3;
    return helper;
  }, []);
  return (
    <>
      <primitive object={grid} />
      {RING_RADII.map((r) => (
        <mesh
          key={r}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2.99, 0]}
        >
          <ringGeometry args={[r - 0.04, r, 96]} />
          <meshBasicMaterial color="#7c8eff" transparent opacity={0.35} side={DoubleSide} />
        </mesh>
      ))}
      {/* Faint glow disk where the user "stands" — gives a sense of self. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.98, 0]}>
        <circleGeometry args={[0.4, 32]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.7} />
      </mesh>
    </>
  );
}

type Target = ProximitySignal & { bucket?: number };

export default function SpatialFieldScreen() {
  const route = useRoute<RouteProp<SpatialFieldParams, "SpatialField">>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);

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

  const handleConnect = async (targetId: string) => {
    const result = await sendConnectionRequest(eventId, userId, targetId);
    if (result.error) {
      throw new Error(
        "message" in result.error ? result.error.message : "Could not send request"
      );
    }
  };

  const handleViewProfile = (targetId: string) => {
    navigation.navigate("Profile", { userId: targetId });
  };

  const handleOfficeHours = (targetId: string) => {
    navigation.navigate("OfficeHoursRequest", { eventId, recipientId: targetId });
  };

  if (!presence) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Canvas camera={{ position: [0, 2.5, 12], fov: 60 }} style={styles.canvas}>
        {/* Deep blue-black so heads and the floor grid don't sit on a void. */}
        <color attach="background" args={["#060716"]} />
        {/* Fog gives perceptual depth; tuned so far avatars fade as they
            recede past the third ring (~60ft equivalent). */}
        <fog attach="fog" args={["#060716", 6, 55]} />
        {/* Soft sky/ground bounce. Cool blue overhead, warm amber underfoot,
            cheap-trick way to make any scene feel like it has air in it. */}
        <hemisphereLight args={["#6b88ff", "#3a2a14", 0.55]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[10, 10, 10]} intensity={0.8} />
        <FieldFloor />
        <Suspense fallback={null}>
          {presence.visibleTargets.map((target) => (
            <AvatarRenderer
              key={target.targetId}
              avatar={target}
              onTap={setSelectedTarget}
            />
          ))}
        </Suspense>
      </Canvas>
      <View style={styles.overlay}>
        <View style={styles.debugHud}>
          <Text style={styles.debugText}>
            signals: {rawSignals.length} · targets: {presence.visibleTargets.length} · sent: {signalsSent} · matches: {mutualMatches}
          </Text>
          {presence.visibleTargets.slice(0, 3).map((t) => (
            <Text key={t.targetId} style={styles.debugText}>
              · {t.targetId.slice(0, 8)} @ {Math.round(t.distanceFeet)}ft {t.targetAvatarUrl3d ? '(glb)' : '(sphere)'}
            </Text>
          ))}
        </View>
        <TensionBar tensionScore={presence.tensionScore} urgencyLevel={presence.urgencyLevel} />
      </View>

      <AvatarActionSheet
        target={selectedTarget}
        visible={selectedTarget !== null}
        onClose={() => setSelectedTarget(null)}
        onConnect={handleConnect}
        onViewProfile={handleViewProfile}
        onOfficeHours={handleOfficeHours}
      />
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
  debugHud: {
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 8,
    gap: 2,
  },
  debugText: {
    color: "#f5f5f5",
    fontSize: 11,
    fontFamily: "Menlo",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
  },
});
