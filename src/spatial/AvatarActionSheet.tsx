import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import type { ProximitySignal } from '../presence/PresenceEngine';

interface TargetProfile {
  name: string | null;
  role: string | null;
  one_liner: string | null;
  is_premium: boolean;
}

interface Props {
  target: (ProximitySignal & { bucket?: number }) | null;
  visible: boolean;
  onClose: () => void;
  onConnect: (targetId: string) => Promise<void> | void;
  onViewProfile: (targetId: string) => void;
  onOfficeHours: (targetId: string) => void;
}

export default function AvatarActionSheet({
  target,
  visible,
  onClose,
  onConnect,
  onViewProfile,
  onOfficeHours,
}: Props) {
  const [profile, setProfile] = useState<TargetProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!visible || !target) return;
    setProfile(null);
    setConnected(false);
    setConnectError(null);
    setLoadingProfile(true);
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('name, role, one_liner, is_premium')
        .eq('id', target.targetId)
        .single();
      if (cancelled) return;
      if (error) {
        setProfile({ name: null, role: null, one_liner: null, is_premium: false });
      } else {
        setProfile(data as TargetProfile);
      }
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, target?.targetId]);

  if (!target) return null;

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await onConnect(target.targetId);
      setConnected(true);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not send request');
    } finally {
      setConnecting(false);
    }
  };

  const distanceLabel =
    target.distanceFeet < 10
      ? 'Unlocked'
      : target.distanceFeet < 20
      ? 'Silhouette'
      : 'Distortion';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {loadingProfile ? (
            <ActivityIndicator color="#f59e0b" />
          ) : (
            <>
              <Text style={styles.name}>{profile?.name ?? 'Unknown attendee'}</Text>
              {profile?.role && <Text style={styles.role}>{profile.role}</Text>}
              {profile?.one_liner && <Text style={styles.oneLiner}>{profile.one_liner}</Text>}
              <Text style={styles.distance}>
                {distanceLabel} · {Math.round(target.distanceFeet)} ft
              </Text>
              {connectError && <Text style={styles.error}>{connectError}</Text>}

              <Pressable
                style={[styles.btn, connected && styles.btnDisabled]}
                onPress={handleConnect}
                disabled={connecting || connected}
              >
                <Text style={styles.btnText}>
                  {connected ? 'Request Sent' : connecting ? 'Sending…' : 'Connect'}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnAlt]}
                onPress={() => {
                  onClose();
                  onOfficeHours(target.targetId);
                }}
              >
                <Text style={styles.btnText}>Request Office Hours</Text>
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnGhost]}
                onPress={() => {
                  onClose();
                  onViewProfile(target.targetId);
                }}
              >
                <Text style={styles.btnText}>View Profile</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0a0a0a',
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1f2937',
  },
  name: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  role: { color: '#9ca3af', marginTop: 2, fontSize: 14 },
  oneLiner: { color: '#d1d5db', marginTop: 8, fontSize: 14 },
  distance: { color: '#f59e0b', marginTop: 12, fontSize: 12, letterSpacing: 1 },
  error: { color: '#ef4444', marginTop: 8, fontSize: 12 },
  btn: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: '#2563eb' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#374151' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 15 },
});
