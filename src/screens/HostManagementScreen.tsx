import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  getHostedEvent,
  updateEventLocation,
} from '../services/event.service';
import { finalizeHostedEvent } from '../services/outcome-intelligence.service';
import {
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
} from '../services/participant.service';
import { watchLocation } from '../services/location.service';
import type { EventRow, PendingJoinRequest } from '../types/database';
import type { LocationSubscription } from 'expo-location';
import {
  GlowButton,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  Surface,
} from '../components/ui';
import { palette, radii, spacing } from '../theme';

interface HostManagementScreenProps {
  userId: string;
  onEventEnded: () => void;
}

function hasLiveWindowEnded(event: EventRow): boolean {
  if (!event.ends_at) return false;
  const endsAt = Date.parse(event.ends_at);
  return Number.isFinite(endsAt) && endsAt <= Date.now();
}

export default function HostManagementScreen({
  userId,
  onEventEnded,
}: Readonly<HostManagementScreenProps>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<LocationSubscription | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEventData = useCallback(
    async (opts: { showAlert?: boolean } = {}) => {
      const { showAlert = false } = opts;
      setIsLoading(true);

      // getHostedEvent intentionally returns the newest *unfinalized* hosted
      // event. A scheduled window may already have ended while the host still
      // needs the control deck to seal verified outcomes and venue memory.
      let hostedEvent: EventRow | null = null;
      try {
        hostedEvent = await getHostedEvent(userId);
        setEvent(hostedEvent);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[HostManagement] getHostedEvent failed:', error);
        const display = `Couldn't load your hosted event: ${msg}`;
        setLoadError(display);
        if (showAlert) Alert.alert('Hosted event lookup failed', display);
        setIsLoading(false);
        return;
      }

      if (!hostedEvent) {
        setRequests([]);
        setIsBroadcasting(false);
        setLoadError(null);
        setIsLoading(false);
        return;
      }

      try {
        const pending = await getPendingJoinRequests(hostedEvent.id);
        setRequests(pending);
        setLoadError(null);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[HostManagement] getPendingJoinRequests failed:', error);
        const display = `Couldn't load pending requests: ${msg}`;
        setLoadError(display);
        if (showAlert) Alert.alert('Pending requests lookup failed', display);
      }

      const liveWindowOpen = !hasLiveWindowEnded(hostedEvent);
      setIsBroadcasting(hostedEvent.location_type === 'live' && liveWindowOpen);
      setIsLoading(false);
    },
    [userId]
  );

  useEffect(() => {
    loadEventData({ showAlert: true });
  }, [loadEventData]);

  useFocusEffect(
    useCallback(() => {
      loadEventData({ showAlert: false });
    }, [loadEventData])
  );

  useEffect(() => {
    const id = setInterval(() => loadEventData({ showAlert: false }), 10000);
    return () => clearInterval(id);
  }, [loadEventData]);

  useEffect(() => {
    let active = true;
    const stop = () => {
      if (locationSubscription) {
        locationSubscription.remove();
        setLocationSubscription(null);
      }
    };

    const liveWindowOpen = event ? !hasLiveWindowEnded(event) : false;
    if (
      event?.location_type === 'live'
      && liveWindowOpen
      && isBroadcasting
      && !isFinalizing
    ) {
      (async () => {
        const sub = await watchLocation(async (coords) => {
          try {
            await updateEventLocation(event.id, userId, coords.latitude, coords.longitude);
          } catch (error) {
            console.error('Failed to update location:', error);
          }
        });
        if (active) setLocationSubscription(sub);
        else sub?.remove();
      })();
    } else {
      stop();
    }

    return () => {
      active = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBroadcasting, isFinalizing, event?.location_type, event?.id, event?.ends_at, userId]);

  const handleApprove = async (participantId: string) => {
    if (!event || hasLiveWindowEnded(event)) return;
    try {
      await approveJoinRequest(participantId);
      setRequests((prev) => prev.filter((request) => request.participant_id !== participantId));
    } catch (error) {
      console.error('Failed to approve request:', error);
      const msg = error instanceof Error ? error.message : 'Could not approve.';
      Alert.alert('Approve failed', msg);
    }
  };

  const handleReject = async (participantId: string) => {
    if (!event || hasLiveWindowEnded(event)) return;
    try {
      await rejectJoinRequest(participantId);
      setRequests((prev) => prev.filter((request) => request.participant_id !== participantId));
    } catch (error) {
      console.error('Failed to reject request:', error);
      const msg = error instanceof Error ? error.message : 'Could not reject.';
      Alert.alert('Reject failed', msg);
    }
  };

  const handleEndEvent = () => {
    if (!event || isFinalizing) return;
    Alert.alert(
      'Finalize beacon?',
      'This closes the live room, preserves matches, Vault and outcome history, and atomically seals the organizer snapshot and venue-learning record. Event history is not deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize event',
          style: 'destructive',
          onPress: async () => {
            setIsFinalizing(true);
            setIsBroadcasting(false);
            try {
              locationSubscription?.remove();
              setLocationSubscription(null);
              const snapshot = await finalizeHostedEvent(event.id);
              setEvent(null);
              setRequests([]);
              onEventEnded();
              Alert.alert(
                'Beacon finalized',
                `Outcome history preserved · ${snapshot.mutualsFormed} mutual${snapshot.mutualsFormed === 1 ? '' : 's'} · Beacon Index ${snapshot.beaconIndex}.`,
              );
            } catch (error) {
              console.error('Failed to finalize event:', error);
              const message = error instanceof Error ? error.message : 'Could not finalize the event safely.';
              Alert.alert('Finalization failed', message);
              setIsBroadcasting(
                event.location_type === 'live' && !hasLiveWindowEnded(event),
              );
            } finally {
              setIsFinalizing(false);
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Loader size={56} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Loading control deck
        </NeonText>
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <GridBackground />
        <Surface elevated padded glow style={styles.emptyCard}>
          <Pill label="No unfinalized event" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Dark room.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Create an event to start broadcasting. Finalized history remains preserved for Vault, outcomes and venue memory.
          </NeonText>
        </Surface>
      </View>
    );
  }

  const liveWindowEnded = hasLiveWindowEnded(event);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      <GridBackground intensity={liveWindowEnded ? 0.22 : 0.4} />
      <View style={styles.section}>
        <Pill
          label={liveWindowEnded ? 'Window ended · outcomes unsealed' : 'Live · hosting'}
          tone={liveWindowEnded ? 'neutral' : 'accent'}
          dot
        />
        <NeonText variant="display" tone="text" glow={!liveWindowEnded} style={{ marginTop: spacing.sm }}>
          {event.name}
        </NeonText>
        {!liveWindowEnded ? (
          <Surface padded style={styles.codeCard}>
            <NeonText variant="label" tone="muted">JOIN CODE</NeonText>
            <NeonText variant="mono" tone="accent" glow style={styles.codeValue}>
              {event.join_code}
            </NeonText>
            <NeonText variant="bodyMuted" style={styles.secretPolicyText}>
              Approval-bypass secrets are one-way protected. Beacon never stores or re-displays their plaintext after creation.
            </NeonText>
          </Surface>
        ) : null}
      </View>

      {liveWindowEnded ? (
        <View style={styles.section}>
          <Surface elevated padded glow style={styles.reflectionCard}>
            <Pill label="REFLECTION MODE" tone="accent" dot />
            <NeonText variant="h1" style={{ marginTop: spacing.sm }}>
              The live world is sealed.
            </NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, lineHeight: 20 }}>
              New joins, connection signals, proximity reveals and live access mutations are now blocked by the database. Finalize when you are ready to atomically preserve the outcome snapshot and feed privacy-gated venue memory.
            </NeonText>
          </Surface>
        </View>
      ) : null}

      {event.location_type === 'live' ? (
        <View style={styles.section}>
          <Surface elevated padded style={styles.row}>
            <View>
              <NeonText variant="h2">Live location</NeonText>
              <NeonText
                variant="label"
                tone={isBroadcasting && !liveWindowEnded ? 'success' : 'muted'}
                style={{ marginTop: 4 }}
              >
                {liveWindowEnded
                  ? '○ SEALED'
                  : isBroadcasting
                    ? '● BROADCASTING'
                    : '○ PAUSED'}
              </NeonText>
            </View>
            <Switch
              value={isBroadcasting && !liveWindowEnded}
              onValueChange={setIsBroadcasting}
              disabled={isFinalizing || liveWindowEnded}
              trackColor={{ false: palette.hairlineStrong, true: palette.accentDim }}
              thumbColor={isBroadcasting && !liveWindowEnded ? palette.accent : palette.textMuted}
              ios_backgroundColor={palette.hairlineStrong}
            />
          </Surface>
        </View>
      ) : null}

      {!liveWindowEnded ? (
        <View style={styles.section}>
          <Pressable
            onPress={() => navigation.navigate('EscortPanel', { eventId: event.id })}
            style={styles.escortBtn}
          >
            <NeonText variant="label" tone="accent">ESCORT QUEUE →</NeonText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <NeonText variant="label" tone={liveWindowEnded ? 'muted' : 'accent'}>
            {liveWindowEnded ? 'SEALED REQUEST STATE' : 'PENDING REQUESTS'}
          </NeonText>
          <View style={styles.sectionHeaderRight}>
            <Pill label={`${requests.length}`} tone={requests.length && !liveWindowEnded ? 'accent' : 'neutral'} />
            {!liveWindowEnded ? (
              <Pressable
                onPress={() => loadEventData({ showAlert: true })}
                hitSlop={12}
                style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}
                accessibilityLabel="Refresh pending requests"
              >
                <NeonText variant="h2" tone="accent" glow style={styles.refreshGlyph}>↻</NeonText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {loadError ? (
          <Surface padded style={styles.errorBanner}>
            <NeonText variant="label" tone="danger">LOAD ERROR</NeonText>
            <NeonText variant="bodyMuted" style={{ marginTop: 4 }}>
              {loadError}
            </NeonText>
          </Surface>
        ) : null}

        {requests.length === 0 ? (
          <Surface padded style={{ marginTop: spacing.md }}>
            <NeonText variant="bodyMuted">
              {liveWindowEnded ? 'No unresolved join requests remain in the sealed state.' : 'No requests right now.'}
            </NeonText>
          </Surface>
        ) : (
          requests.map((request) => (
            <Surface elevated padded key={request.participant_id} style={styles.requestCard}>
              <View style={{ flex: 1, gap: 4 }}>
                <NeonText variant="h2">{request.name || 'Anonymous'}</NeonText>
                {request.role ? (
                  <NeonText variant="label" tone="accent">{request.role}</NeonText>
                ) : null}
                {request.one_liner ? (
                  <NeonText variant="bodyMuted">{request.one_liner}</NeonText>
                ) : null}
              </View>
              {liveWindowEnded ? (
                <Pill label="SEALED" tone="neutral" />
              ) : (
                <View style={styles.requestActions}>
                  <GlowButton
                    label="✓"
                    onPress={() => handleApprove(request.participant_id)}
                    size="sm"
                    variant="primary"
                  />
                  <GlowButton
                    label="✕"
                    onPress={() => handleReject(request.participant_id)}
                    size="sm"
                    variant="ghost"
                  />
                </View>
              )}
            </Surface>
          ))
        )}
      </View>

      <View style={styles.section}>
        <GlowButton
          label={isFinalizing ? 'Finalizing…' : liveWindowEnded ? 'Seal outcomes & memory' : 'Finalize event'}
          onPress={handleEndEvent}
          disabled={isFinalizing}
          variant={liveWindowEnded ? 'primary' : 'ghost'}
          fullWidth
          style={liveWindowEnded ? undefined : styles.dangerBtn}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.void,
    paddingHorizontal: spacing.xl,
  },
  section: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  refreshGlyph: { fontSize: 16, lineHeight: 18 },
  errorBanner: {
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderColor: palette.danger,
    backgroundColor: palette.dangerSoft,
  },
  reflectionCard: {
    borderRadius: radii.xl,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  codeCard: { marginTop: spacing.md, borderRadius: radii.lg, gap: 4 },
  codeValue: { fontSize: 22, letterSpacing: 2, marginTop: 4 },
  secretPolicyText: { marginTop: spacing.sm, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  requestActions: { flexDirection: 'row', gap: spacing.sm },
  dangerBtn: {
    borderColor: palette.danger,
  },
  emptyCard: { width: '100%', borderRadius: radii.xl, gap: spacing.xs },
  escortBtn: {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: radii.md,
    alignItems: 'center',
  },
});