import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Canvas } from '@react-three/fiber/native';
import SpatialPositionedAvatar from './SpatialPositionedAvatar';
import AvatarActionSheet from './AvatarActionSheet';
import TensionBar from '../components/TensionBar';
import { usePresenceEngine } from '../presence/usePresenceEngine';
import { usePresenceFeed } from '../hooks/usePresenceFeed';
import { useHeading } from '../hooks/useHeading';
import { useAuth } from '../hooks/useAuth';
import { getEventById } from '../services/event.service';
import { sendConnectionRequest } from '../services/match.service';
import { signedAngleDelta } from '../lib/geometry';
import { buildSpatialDirectionGuide } from './SpatialDirectionGuide';
import type { ProximitySignal } from '../presence/PresenceEngine';

type ScreenParams = { ARField: { eventId: string; targetId?: string } };

type Target = ProximitySignal & { bucket?: number };

const FOV_DEG = 60;
const VIEW_HALF_ANGLE_DEG = FOV_DEG / 2;

/**
 * Maps a live proximity signal into the camera coordinate system. The camera is
 * at the origin looking down -Z; the phone compass determines the target's
 * relative angle. Targets outside the current view cone are not rendered behind
 * the camera and are instead handled by the explicit turn guidance HUD.
 */
function arPositionFor(
  signal: ProximitySignal,
  headingDeg: number
): [number, number, number] | null {
  if (signal.bearingFromObserverDeg == null) return null;
  const rel = signedAngleDelta(headingDeg, signal.bearingFromObserverDeg);
  if (Math.abs(rel) > VIEW_HALF_ANGLE_DEG) return null;
  const rad = (rel * Math.PI) / 180;
  const distScene = Math.min(40, Math.max(2, signal.distanceFeet / 4));
  const x = Math.sin(rad) * distScene;
  const z = -Math.cos(rad) * distScene;
  return [x, 0, z];
}

function directionCopy(target: Target | null, heading: number | null, inView: boolean): {
  title: string;
  detail: string;
  confidence: number | null;
} {
  if (!target) {
    return {
      title: 'Live signal unavailable',
      detail: 'Beacon will not project a stale person into the camera. Return to the field and choose another live signal.',
      confidence: null,
    };
  }

  const guide = buildSpatialDirectionGuide(target, heading);
  if (!guide.available) {
    return { title: 'Direction unavailable', detail: guide.reason, confidence: guide.confidence };
  }
  if (heading == null) {
    return {
      title: `${guide.cardinal ?? 'Compass'} · ${Math.round(guide.distanceFeet)} ft`,
      detail: 'Calibrating your device heading for relative turn guidance.',
      confidence: guide.confidence,
    };
  }
  if (inView) {
    return {
      title: `In view · ${Math.round(guide.distanceFeet)} ft`,
      detail: `${guide.cardinal ?? '—'} bearing · keep the phone pointed naturally; Beacon does not auto-track movement.`,
      confidence: guide.confidence,
    };
  }
  return {
    title: guide.turnInstruction ?? `${guide.cardinal ?? '—'} bearing`,
    detail: `${Math.round(guide.distanceFeet)} ft · ${guide.cardinal ?? '—'} · based on the latest measured peer position`,
    confidence: guide.confidence,
  };
}

