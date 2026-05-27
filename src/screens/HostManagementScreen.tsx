import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getHostedEvent,
  deleteEvent,
  updateEventLocation,
} from '../services/event.service';
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

export default function HostManagementScreen({
  userId,
  onEventEnded,
}: Readonly<HostManagementScreenProps>) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<LocationSubscription | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEventData = useCallback(
    async (opts: { showAlert?: boolean } = {}) => {
      const { showAlert = false } = opts;
      setIsLoading(true);

      // Step 1: hosted event lookup
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
        setLoadError(null);
        setIsLoading(false);
        return;
      }

      // Step 2: pending requests
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

      if (hostedEvent.location_type === 'live') setIsBroadcasting(true);
      setIsLoading(false);
    },
    [userId]
  );

  // Initial mount — show alert if first load fails so the user sees the cause.
  useEffect(() => {
    loadEventData({ showAlert: true });
  }, [loadEventData]);

  // Refresh whenever the Host tab regains focus. Silent — don't spam alerts.
  useFocusEffect(
    useCallback(() => {
      loadEventData({ showAlert: false });
    }, [loadEventData])
  );

  // Auto-poll every 10s while the screen is mounted. Silent on errors.
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
    if (event?.location_type === 'live' && isBroadcasting) {
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
  }, [isBroadcasting, event?.location_type, event?.id, userId]);

  const handleApprove = async (participantId: string) => {
    try {
      await approveJoinRequest(participantId);
      setRequests((prev) => prev.filter((r) => r.participant_id !== participantId));
    } catch (error) {
      console.error('Failed to approve request:', error);
      const msg = error instanceof Error ? error.message : 'Could not approve.';
      Alert.alert('Approve failed', msg);
    }
  };

  const handleReject = async (participantId: string) => {
    try {
      await rejectJoinRequest(participantId);
      setRequests((prev) => prev.filter((r) => r.participant_id !== participantId));
    } catch (error) {
      console.error('Failed to reject request:', error);
      const msg = error instanceof Error ? error.message : 'Could not reject.';
      Alert.alert('Reject failed', msg);
    }
  };

  const handleEndEvent = () => {
    Alert.alert(
      'End beacon?',
      'This deletes the event and removes everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End event',
          style: 'destructive',
          onPress: async () => {
            try {
              if (event) {
                await deleteEvent(event.id, userId);
                onEventEnded();
              }
            } catch (error) {
              console.error('Failed to end event:', error);
              Alert.alert('Action failed', 'Could not end event.');
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
          <Pill label="No active event" tone="neutral" dot />
          <NeonText variant="h1" style={{ marginTop: spacing.md }}>Dark room.</NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Create an event to start broadcasting.
          </NeonText>
        </Surface>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      <GridBackground intensity={0.4} />
      <View style={styles.section}>
        <Pill label="Live · hosting" tone="accent" dot />
        <NeonText variant="display" tone="text" glow style={{ marginTop: spacing.sm }}>
          {event.name}
        </NeonText>
        <View style={styles.codeRow}>
          <Surface padded style={styles.codeCard}>
            <NeonText variant="label" tone="muted">JOIN CODE</NeonText>
            <NeonText variant="mono" tone="accent" glow style={styles.codeValue}>
              {event.join_code}
            </NeonText>
          </Surface>
          {event.access_code ? (
            <Surface padded style={styles.codeCard}>
              <NeonText variant="label" tone="muted">ACCESS</NeonText>
              <NeonText variant="mono" tone="text" style={styles.codeValue}>
                {event.access_code}
              </NeonText>
            </Surface>
          ) : null}
        </View>
      </View>

      {event.location_type === 'live' ? (
        <View style={styles.section}>
          <Surface elevated padded style={styles.row}>
            <View>
              <NeonText variant="h2">Live location</NeonText>
              <NeonText variant="label" tone={isBroadcasting ? 'success' : 'muted'} style={{ marginTop: 4 }}>
                {isBroadcasting ? '● BROADCASTING' : '○ PAUSED'}
              </NeonText>
            </View>
            <Switch
              value={isBroadcasting}
              onValueChange={setIsBroadcasting}
              trackColor={{ false: palette.hairlineStrong, true: palette.accentDim }}
              thumbColor={isBroadcasting ? palette.accent : palette.textMuted}
              ios_backgroundColor={palette.hairlineStrong}
            />
          </Surface>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <NeonText variant="label" tone="accent">PENDING REQUESTS</NeonText>
          <View style={styles.sectionHeaderRight}>
            <Pill label={`${requests.length}`} tone={requests.length ? 'accent' : 'neutral'} />
            <Pressable
              onPress={() => loadEventData({ showAlert: true })}
              hitSlop={12}
              style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}
              accessibilityLabel="Refresh pending requests"
            >
              <NeonText variant="h2" tone="accent" glow style={styles.refreshGlyph}>↻</NeonText>
            </Pressable>
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
            <NeonText variant="bodyMuted">No requests right now.</NeonText>
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
            </Surface>
          ))
        )}
      </View>

      <View style={styles.section}>
        <GlowButton
          label="End event"
          onPress={handleEndEvent}
          variant="ghost"
          fullWidth
          style={styles.dangerBtn}
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
    backgroundColor: 'rgba(255,77,106,0.08)',
  },
  codeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  codeCard: { flex: 1, borderRadius: radii.lg, gap: 4 },
  codeValue: { fontSize: 22, letterSpacing: 2, marginTop: 4 },
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
});
