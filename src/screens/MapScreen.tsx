import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type MapStyleElement } from 'react-native-maps';
import type { NavigationProp } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getParticipantCount, getUserEvents } from '../services/event.service';
import { getMyPendingRequests } from '../services/participant.service';
import { getCurrentLocation, watchLocation } from '../services/location.service';
import { getNearbyPremium, pushMyLocation } from '../services/premium.service';
import { usePremium } from '../hooks/usePremium';
import { DARK_MAP_STYLE } from '../lib/mapStyle';
import {
  BeaconMarker,
  GlowButton,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  PremiumBadge,
  PremiumDrawer,
  Surface,
} from '../components/ui';
import { glow, palette, radii, spacing } from '../theme';
import type { EventRow, NearbyPremiumUser } from '../types/database';
import type { LocationSubscription } from 'expo-location';

interface MapScreenProps {
  userId: string;
  onEventPress?: (event: EventRow) => void;
}

type PendingRequest = {
  participant_id: string;
  event_id: string;
  event_name: string;
  joined_at: string;
};

type Coordinates = { latitude: number; longitude: number };

const MAP_STYLE: MapStyleElement[] = DARK_MAP_STYLE.map((entry) => ({
  ...entry,
  stylers: entry.stylers.map((styler) => ({ ...styler })),
})) as MapStyleElement[];

