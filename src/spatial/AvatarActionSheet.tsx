import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { blockUser, reportUser } from '../services/abuse.service';
import { useAuth } from '../hooks/useAuth';
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
}: Readonly<Props>) {
  const { user } = useAuth();
  const myId = user?.id ?? '';
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

  const confirmBlock = () => {
    Alert.alert(
      'Block this person?',
      'They will disappear from your field and cannot send you requests at this event.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(myId, target.targetId);
              onClose();
            } catch (e) {
              Alert.alert('Could not block', e instanceof Error ? e.message : 'Try again');
            }
          },
        },
      ]
    );
  };

  const confirmReport = () => {
    Alert.prompt(
      'Report',
      'What happened? A moderator will review.',
      async (reason) => {
        if (!reason?.trim()) return;
        try {
          await reportUser({
            reporterId: myId,
            targetId: target.targetId,
            eventId: target.eventId,
            reason: reason.trim(),
          });
          Alert.alert('Reported', 'Thanks — we will review this.');
          onClose();
        } catch (e) {
          Alert.alert('Could not report', e instanceof Error ? e.message : 'Try again');
        }
      }
    );
  };

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

              <View style={styles.dangerRow}>
                <Pressable style={styles.dangerLink} onPress={confirmReport}>
                  <Text style={styles.dangerText}>Report</Text>
                </Pressable>
                <Pressable style={styles.dangerLink} onPress={confirmBlock}>
                  <Text style={styles.dangerText}>Block</Text>
                </Pressable>
              </View>
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
  dangerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 16,
  },
  dangerLink: { padding: 8 },
  dangerText: { color: '#ef4444', fontSize: 12, letterSpacing: 1 },
});
