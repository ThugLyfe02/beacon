import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { confirmOfficeHoursCompletion } from '../services/officeHours.service';

registerGlobals();

type ScreenParams = { OfficeHoursCall: { officeHoursRequestId: string } };

function CallStage() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ]);

  return (
    <View style={styles.stage}>
      {tracks.map((track) => (
        <View key={track.participant.identity + track.source} style={styles.tile}>
          {track.publication?.track && (
            <VideoTrack trackRef={track} style={StyleSheet.absoluteFillObject} />
          )}
          <Text style={styles.tileLabel}>{track.participant.identity}</Text>
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
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    let cancelled = false;
    (async () => {
      try {
        await AudioSession.startAudioSession();
        const nextGrant = await getLivekitTokenForOfficeHours(officeHoursRequestId);
        if (!cancelled) setGrant(nextGrant);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not start call');
      }
    })();
    return () => {
      cancelled = true;
      AudioSession.stopAudioSession();
    };
  }, [officeHoursRequestId, isPremium]);

  async function endAndConfirm() {
    if (confirming) return;
    setConfirming(true);
    try {
      const state = await confirmOfficeHoursCompletion(officeHoursRequestId);
      if (state.status === 'completed') {
        Alert.alert(
          'Two-party session confirmed',
          'Both participants independently confirmed this Office Hours session. It can now count as verified outcome evidence.',
        );
      } else {
        Alert.alert(
          'Your confirmation is sealed',
          'Beacon recorded only your side. The session will not count as completed until the other participant independently confirms.',
        );
      }
      navigation.goBack();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not confirm your side.';
      Alert.alert(
        'Call ended without outcome confirmation',
        `${message} You can leave without changing the verified completion state.`,
      );
    } finally {
      setConfirming(false);
    }
  }

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

      <View style={styles.callControls}>
        <Pressable
          disabled={confirming}
          style={[styles.confirmBtn, confirming && styles.disabled]}
          onPress={endAndConfirm}
        >
          {confirming ? (
            <ActivityIndicator color="#071018" />
          ) : (
            <Text style={styles.confirmText}>End & confirm my side</Text>
          )}
        </Pressable>
        <Pressable
          disabled={confirming}
          style={styles.leaveBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.leaveText}>Leave without confirming</Text>
        </Pressable>
      </View>
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
  callControls: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 28,
    gap: 8,
  },
  confirmBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#34D399',
    borderRadius: 999,
  },
  confirmText: { color: '#071018', fontWeight: '800' },
  leaveBtn: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'rgba(239,68,68,0.9)',
    borderRadius: 999,
  },
  leaveText: { color: '#f5f5f5', fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
