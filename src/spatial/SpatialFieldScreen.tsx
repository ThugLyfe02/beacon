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
import SpatialMilestoneLayer from "./SpatialMilestoneLayer";
import SpatialDistrictLayer from "./SpatialDistrictLayer";
import SpatialDirectorLayer from "./SpatialDirectorLayer";
import SpatialDirectorHUD from "./SpatialDirectorHUD";
import SpatialProgressHUD from "./SpatialProgressHUD";
import SpatialContractHUD from "./SpatialContractHUD";
import { buildSpatialExperience } from "./SpatialExperienceEngine";
import { buildSpatialProgression } from "./SpatialProgressionEngine";
import { buildSpatialContractBoard } from "./SpatialContractEngine";
import { buildSpatialDirector } from "./SpatialDirectorEngine";
import { RING_RADII } from "./fieldConstants";
import AvatarActionSheet from "./AvatarActionSheet";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import TensionBar from "../components/TensionBar";
import { useAuth } from "../hooks/useAuth";
import { usePresenceFeed } from "../hooks/usePresenceFeed";
import { usePremiumStatus } from "../premium/usePremium";
import { getEventById } from "../services/event.service";
import { sendConnectionRequest } from "../services/match.service";
import type { ProximitySignal } from "../presence/PresenceEngine";

type SpatialFieldParams = { SpatialField: { eventId: string } };

interface EventTiming {
  startsAt: string;
  endsAt: string;
}

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
  const isPremium = usePremiumStatus();

  const [eventTiming, setEventTiming] = useState<EventTiming | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const event = await getEventById(eventId);
      if (cancelled) return;
      setEventTiming({
        startsAt: event?.starts_at ?? new Date(Date.now() - 15 * 60_000).toISOString(),
        endsAt: event?.ends_at ?? new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const {
    rawSignals,
    signalsSent,
    mutualMatches,
    runtime,
  } = usePresenceFeed(eventId, userId);

  const fallbackEndsAt = eventTiming?.endsAt ?? new Date(Date.now() + 60 * 60_000).toISOString();
  const fallbackStartsAt = eventTiming?.startsAt ?? new Date(Date.now() - 15 * 60_000).toISOString();

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: fallbackEndsAt,
    signalsSent,
    mutualMatches,
    officeHoursActive: false,
  });

  const progression = useMemo(
    () => buildSpatialProgression({ presence, signalsSent, mutualMatches }),
    [presence, signalsSent, mutualMatches],
  );

  const director = useMemo(
    () => buildSpatialDirector({
      presence,
      progression,
      runtime,
      mutualMatches,
      eventStartsAt: fallbackStartsAt,
      eventEndsAt: fallbackEndsAt,
    }),
    [presence, progression, runtime, mutualMatches, fallbackStartsAt, fallbackEndsAt],
  );

  const spatialExperience = useMemo(
    () => buildSpatialExperience(presence),
    [presence],
  );

  const contractBoard = useMemo(
    () => buildSpatialContractBoard({
      presence,
      progression,
      signalsSent,
      mutualMatches,
      isPremium,
    }),
    [presence, progression, signalsSent, mutualMatches, isPremium],
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

  if (!presence || !eventTiming) {
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
        <SpatialDirectorLayer director={director} />
        <SpatialDistrictLayer
          progression={progression}
          accent={director.accent}
          premium={isPremium}
        />
        <OpportunityField
          tensionScore={presence.tensionScore}
          density={presence.density}
          mutualMatches={mutualMatches}
          urgencyLevel={presence.urgencyLevel}
        />
        <SpatialSignalLayer
          focusTargets={spatialExperience.focusTargets}
          accent={director.accent}
          detailBudget={director.detailBudget}
        />
        <SpatialMilestoneLayer progression={progression} accent={director.accent} />
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

      <SpatialDirectorHUD director={director} />
      <SpatialContractHUD
        board={contractBoard}
        accent={director.accent}
        isPremium={isPremium}
      />
      <SpatialProgressHUD progression={progression} accent={director.accent} />

      <View style={styles.overlay}>
        {__DEV__ && (
          <View style={styles.debugHud}>
            <Text style={styles.debugText}>
              act: {director.act} · detail: {director.detailBudget}/{spatialExperience.focusTargets.length} · intensity: {director.worldIntensity.toFixed(2)} · signals: {rawSignals.length}
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
