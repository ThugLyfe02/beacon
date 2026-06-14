import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { usePremiumStatus } from '../premium/usePremium';
import { setAvatar3dUrl } from '../services/user.service';
import {
  getMeshyAvatarStatus,
  startMeshyAvatarGeneration,
  type MeshyStatus,
} from '../services/meshy.service';

const POLL_INTERVAL_MS = 5000;

type Stage =
  | { kind: 'idle' }
  | { kind: 'picked'; uri: string; base64: string }
  | { kind: 'submitting' }
  | { kind: 'polling'; taskId: string; progress: number; status: MeshyStatus }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export default function ChooseAvatarScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const isPremium = usePremiumStatus();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const pickSelfie = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    setStage({
      kind: 'picked',
      uri: asset.uri,
      base64: asset.base64 ?? '',
    });
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const asset = result.assets[0];
    setStage({
      kind: 'picked',
      uri: asset.uri,
      base64: asset.base64 ?? '',
    });
  };

  const pollStatus = (taskId: string) => {
    const tick = async () => {
      try {
        const res = await getMeshyAvatarStatus(taskId);
        setStage({ kind: 'polling', taskId, progress: res.progress, status: res.status });
        if (res.status === 'SUCCEEDED' && res.glbUrl) {
          if (user?.id) await setAvatar3dUrl(user.id, res.glbUrl);
          setStage({ kind: 'success' });
          setTimeout(() => navigation.goBack(), 800);
          return;
        }
        if (res.status === 'FAILED' || res.status === 'CANCELED') {
          setStage({ kind: 'error', message: `Generation ${res.status.toLowerCase()}.` });
          return;
        }
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        setStage({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Polling failed',
        });
      }
    };
    tick();
  };

  const submit = async () => {
    if (stage.kind !== 'picked') return;
    setStage({ kind: 'submitting' });
    try {
      const dataUri = `data:image/jpeg;base64,${stage.base64}`;
      const taskId = await startMeshyAvatarGeneration(dataUri);
      setStage({ kind: 'polling', taskId, progress: 0, status: 'PENDING' });
      pollStatus(taskId);
    } catch (err) {
      setStage({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not start',
      });
    }
  };

  if (!isPremium) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Photoreal Avatars are premium-only</Text>
        <Text style={styles.body}>
          Upgrade in Profile to turn a selfie into a photoreal 3D avatar.
        </Text>
        <Pressable style={styles.ghostBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.ghostText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (stage.kind === 'success') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Saved.</Text>
        <Text style={styles.body}>Your avatar is now visible to other attendees.</Text>
      </View>
    );
  }

  if (stage.kind === 'submitting' || stage.kind === 'polling') {
    const pct =
      stage.kind === 'polling' ? Math.max(0, Math.min(100, Math.round(stage.progress))) : 0;
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" size="large" />
        <Text style={styles.title}>Generating your avatar…</Text>
        <Text style={styles.body}>
          {stage.kind === 'polling'
            ? `${stage.status.toLowerCase()} · ${pct}%`
            : 'Submitting…'}
        </Text>
        <Text style={styles.hint}>This usually takes 1–3 minutes.</Text>
      </View>
    );
  }

  if (stage.kind === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>{stage.message}</Text>
        <Pressable style={styles.btn} onPress={() => setStage({ kind: 'idle' })}>
          <Text style={styles.btnText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Photoreal avatar</Text>
      <Text style={styles.body}>
        Take a clear selfie — face centered, even lighting. We send it through Meshy and turn
        it into a 3D model only other approved attendees can see.
      </Text>

      {stage.kind === 'picked' ? (
        <>
          <Image source={{ uri: stage.uri }} style={styles.preview} />
          <Pressable style={styles.btn} onPress={submit}>
            <Text style={styles.btnText}>Generate Avatar</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={() => setStage({ kind: 'idle' })}>
            <Text style={styles.ghostText}>Retake</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.btn} onPress={pickSelfie}>
            <Text style={styles.btnText}>Take Selfie</Text>
          </Pressable>
          <Pressable style={styles.ghostBtn} onPress={pickFromLibrary}>
            <Text style={styles.ghostText}>Choose from Library</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 24, gap: 16 },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  h1: { color: '#f5f5f5', fontSize: 24, fontWeight: '800' },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { color: '#d1d5db', fontSize: 14, textAlign: 'center' },
  hint: { color: '#6b7280', fontSize: 12 },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: '#111827',
  },
  btn: {
    backgroundColor: '#f59e0b',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#0a0a0a', fontWeight: '700' },
  ghostBtn: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  ghostText: { color: '#d1d5db', fontWeight: '600' },
});
