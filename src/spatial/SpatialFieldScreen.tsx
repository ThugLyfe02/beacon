import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from "@react-navigation/native";
import { Canvas } from "@react-three/fiber/native";
import { DoubleSide, GridHelper, Color } from "three";
import SpatialAvatarLayer from "./SpatialAvatarLayer";
import SpatialFocusLayer from "./SpatialFocusLayer";
import OpportunityField from "./OpportunityField";
import SpatialSignalLayer from "./SpatialSignalLayer";
import SpatialMilestoneLayer from "./SpatialMilestoneLayer";
import SpatialDistrictLayer from "./SpatialDistrictLayer";
import SpatialDirectorLayer from "./SpatialDirectorLayer";
import SpatialDirectorHUD from "./SpatialDirectorHUD";
import SpatialProgressHUD from "./SpatialProgressHUD";
import SpatialContractHUD from "./SpatialContractHUD";
import SpatialWorldIntelligenceLayer from "./SpatialWorldIntelligenceLayer";
import SpatialWorldIntelligenceHUD from "./SpatialWorldIntelligenceHUD";
import SpatialInteractionLayer from "./SpatialInteractionLayer";
import SpatialNarrativeHUD from "./SpatialNarrativeHUD";
import SpatialCameraRig from "./SpatialCameraRig";
import SpatialNavigationHUD from "./SpatialNavigationHUD";
import SpatialLandmarkHUD from "./SpatialLandmarkHUD";
import SpatialTourHUD from "./SpatialTourHUD";
import { buildSpatialExperience } from "./SpatialExperienceEngine";
import { buildSpatialLayout } from "./SpatialLayoutEngine";
import { buildSpatialProgression } from "./SpatialProgressionEngine";
import { buildSpatialContractBoard } from "./SpatialContractEngine";
import { buildSpatialDirector } from "./SpatialDirectorEngine";
import { buildSpatialWorldIntelligence } from "./SpatialWorldIntelligenceEngine";
import { buildTemporalArchitecture } from "./TemporalArchitectureEngine";
import { buildSpatialWorldOrchestration } from "./SpatialWorldOrchestrator";
import { buildSpatialNavigation, type SpatialCameraMode } from "./SpatialNavigationEngine";
import { buildSpatialLandmarks, cycleSpatialLandmark } from "./SpatialLandmarkEngine";
import { buildSpatialQualityState } from "./SpatialQualityGovernor";
import { buildSpatialAttentionPlan } from "./SpatialAttentionEngine";
import { useSpatialTour } from "./useSpatialTour";
import {
  createSpatialInteractionPulse,
  detectAlmostDiscoveredMoments,
  pruneAlmostDiscoveredMoments,
  pruneInteractionPulses,
  type AlmostDiscoveredMoment,
  type SpatialInteractionPulse,
} from "./SpatialInteractionEngine";
import { RING_RADII } from "./fieldConstants";
import AvatarActionSheet from "./AvatarActionSheet";
import { usePresenceEngine } from "../presence/usePresenceEngine";
import TensionBar from "../components/TensionBar";
import { useAuth } from "../hooks/useAuth";
import { usePresenceFeed } from "../hooks/usePresenceFeed";
import { useReducedMotionPreference } from "../hooks/useReducedMotionPreference";
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
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.99, 0]}>
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
  const reducedMotion = useReducedMotionPreference();

  const [eventTiming, setEventTiming] = useState<EventTiming | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const [cameraMode, setCameraMode] = useState<SpatialCameraMode>("overview");
  const [activeLandmarkId, setActiveLandmarkId] = useState<string | null>(null);
  const [interactionPulses, setInteractionPulses] = useState<SpatialInteractionPulse[]>([]);
  const [almostDiscovered, setAlmostDiscovered] = useState<AlmostDiscoveredMoment[]>([]);
  const previousTargetsRef = useRef<Target[]>([]);
  const tourOwnedCameraRef = useRef(false);

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

  const { rawSignals, signalsSent, mutualMatches, runtime } = usePresenceFeed(eventId, userId);
  const fallbackEndsAt = eventTiming?.endsAt ?? new Date(Date.now() + 60 * 60_000).toISOString();
  const fallbackStartsAt = eventTiming?.startsAt ?? new Date(Date.now() - 15 * 60_000).toISOString();

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: fallbackEndsAt,
    signalsSent,
    mutualMatches,
    officeHoursActive: false,
  });

  const spatialLayout = useMemo(
    () => buildSpatialLayout(presence.visibleTargets),
    [presence.visibleTargets],
  );
  const selectedLayoutPosition = useMemo(
    () => selectedTarget
      ? spatialLayout.find((node) => node.target.targetId === selectedTarget.targetId)?.position ?? null
      : null,
    [selectedTarget, spatialLayout],
  );

  useEffect(() => {
    if (!selectedTarget) return;
    const stillVisible = presence.visibleTargets.some((target) => target.targetId === selectedTarget.targetId);
    if (!stillVisible) {
      setSelectedTarget(null);
      if (cameraMode === "focus") setCameraMode("overview");
    }
  }, [presence.visibleTargets, selectedTarget, cameraMode]);

  useEffect(() => {
    const now = Date.now();
    const moments = detectAlmostDiscoveredMoments({
      previousTargets: previousTargetsRef.current,
      currentTargets: presence.visibleTargets,
      now,
    });
    if (moments.length > 0) {
      setAlmostDiscovered((current) => [...pruneAlmostDiscoveredMoments(current, now), ...moments].slice(-4));
    } else {
      setAlmostDiscovered((current) => pruneAlmostDiscoveredMoments(current, now));
    }
    previousTargetsRef.current = presence.visibleTargets;
  }, [presence.visibleTargets]);

  useEffect(() => {
    if (interactionPulses.length === 0 && almostDiscovered.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setInteractionPulses((current) => pruneInteractionPulses(current, now));
      setAlmostDiscovered((current) => pruneAlmostDiscoveredMoments(current, now));
    }, 600);
    return () => clearTimeout(timer);
  }, [interactionPulses, almostDiscovered]);

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

  const spatialExperience = useMemo(() => buildSpatialExperience(presence), [presence]);

  const worldIntelligence = useMemo(
    () => buildSpatialWorldIntelligence({
      presence,
      runtime,
      mutualMatches,
      eventStartsAt: fallbackStartsAt,
      eventEndsAt: fallbackEndsAt,
      venueMemory: null,
    }),
    [presence, runtime, mutualMatches, fallbackStartsAt, fallbackEndsAt],
  );

  const temporal = useMemo(
    () => buildTemporalArchitecture({
      presence,
      progression,
      runtime,
      mutualMatches,
      eventStartsAt: fallbackStartsAt,
      eventEndsAt: fallbackEndsAt,
    }),
    [presence, progression, runtime, mutualMatches, fallbackStartsAt, fallbackEndsAt],
  );

  const contractBoard = useMemo(
    () => buildSpatialContractBoard({ presence, progression, signalsSent, mutualMatches, isPremium }),
    [presence, progression, signalsSent, mutualMatches, isPremium],
  );

  const orchestration = useMemo(
    () => buildSpatialWorldOrchestration({
      runtime,
      director,
      intelligence: worldIntelligence,
      temporal,
      progression,
      contracts: contractBoard,
    }),
    [runtime, director, worldIntelligence, temporal, progression, contractBoard],
  );

  const quality = useMemo(
    () => buildSpatialQualityState({
      visibleCount: presence.visibleTargets.length,
      runtime,
      orchestration,
      reducedMotion,
    }),
    [presence.visibleTargets.length, runtime, orchestration, reducedMotion],
  );

  const landmarkState = useMemo(
    () => buildSpatialLandmarks({
      visibleTargets: presence.visibleTargets,
      intelligence: worldIntelligence,
      orchestration,
      activeLandmarkId,
      layout: spatialLayout,
    }),
    [presence.visibleTargets, worldIntelligence, orchestration, activeLandmarkId, spatialLayout],
  );

  const tour = useSpatialTour(landmarkState.landmarks, eventId);

  useEffect(() => {
    if (landmarkState.active && !activeLandmarkId) setActiveLandmarkId(landmarkState.active.id);
    if (activeLandmarkId && !landmarkState.landmarks.some((landmark) => landmark.id === activeLandmarkId)) {
      setActiveLandmarkId(landmarkState.active?.id ?? null);
    }
    if (!landmarkState.active && cameraMode === "landmark") setCameraMode("overview");
  }, [landmarkState, activeLandmarkId, cameraMode]);

  useEffect(() => {
    const tourActive = tour.status === "running" || tour.status === "paused";
    if (tourActive && tour.currentStep) {
      tourOwnedCameraRef.current = true;
      setSelectedTarget(null);
      setActiveLandmarkId(tour.currentStep.landmarkId);
      setCameraMode("landmark");
      return;
    }

    if (tour.status === "complete" && tourOwnedCameraRef.current) {
      setCameraMode(temporal.phase === "reflection" ? "reflection" : "overview");
      return;
    }

    if (tour.status === "idle" && tourOwnedCameraRef.current) {
      tourOwnedCameraRef.current = false;
      if (cameraMode === "landmark") setCameraMode("overview");
    }
  }, [tour.status, tour.currentStep, temporal.phase, cameraMode]);

  const attention = useMemo(
    () => buildSpatialAttentionPlan({
      cameraMode,
      temporalPhase: temporal.phase,
      runtimeHealth: runtime.health,
      qualityTier: quality.tier,
      tourStatus: tour.status,
      landmarkCount: landmarkState.landmarks.length,
      unseenLandmarkCount: tour.unseenCount,
      hasForecast: Boolean(worldIntelligence.forecast),
      hasAlmostDiscovered: almostDiscovered.length > 0,
      hasSelectedTarget: Boolean(selectedTarget),
    }),
    [
      cameraMode,
      temporal.phase,
      runtime.health,
      quality.tier,
      tour.status,
      landmarkState.landmarks.length,
      tour.unseenCount,
      worldIntelligence.forecast,
      almostDiscovered.length,
      selectedTarget,
    ],
  );

  const cinematicNavigation = useMemo(
    () => buildSpatialNavigation({
      requestedMode: cameraMode,
      selectedTarget,
      selectedTargetPosition: selectedLayoutPosition,
      activeLandmark: landmarkState.active,
      visibleCount: presence.visibleTargets.length,
      temporal,
      orchestration,
      reducedMotion,
      dampingMultiplier: quality.cameraDampingMultiplier,
    }),
    [
      cameraMode,
      selectedTarget,
      selectedLayoutPosition,
      landmarkState.active,
      presence.visibleTargets.length,
      temporal,
      orchestration,
      reducedMotion,
      quality.cameraDampingMultiplier,
    ],
  );

  const emitPulse = (targetId: string, kind: "inspect" | "signal" | "mutual" | "office-hours") => {
    const pulse = createSpatialInteractionPulse(targetId, kind);
    setInteractionPulses((current) => [...pruneInteractionPulses(current), pulse].slice(-8));
  };

  const handleTargetTap = (target: Target) => {
    if (tour.status === "running" || tour.status === "paused") tour.stop();
    emitPulse(target.targetId, target.mutual ? "mutual" : "inspect");
    setSelectedTarget(target);
    setCameraMode("focus");
  };

  const handleConnect = async (targetId: string) => {
    const result = await sendConnectionRequest(eventId, userId, targetId);
    if (result.error) {
      throw new Error("message" in result.error ? result.error.message : "Could not send request");
    }
    emitPulse(targetId, "signal");
  };

  const handleViewProfile = (targetId: string) => navigation.navigate("Profile", { userId: targetId });
  const handleOfficeHours = (targetId: string) => {
    emitPulse(targetId, "office-hours");
    navigation.navigate("OfficeHoursRequest", { eventId, recipientId: targetId });
  };

  const handleCloseTarget = () => {
    setSelectedTarget(null);
    if (cameraMode === "focus") setCameraMode("overview");
  };

  const cycleLandmark = (direction: 1 | -1) => {
    const id = cycleSpatialLandmark(landmarkState, direction);
    if (id) {
      setActiveLandmarkId(id);
      tour.markSeen(id);
    }
  };

  const frameActiveLandmark = () => {
    if (landmarkState.active) tour.markSeen(landmarkState.active.id);
    setCameraMode("landmark");
  };

  if (!presence || !eventTiming) {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  const trustedDetailBudget = Math.max(
    1,
    Math.floor(
      director.detailBudget
      * worldIntelligence.trust.detailMultiplier
      * temporal.routeWeightMultiplier
      * (0.72 + orchestration.routeEnergy * 0.28)
      * quality.routeDetailMultiplier,
    ),
  );

  return (
    <View style={styles.container}>
      <Canvas
        camera={{ position: [0, 2.5, 12], fov: 60 }}
        dpr={[1, quality.pixelRatioCap]}
        style={styles.canvas}
      >
        <color attach="background" args={["#060716"]} />
        <fog attach="fog" args={["#060716", 6, 55]} />
        <hemisphereLight args={["#6b88ff", "#3a2a14", 0.55]} />
        <ambientLight intensity={(0.25 + orchestration.districtEnergy * 0.2) * quality.environmentDetailMultiplier} />
        <pointLight position={[10, 10, 10]} intensity={(0.55 + orchestration.routeEnergy * 0.45) * quality.environmentDetailMultiplier} />
        <SpatialCameraRig navigation={cinematicNavigation} />
        <FieldFloor />
        <SpatialDirectorLayer director={director} />
        <SpatialWorldIntelligenceLayer intelligence={worldIntelligence} />
        <SpatialInteractionLayer
          pulses={interactionPulses}
          almostDiscovered={almostDiscovered}
          targets={presence.visibleTargets}
          accent={director.accent}
        />
        <SpatialDistrictLayer progression={progression} accent={director.accent} premium={isPremium} />
        <OpportunityField
          tensionScore={presence.tensionScore}
          density={presence.density}
          mutualMatches={mutualMatches}
          urgencyLevel={presence.urgencyLevel}
        />
        <SpatialSignalLayer
          focusTargets={spatialExperience.focusTargets}
          accent={director.accent}
          detailBudget={trustedDetailBudget}
        />
        <SpatialFocusLayer
          target={cameraMode === "focus" ? selectedTarget : null}
          position={selectedLayoutPosition}
          accent={director.accent}
          intensity={cinematicNavigation.cinematicIntensity}
        />
        <SpatialMilestoneLayer progression={progression} accent={director.accent} />
        <Suspense fallback={null}>
          <SpatialAvatarLayer
            targets={presence.visibleTargets}
            layout={spatialLayout}
            onTap={handleTargetTap}
          />
        </Suspense>
      </Canvas>

      {attention.visible.director && <SpatialDirectorHUD director={director} />}
      {attention.visible["world-intelligence"] && (
        <SpatialWorldIntelligenceHUD intelligence={worldIntelligence} />
      )}
      {attention.visible.narrative && (
        <SpatialNarrativeHUD
          temporal={temporal}
          orchestration={orchestration}
          almostDiscovered={almostDiscovered}
          accent={director.accent}
        />
      )}
      {attention.visible.landmark && (
        <SpatialLandmarkHUD
          state={landmarkState}
          onPrevious={() => cycleLandmark(-1)}
          onNext={() => cycleLandmark(1)}
          onOpen={frameActiveLandmark}
        />
      )}
      {attention.visible.tour && (
        <SpatialTourHUD
          tour={tour}
          landmarkCount={landmarkState.landmarks.length}
          accent={director.accent}
        />
      )}
      {attention.visible.navigation && (
        <SpatialNavigationHUD navigation={cinematicNavigation} onModeChange={setCameraMode} />
      )}
      {attention.visible.contract && (
        <SpatialContractHUD board={contractBoard} accent={director.accent} isPremium={isPremium} />
      )}
      {attention.visible.progress && (
        <SpatialProgressHUD progression={progression} accent={director.accent} />
      )}

      <View style={styles.overlay}>
        {__DEV__ && (
          <View style={styles.debugHud}>
            <Text style={styles.debugText}>
              phase: {temporal.phase} · camera: {cinematicNavigation.mode} · attention: {attention.primary} · tour: {tour.status} · quality: {quality.tier} · detail: {trustedDetailBudget}/{spatialExperience.focusTargets.length}
            </Text>
          </View>
        )}
        <TensionBar tensionScore={presence.tensionScore} urgencyLevel={presence.urgencyLevel} />
      </View>

      <AvatarActionSheet
        target={selectedTarget}
        visible={selectedTarget !== null}
        onClose={handleCloseTarget}
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
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0 },
  debugHud: { backgroundColor: "rgba(0,0,0,0.6)", padding: 8, gap: 2 },
  debugText: { color: "#f5f5f5", fontSize: 11, fontFamily: "Menlo" },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
  },
});