export default function ARFieldScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'ARField'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId, targetId } = route.params;
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [permission, requestPermission] = useCameraPermissions();
  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (permission && !permission.granted) await requestPermission();
      const event = await getEventById(eventId);
      if (cancelled) return;
      setEventEnd(event?.ends_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString());
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, permission, requestPermission]);

  const heading = useHeading();
  const { rawSignals, signalsSent, mutualMatches } = usePresenceFeed(eventId, userId);

  const presence = usePresenceEngine({
    rawSignals,
    eventEnd: eventEnd ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    signalsSent,
    mutualMatches,
    officeHoursActive: false,
  });

  const focusedTarget = useMemo<Target | null>(() => {
    if (!targetId) return null;
    return (presence.visibleTargets.find((target) => target.targetId === targetId) as Target | undefined) ?? null;
  }, [presence.visibleTargets, targetId]);

  const candidates = targetId && focusedTarget
    ? [focusedTarget]
    : targetId
      ? []
      : presence.visibleTargets as Target[];

  const positioned = heading == null
    ? []
    : candidates
        .map((target) => {
          const position = arPositionFor(target, heading);
          return position ? { target, position } : null;
        })
        .filter((item): item is { target: Target; position: [number, number, number] } => item !== null);

  const focusedInView = Boolean(targetId && positioned.some((item) => item.target.targetId === targetId));
  const guideCopy = targetId ? directionCopy(focusedTarget, heading, focusedInView) : null;

  const handleConnect = async (id: string) => {
    const result = await sendConnectionRequest(eventId, userId, id);
    if (result.error) {
      throw new Error(
        'message' in result.error ? result.error.message : 'Could not send request'
      );
    }
  };

  const handleViewProfile = (id: string) => {
    navigation.navigate('Profile', { userId: id });
  };

  const handleOfficeHours = (id: string) => {
    navigation.navigate('OfficeHoursRequest', { eventId, recipientId: id });
  };

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Camera permission is required for Camera Guide.</Text>
      </View>
    );
  }
  if (!presence) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={StyleSheet.absoluteFillObject} facing="back" />
      <Canvas
        style={StyleSheet.absoluteFillObject}
        camera={{ position: [0, 0, 0], fov: FOV_DEG }}
        gl={{ alpha: true } as any}
      >
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={0.6} />
        <Suspense fallback={null}>
          {positioned.map(({ target, position }) => (
            <SpatialPositionedAvatar
              key={target.targetId}
              avatar={target}
              position={position}
              onTap={setSelectedTarget}
            />
          ))}
        </Suspense>
      </Canvas>

      {targetId ? (
        <View pointerEvents="none" style={styles.targetHud}>
          <View style={[styles.targetCard, focusedInView && styles.targetCardLocked]}>
            <View style={styles.targetHeader}>
              <Text style={styles.targetEyebrow}>CAMERA GUIDE</Text>
              {guideCopy?.confidence != null ? (
                <Text style={styles.targetConfidence}>{Math.round(guideCopy.confidence * 100)}% signal</Text>
              ) : null}
            </View>
            <Text style={styles.targetTitle}>{guideCopy?.title ?? 'Loading direction…'}</Text>
            <Text style={styles.targetDetail}>{guideCopy?.detail ?? 'Waiting for a live proximity signal.'}</Text>
          </View>

          <View style={[styles.reticle, focusedInView && styles.reticleLocked]}>
            <View style={styles.reticleDot} />
          </View>
        </View>
      ) : (
        <View style={styles.hud}>
          {heading == null && (
            <Text style={styles.hudText}>Calibrating compass — move the phone gently in a figure-8.</Text>
          )}
          {heading != null && positioned.length === 0 && (
            <Text style={styles.hudText}>No live attendees are inside the current camera view. Pan naturally around the room.</Text>
          )}
        </View>
      )}

      <View style={styles.tensionWrap}>
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
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  center: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  body: { color: '#D1D5DB', textAlign: 'center' },
  hud: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  hudText: {
    color: '#F5F5F5',
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    fontSize: 12,
    textAlign: 'center',
  },
  targetHud: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    paddingTop: 22,
  },
  targetCard: {
    width: '90%',
    maxWidth: 420,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderRadius: 18,
    backgroundColor: 'rgba(3, 8, 16, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.32)',
  },
  targetCardLocked: { borderColor: 'rgba(34, 197, 94, 0.52)', backgroundColor: 'rgba(3, 14, 12, 0.8)' },
  targetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  targetEyebrow: { color: '#7DD3FC', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  targetConfidence: { color: '#94A3B8', fontSize: 9, fontWeight: '700' },
  targetTitle: { marginTop: 7, color: '#F8FAFC', fontSize: 20, fontWeight: '900' },
  targetDetail: { marginTop: 4, color: '#CBD5E1', fontSize: 11, lineHeight: 16 },
  reticle: {
    position: 'absolute',
    top: '47%',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleLocked: { borderColor: 'rgba(134, 239, 172, 0.85)', borderWidth: 2 },
  reticleDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F8FAFC' },
  tensionWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