export default function MapScreen({ userId, onEventPress }: Readonly<MapScreenProps>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [nearbyPremium, setNearbyPremium] = useState<NearbyPremiumUser[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const premium = usePremium(userId);
  const watcherRef = useRef<LocationSubscription | null>(null);

  const loadEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedEvents, pending] = await Promise.all([
        getUserEvents(userId),
        getMyPendingRequests(),
      ]);
      setEvents(fetchedEvents);
      setPendingRequests(pending);

      const countPairs = await Promise.all(
        fetchedEvents
          .filter((event) => event.show_participant_count)
          .map(async (event) => [event.id, await getParticipantCount(event.id)] as const),
      );
      setParticipantCounts(Object.fromEntries(countPairs));
    } catch (error) {
      console.error('[MapScreen] loadEvents:', error);
      Alert.alert('Signal lost', 'Could not load events.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    loadEvents();
  }, [loadEvents]));

  const publishLocation = useCallback((coords: Coordinates) => {
    setUserLocation(coords);
    pushMyLocation(userId, coords.latitude, coords.longitude).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    getCurrentLocation().then((location) => {
      if (location) publishLocation(location);
    });
  }, [publishLocation]);

  useEffect(() => {
    let active = true;
    watchLocation((coords) => {
      if (active) publishLocation(coords);
    }).then((subscription) => {
      if (!active) subscription?.remove();
      else watcherRef.current = subscription;
    });

    return () => {
      active = false;
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [publishLocation]);

  const eventId = events[0]?.id ?? null;
  useEffect(() => {
    if (!eventId || !premium.isPremium) {
      setNearbyPremium([]);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      const peers = await getNearbyPremium(eventId);
      if (!cancelled) setNearbyPremium(peers);
    };
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId, premium.isPremium]);

  const initialRegion = (() => {
    const locatedEvent = events.find((event) => event.latitude != null && event.longitude != null);
    if (locatedEvent?.latitude != null && locatedEvent.longitude != null) {
      return {
        latitude: locatedEvent.latitude,
        longitude: locatedEvent.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (userLocation) return { ...userLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    return { latitude: 37.78825, longitude: -122.4324, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  })();

  function openRadar() {
    if (!premium.isPremium) {
      setDrawerOpen(true);
      return;
    }
    if (!eventId) {
      Alert.alert('No event', 'Join an event before opening the radar.');
      return;
    }
    navigation.navigate('Radar', { eventId });
  }

  if (isLoading) {
    return (
      <View style={styles.fullCentered}>
        <GridBackground />
        <Loader size={64} />
        <NeonText variant="label" tone="accent" style={styles.loadingLabel}>Triangulating</NeonText>
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <GridBackground />
        {pendingRequests.length > 0 ? (
          <Surface elevated padded glow style={styles.pendingCard}>
            <Pill label={`${pendingRequests.length} pending`} tone="accent" dot />
            <NeonText variant="h1" style={styles.cardTitle}>Awaiting approval</NeonText>
            <NeonText variant="bodyMuted" style={styles.cardCopy}>
              Your request for {pendingRequests[0].event_name} is waiting for the host.
            </NeonText>
            <GlowButton label="Refresh" onPress={loadEvents} variant="secondary" fullWidth size="sm" style={styles.cardButton} />
          </Surface>
        ) : null}

        <Surface elevated padded glow style={styles.emptyCard}>
          <Pill label="No active signals" tone="neutral" dot />
          <NeonText variant="h1" style={styles.cardTitle}>The room is quiet.</NeonText>
          <NeonText variant="bodyMuted" style={styles.cardCopy}>
            Join an event with a code, or light your own beacon.
          </NeonText>
          <GlowButton label="Join with a code" onPress={() => navigation.navigate('JoinEvent')} variant="secondary" fullWidth size="md" />
          <GlowButton label="Light a beacon" onPress={() => navigation.navigate('CreateEvent')} variant="primary" fullWidth size="md" style={styles.cardButton} />
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        customMapStyle={MAP_STYLE}
        userInterfaceStyle={Platform.OS === 'ios' ? 'dark' : undefined}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
      >
        {events.map((event) => {
          if (event.latitude == null || event.longitude == null) return null;
          return (
            <Marker
              key={event.id}
              coordinate={{ latitude: event.latitude, longitude: event.longitude }}
              title={event.name}
              description={event.description || 'Tap to open channel'}
              onCalloutPress={() => {
                onEventPress?.(event);
                navigation.navigate('EventFeed', { eventId: event.id, eventName: event.name });
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <BeaconMarker count={event.show_participant_count ? participantCounts[event.id] : undefined} />
            </Marker>
          );
        })}

        {nearbyPremium.map((peer) => (
          <Marker
            key={`premium-${peer.user_id}`}
            coordinate={{ latitude: peer.latitude, longitude: peer.longitude }}
            title={peer.name || 'Premium signal'}
            description={peer.role || undefined}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <BeaconMarker premium />
          </Marker>
        ))}
      </MapView>

      <View pointerEvents="box-none" style={styles.hudTop}>
        <Surface style={styles.hudBar}>
          <View style={styles.hudCluster}>
            <Pill label="Live · scanning" tone="accent" dot />
            <NeonText variant="label" tone="muted">
              {events.length} signal{events.length === 1 ? '' : 's'}
              {premium.isPremium && nearbyPremium.length > 0 ? ` · ${nearbyPremium.length} ✦` : ''}
            </NeonText>
          </View>
          <Pressable onPress={loadEvents} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <NeonText variant="h2" tone="accent" glow>↻</NeonText>
          </Pressable>
        </Surface>
      </View>

      <View pointerEvents="box-none" style={styles.hudBottom}>
        <Pressable onPress={() => setDrawerOpen(true)} style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}>
          {premium.isPremium
            ? <PremiumBadge size="md" label={premium.isDiscoverable ? 'PREMIUM · LIVE' : 'PREMIUM'} />
            : <Pill label="Go Premium ✦" tone="premium" />}
        </Pressable>

        <Pressable onPress={openRadar} style={({ pressed }) => [styles.radarButton, premium.isPremium && styles.radarActive, pressed && styles.pressed]}>
          <NeonText variant="h2" tone={premium.isPremium ? 'premium' : 'muted'} glow={premium.isPremium} style={styles.radarGlyph}>◎</NeonText>
          <NeonText variant="label" tone={premium.isPremium ? 'premium' : 'dim'} style={styles.radarLabel}>RADAR</NeonText>
        </Pressable>
      </View>

      <View pointerEvents="none" style={styles.scanline} />
      <PremiumDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isPremium={premium.isPremium}
        isDiscoverable={premium.isDiscoverable}
        premiumSince={premium.premiumSince}
        onTogglePremiumDev={premium.togglePremiumDev}
        onToggleDiscoverable={premium.setDiscoverable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  map: { flex: 1 },
  fullCentered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.void },
  loadingLabel: { marginTop: spacing.lg },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: palette.void },
  pendingCard: { width: '100%', marginBottom: spacing.lg, borderRadius: radii.xl },
  emptyCard: { width: '100%', borderRadius: radii.xl },
  cardTitle: { marginTop: spacing.md },
  cardCopy: { marginTop: spacing.sm, marginBottom: spacing.lg },
  cardButton: { marginTop: spacing.sm },
  hudTop: { position: 'absolute', top: spacing.lg, left: spacing.lg, right: spacing.lg },
  hudBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, ...glow.accentSoft },
  hudCluster: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft, borderWidth: 1, borderColor: palette.accent },
  hudBottom: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusButton: { paddingVertical: spacing.xs },
  radarButton: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.hairlineStrong },
  radarActive: { borderColor: palette.premium, backgroundColor: palette.premiumSoft, ...glow.premium },
  radarGlyph: { fontSize: 20 },
  radarLabel: { fontSize: 9 },
  pressed: { opacity: 0.82 },
  scanline: { position: 'absolute', left: 0, right: 0, top: '40%', height: 1, backgroundColor: palette.accent, opacity: 0.18 },
});
