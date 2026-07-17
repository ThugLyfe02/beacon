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
import OpportunityField from "./OpportunityField";
import SpatialSignalLayer from "./SpatialSignalLayer";
import { buildSpatialExperience } from "./SpatialExperienceEngine";
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

function FieldFloor() {
  const grid = useMemo(() => {
    const helper = new GridHelper(60, 30, new Color("#1f2347"), new Color("#10112a"));
    helper.position.y = -3;
    return helper;
  }, []);
  return (
    <>
      <primitive object={grid} />
      {RING_RADII.map((radius) => (
        <mesh
          key={radius}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -2.99, 0]}
        >
          <ringGeometry args={[radius - 0.04, radius, 96]} />
          <meshBasicMaterial color="#7c8eff" transparent opacity={0.35} side={DoubleSide} />
        </mesh>
      ))}
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

  const spatialExperience = useMemo(
    () => buildSpatialExperience(presence),
    [presence],
  );

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
        <color attach="background" args={["#060716"]} />
        <fog attach="fog" args={["#060716", 6, 55]} />
        <hemisphereLight args={["#6b88ff", "#3a2a14", 0.55]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[10, 10, 10]} intensity={0.8} />
        <FieldFloor />
        <OpportunityField
          tensionScore={presence.tensionScore}
          density={presence.density}
          mutualMatches={mutualMatches}
          urgencyLevel={presence.urgencyLevel}
        />
        <SpatialSignalLayer
          focusTargets={spatialExperience.focusTargets}
          accent={spatialExperience.accent}
        />
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

      <View pointerEvents="none" style={styles.liveReadWrap}>
        <View style={[styles.liveReadCard, { borderColor: `${spatialExperience.accent}55` }]}>
          <View style={styles.liveReadHeader}>
            <View style={[styles.liveDot, { backgroundColor: spatialExperience.accent }]} />
            <Text style={[styles.liveReadLabel, { color: spatialExperience.accent }]}>LIVE READ</Text>
          </View>
          <Text style={styles.liveReadHeadline}>{spatialExperience.headline}</Text>
          <Text style={styles.liveReadDetail}>{spatialExperience.detail}</Text>
          {spatialExperience.hiddenOpportunityCount > 0 && (
            <Text style={styles.liveReadFootnote}>
              +{spatialExperience.hiddenOpportunityCount} more visible in the field
            </Text>
          )}
        </View>
      </View>

      <View style={styles.overlay}>
        {__DEV__ && (
          <View style={styles.debugHud}>
            <Text style={styles.debugText}>
              signals: {rawSignals.length} · targets: {presence.visibleTargets.length} · sent: {signalsSent} · matches: {mutualMatches}
            </Text>
            {presence.visibleTargets.slice(0, 3).map((target) => (
              <Text key={target.targetId} style={styles.debugText}>
                · {target.targetId.slice(0, 8)} @ {Math.round(target.distanceFeet)}ft {target.targetAvatarUrl3d ? '(glb)' : '(sphere)'}
              </Text>
            ))}
          </View>
        )}
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
  liveReadWrap: {
    position: "absolute",
    top: 18,
    left: 16,
    right: 16,
    alignItems: "flex-start",
  },
  liveReadCard: {
    maxWidth: 390,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(7, 10, 16, 0.82)",
  },
  liveReadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  liveReadLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  liveReadHeadline: {
    marginTop: 7,
    color: "#F8FAFC",
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "750",
  },
  liveReadDetail: {
    marginTop: 5,
    color: "#A8B2C1",
    fontSize: 12,
    lineHeight: 17,
  },
  liveReadFootnote: {
    marginTop: 8,
    color: "#64748B",
    fontSize: 10,
    letterSpacing: 0.2,
  },
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