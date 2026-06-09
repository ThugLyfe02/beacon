import React, { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Canvas } from '@react-three/fiber/native';
import AvatarRenderer from './AvatarRenderer';
import AvatarActionSheet from './AvatarActionSheet';
import TensionBar from '../components/TensionBar';
import { usePresenceEngine } from '../presence/usePresenceEngine';
import { usePresenceFeed } from '../hooks/usePresenceFeed';
import { useHeading } from '../hooks/useHeading';
import { useAuth } from '../hooks/useAuth';
import { getEventById } from '../services/event.service';
import { sendConnectionRequest } from '../services/match.service';
import { signedAngleDelta } from '../lib/geometry';
import type { ProximitySignal } from '../presence/PresenceEngine';

type ScreenParams = { ARField: { eventId: string } };

type Target = ProximitySignal & { bucket?: number };

const FOV_DEG = 60; // matches Canvas camera fov

/**
 * Maps a ProximitySignal to a world-space position relative to a camera at the
 * origin looking down -z, using compass bearing relative to the user's heading.
 */
function arPositionFor(
  signal: ProximitySignal,
  headingDeg: number
): [number, number, number] | null {
  if (signal.bearingFromObserverDeg == null) return null;
  const rel = signedAngleDelta(headingDeg, signal.bearingFromObserverDeg);
  if (Math.abs(rel) > FOV_DEG) return null; // outside view cone
  const rad = (rel * Math.PI) / 180;
  const distScene = Math.min(40, Math.max(2, signal.distanceFeet / 4));
  const x = Math.sin(rad) * distScene;
  const z = -Math.cos(rad) * distScene;
  return [x, 0, z];
}

export default function ARFieldScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'ARField'>>();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const { eventId } = route.params;
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
  }, [eventId, permission]);

  const heading = useHeading();
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
        'message' in result.error ? result.error.message : 'Could not send request'
      );
    }
  };

  const handleViewProfile = (targetId: string) => {
    navigation.navigate('Profile', { userId: targetId });
  };

  const handleOfficeHours = (targetId: string) => {
    navigation.navigate('OfficeHoursRequest', { eventId, recipientId: targetId });
  };

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Camera permission is required for AR.</Text>
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

  const positioned = presence.visibleTargets
    .map((t) => {
      const pos = heading != null ? arPositionFor(t, heading) : null;
      return pos ? { target: t as Target, pos } : null;
    })
    .filter((x): x is { target: Target; pos: [number, number, number] } => x !== null);

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
          {positioned.map(({ target, pos }) => (
            <AvatarRenderer
              key={target.targetId}
              avatar={{ ...target, distanceFeet: -pos[2] * 4 }}
              onTap={setSelectedTarget}
            />
          ))}
        </Suspense>
      </Canvas>

      <View style={styles.hud}>
        {heading == null && (
          <Text style={styles.hudText}>Calibrating compass — wave the phone in a figure-8…</Text>
        )}
        {heading != null && positioned.length === 0 && (
          <Text style={styles.hudText}>No attendees in front of you. Pan around.</Text>
        )}
      </View>

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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  body: { color: '#d1d5db', textAlign: 'center' },
  hud: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  hudText: {
    color: '#f5f5f5',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    fontSize: 12,
  },
  tensionWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
