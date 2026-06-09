import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import {
  AudioSession,
  LiveKitRoom,
  useTracks,
  VideoTrack,
  registerGlobals,
} from '@livekit/react-native';
import { Track } from 'livekit-client';
import { usePremiumStatus } from '../premium/usePremium';
import { getLivekitTokenForOfficeHours, type LivekitGrant } from '../services/livekit.service';

registerGlobals();

type ScreenParams = { OfficeHoursCall: { officeHoursRequestId: string } };

function CallStage() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ]);

  return (
    <View style={styles.stage}>
      {tracks.map((t) => (
        <View key={t.participant.identity + t.source} style={styles.tile}>
          {t.publication?.track && (
            <VideoTrack trackRef={t} style={StyleSheet.absoluteFillObject} />
          )}
          <Text style={styles.tileLabel}>{t.participant.identity}</Text>
        </View>
      ))}
    </View>
  );
}

export default function OfficeHoursCallScreen() {
  const route = useRoute<RouteProp<ScreenParams, 'OfficeHoursCall'>>();
  const navigation = useNavigation();
  const { officeHoursRequestId } = route.params;
  const isPremium = usePremiumStatus();

  const [grant, setGrant] = useState<LivekitGrant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    let cancelled = false;
    (async () => {
      try {
        await AudioSession.startAudioSession();
        const g = await getLivekitTokenForOfficeHours(officeHoursRequestId);
        if (!cancelled) setGrant(g);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start call');
      }
    })();
    return () => {
      cancelled = true;
      AudioSession.stopAudioSession();
    };
  }, [officeHoursRequestId, isPremium]);

  if (!isPremium) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Calls are premium-only</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Could not join</Text>
        <Text style={styles.body}>{error}</Text>
        <Pressable style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (!grant) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" size="large" />
        <Text style={styles.body}>Connecting…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LiveKitRoom
        serverUrl={grant.wsUrl}
        token={grant.token}
        connect
        audio
        video
        options={{ adaptiveStream: true, dynacast: true }}
      >
        <CallStage />
      </LiveKitRoom>
      <Pressable
        style={styles.leaveBtn}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.leaveText}>End Call</Text>
      </Pressable>
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
  stage: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    flex: 1,
    minWidth: '50%',
    minHeight: '50%',
    backgroundColor: '#111827',
  },
  tileLabel: {
    color: '#f5f5f5',
    position: 'absolute',
    bottom: 8,
    left: 8,
    fontSize: 12,
  },
  title: { color: '#f5f5f5', fontSize: 24, fontWeight: '700' },
  body: { color: '#9ca3af', marginTop: 12 },
  btn: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f59e0b',
    borderRadius: 8,
  },
  btnText: { color: '#0a0a0a', fontWeight: '700' },
  leaveBtn: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
  },
  leaveText: { color: '#f5f5f5', fontWeight: '700' },
});
