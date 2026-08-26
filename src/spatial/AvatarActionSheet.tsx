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
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { blockUser, reportUser } from '../services/abuse.service';
import WarmIntroductionRequestCard from '../components/WarmIntroductionRequestCard';
import { useAuth } from '../hooks/useAuth';
import { useHeading } from '../hooks/useHeading';
import { buildSpatialDirectionGuide } from './SpatialDirectionGuide';
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
  onOpenCamera?: (targetId: string) => void;
}

function ageLabel(ageMs: number | null): string {
  if (ageMs == null) return 'freshness unknown';
  if (ageMs < 1_500) return 'updated now';
  if (ageMs < 60_000) return `updated ${Math.max(1, Math.round(ageMs / 1000))}s ago`;
  return `updated ${Math.round(ageMs / 60_000)}m ago`;
}

function intentLabel(key: string): string {
  return key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function AvatarActionSheet({
  target,
  visible,
  onClose,
  onConnect,
  onViewProfile,
  onOfficeHours,
  onOpenCamera,
}: Readonly<Props>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const route = useRoute();
  const { user } = useAuth();
  const myId = user?.id ?? '';
  const heading = useHeading(visible && target != null);
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

  const direction = buildSpatialDirectionGuide(target, heading);
  const canOpenCameraGuide = route.name !== 'ARField' && direction.available && target.bearingFromObserverDeg != null;
  const declaredFitStrength = Math.max(0, Math.min(1, target.declaredFitStrength ?? 0));
  const theyCanHelp = target.declaredFitTheyCanHelp ?? [];
  const iCanHelp = target.declaredFitICanHelp ?? [];
  const hasDeclaredFit = declaredFitStrength > 0 && (theyCanHelp.length > 0 || iCanHelp.length > 0);
  const introductionDomains = [...new Set([...theyCanHelp, ...iCanHelp])].sort();

  const handleOpenCamera = () => {
    onClose();
    if (onOpenCamera) {
      onOpenCamera(target.targetId);
      return;
    }
    navigation.navigate('ARField', { eventId: target.eventId, targetId: target.targetId });
  };

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

              {hasDeclaredFit ? (
                <View style={styles.fitCard}>
                  <View style={styles.directionHeader}>
                    <Text style={styles.fitEyebrow}>DECLARED FIT</Text>
                    <Text style={styles.fitStrength}>{Math.round(declaredFitStrength * 100)}% pairwise</Text>
                  </View>
                  <Text style={styles.fitTitle}>
                    {target.declaredFitTwoWay ? 'Two-way fit from explicit event selections' : 'A declared reason to talk'}
                  </Text>
                  {theyCanHelp.length > 0 ? (
                    <Text style={styles.fitLine}>
                      They explicitly said they can help with: {theyCanHelp.map(intentLabel).join(', ')}.
                    </Text>
                  ) : null}
                  {iCanHelp.length > 0 ? (
                    <Text style={styles.fitLine}>
                      You explicitly said you can help with: {iCanHelp.map(intentLabel).join(', ')}.
                    </Text>
                  ) : null}
                  <Text style={styles.fitBoundary}>
                    This is the intersection of choices both of you made for this event. Beacon does not reveal their full declaration or infer intent from browsing or movement.
                  </Text>
                </View>
              ) : null}

              {hasDeclaredFit ? (
                <WarmIntroductionRequestCard
                  eventId={target.eventId}
                  targetId={target.targetId}
                  domains={introductionDomains}
                />
              ) : null}

              <View style={[styles.directionCard, !direction.available && styles.directionCardMuted]}>
                <View style={styles.directionHeader}>
                  <Text style={styles.directionEyebrow}>LIVE DIRECTION</Text>
                  <Text style={styles.directionConfidence}>{Math.round(direction.confidence * 100)}% signal</Text>
                </View>
                {direction.available ? (
                  <>
                    <Text style={styles.directionPrimary}>
                      {direction.turnInstruction ?? `${direction.cardinal ?? '—'} bearing`}
                    </Text>
                    <Text style={styles.directionMeta}>
                      {direction.cardinal ?? '—'} · {direction.absoluteBearingDeg == null ? 'bearing unavailable' : `${Math.round(direction.absoluteBearingDeg)}°`} · {ageLabel(direction.signalAgeMs)}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.directionPrimaryMuted}>Direction temporarily unavailable</Text>
                    <Text style={styles.directionMeta}>{direction.reason}</Text>
                  </>
                )}
              </View>

              {connectError && <Text style={styles.error}>{connectError}</Text>}

              {canOpenCameraGuide ? (
                <Pressable style={[styles.btn, styles.btnCamera]} onPress={handleOpenCamera}>
                  <Text style={styles.btnTextLight}>Open Camera Guide</Text>
                </Pressable>
              ) : null}

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
                <Text style={styles.btnTextLight}>Request Office Hours</Text>
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnGhost]}
                onPress={() => {
                  onClose();
                  onViewProfile(target.targetId);
                }}
              >
                <Text style={styles.btnTextLight}>View Profile</Text>
              </Pressable>

              <Text style={styles.directionBoundary}>
                Camera guidance uses the latest measured proximity bearing and your on-device compass. Beacon does not predict where this person will move.
              </Text>

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
    backgroundColor: 'rgba(0,0,0,0.64)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0A0D13',
    padding: 24,
    paddingBottom: 38,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#243047',
  },
  name: { color: '#F8FAFC', fontSize: 22, fontWeight: '800' },
  role: { color: '#94A3B8', marginTop: 2, fontSize: 14 },
  oneLiner: { color: '#CBD5E1', marginTop: 8, fontSize: 14, lineHeight: 20 },
  distance: { color: '#F59E0B', marginTop: 12, fontSize: 12, letterSpacing: 1 },
  fitCard: {
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(8, 145, 178, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
  },
  fitEyebrow: { color: '#67E8F9', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  fitStrength: { color: '#67E8F9', fontSize: 9, fontWeight: '800' },
  fitTitle: { marginTop: 7, color: '#ECFEFF', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  fitLine: { marginTop: 5, color: '#CFFAFE', fontSize: 11, lineHeight: 16 },
  fitBoundary: { marginTop: 7, color: '#6B8A96', fontSize: 9, lineHeight: 14 },
  directionCard: {
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.28)',
  },
  directionCardMuted: { backgroundColor: 'rgba(100,116,139,0.08)', borderColor: 'rgba(148,163,184,0.16)' },
  directionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  directionEyebrow: { color: '#7DD3FC', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  directionConfidence: { color: '#64748B', fontSize: 9, fontWeight: '700' },
  directionPrimary: { marginTop: 7, color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  directionPrimaryMuted: { marginTop: 7, color: '#CBD5E1', fontSize: 15, fontWeight: '800' },
  directionMeta: { marginTop: 4, color: '#94A3B8', fontSize: 10, lineHeight: 15 },
  directionBoundary: { marginTop: 12, color: '#64748B', fontSize: 9, lineHeight: 14 },
  error: { color: '#F87171', marginTop: 8, fontSize: 12 },
  btn: {
    marginTop: 12,
    padding: 14,
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    alignItems: 'center',
  },
  btnCamera: { backgroundColor: '#0369A1', borderWidth: 1, borderColor: '#38BDF8' },
  btnAlt: { backgroundColor: '#1D4ED8' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#374151' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
  btnTextLight: { color: '#F8FAFC', fontWeight: '800', fontSize: 15 },
  dangerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 14,
  },
  dangerLink: { padding: 8 },
  dangerText: { color: '#EF4444', fontSize: 12, letterSpacing: 1 },
});
