import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import type { NavigationProp } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getUserEvents, getParticipantCount } from '../services/event.service';
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

export default function MapScreen({ userId, onEventPress }: Readonly<MapScreenProps>) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [nearbyPremium, setNearbyPremium] = useState<NearbyPremiumUser[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const premium = usePremium(userId);
  const watcherRef = useRef<LocationSubscription | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      const fetchedEvents = await getUserEvents(userId);
      setEvents(fetchedEvents);
      const counts: Record<string, number> = {};
      await Promise.all(
        fetchedEvents
          .filter((e) => e.show_participant_count)
          .map(async (event) => {
            counts[event.id] = await getParticipantCount(event.id);
          })
      );
      setParticipantCounts(counts);
    } catch (error) {
      console.error('Failed to load events:', error);
      Alert.alert('Signal lost', 'Could not load events.');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    (async () => {
      const location = await getCurrentLocation();
      if (location) {
        setUserLocation(location);
        pushMyLocation(userId, location.latitude, location.longitude).catch(() => {});
      }
    })();
  }, [userId]);

  // Reload events whenever the Map tab regains focus (after JoinEvent/CreateEvent modals)
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  // Stream location → DB so other premium users can see us
  const handleLocationFix = useCallback(
    (coords: { latitude: number; longitude: number }) => {
      setUserLocation(coords);
      pushMyLocation(userId, coords.latitude, coords.longitude).catch(() => {});
    },
    [userId]
  );

  useEffect(() => {
    let active = true;
    const start = async () => {
      const sub = await watchLocation((coords) => {
        if (active) handleLocationFix(coords);
      });
      if (sub && active) watcherRef.current = sub;
      else sub?.remove();
    };
    start();
    return () => {
      active = false;
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [handleLocationFix]);

  // Poll nearby premium for the first event the user has joined
  const eventId = events[0]?.id ?? null;
  useEffect(() => {
    if (!eventId || !premium.isPremium) {
      setNearbyPremium([]);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const peers = await getNearbyPremium(eventId);
      if (!cancelled) setNearbyPremium(peers);
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [eventId, premium.isPremium]);

  const getInitialRegion = () => {
    if (events.length > 0 && events[0].latitude && events[0].longitude) {
      return {
        latitude: events[0].latitude,
        longitude: events[0].longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    if (userLocation) {
      return { ...userLocation, latitudeDelta: 0.05, longitudeDelta: 0.05 };
    }
    return { latitude: 37.78825, longitude: -122.4324, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  };

  const openRadar = () => {
    if (!premium.isPremium) {
      setDrawerOpen(true);
      return;
    }
    if (!eventId) {
      Alert.alert('No event', 'Join an event before opening the radar.');
      return;
    }
    navigation.navigate('Radar', { eventId });
  };

  if (isLoading) {
    return (
      <View style={styles.fullCentered}>
        <GridBackground />
        <Loader size={64} />
        <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
          Triangulating
        </NeonText>
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <GridBackground />
        <Surface elevated padded glow style={styles.emptyCard}>
          <Pill label="No active signals" tone="neutral" dot />
          <NeonText variant="h1" tone="text" style={{ marginTop: spacing.md }}>
            The room is quiet.
          </NeonText>
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm, marginBottom: spacing.lg }}>
            Join an event with a code, or light your own beacon to see it pulse on the map.
          </NeonText>
          <GlowButton
            label="Join with a code"
            onPress={() => navigation.navigate('JoinEvent')}
            variant="secondary"
            fullWidth
            size="md"
          />
          <GlowButton
            label="Light a beacon"
            onPress={() => navigation.navigate('CreateEvent')}
            variant="primary"
            fullWidth
            size="md"
            style={{ marginTop: spacing.sm }}
          />
        </Surface>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={getInitialRegion()}
        customMapStyle={DARK_MAP_STYLE as unknown as object[]}
        userInterfaceStyle={Platform.OS === 'ios' ? 'dark' : undefined}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsBuildings={false}
        showsTraffic={false}
      >
        {events.map((event) => {
          if (!event.latitude || !event.longitude) return null;
          return (
            <Marker
              key={event.id}
              coordinate={{ latitude: event.latitude, longitude: event.longitude }}
              title={event.name}
              description={event.description || 'Tap to open channel'}
              onCalloutPress={() => {
                onEventPress?.(event);
                navigation.navigate('EventFeed', {
                  eventId: event.id,
                  eventName: event.name,
                });
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <BeaconMarker
                count={event.show_participant_count ? participantCounts[event.id] : undefined}
              />
            </Marker>
          );
        })}

        {nearbyPremium.map((peer) => (
          <Marker
            key={`prem-${peer.user_id}`}
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
              {premium.isPremium && nearbyPremium.length > 0
                ? ` · ${nearbyPremium.length} ✦`
                : ''}
            </NeonText>
          </View>
          <Pressable onPress={loadEvents} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
            <NeonText variant="h2" tone="accent" glow>↻</NeonText>
          </Pressable>
        </Surface>
      </View>

      <View pointerEvents="box-none" style={styles.hudBottom}>
        <Pressable
          onPress={() => setDrawerOpen(true)}
          style={({ pressed }) => [styles.statusPill, pressed && { opacity: 0.85 }]}
        >
          {premium.isPremium ? (
            <PremiumBadge size="md" label={premium.isDiscoverable ? 'PREMIUM · LIVE' : 'PREMIUM'} />
          ) : (
            <Pill label="Go Premium ✦" tone="premium" />
          )}
        </Pressable>

        <Pressable
          onPress={openRadar}
          style={({ pressed }) => [
            styles.radarBtn,
            premium.isPremium && styles.radarBtnActive,
            pressed && { opacity: 0.85 },
          ]}
        >
          <NeonText
            variant="h2"
            tone={premium.isPremium ? 'premium' : 'muted'}
            glow={premium.isPremium}
            style={{ fontSize: 20 }}
          >
            ◎
          </NeonText>
          <NeonText
            variant="label"
            tone={premium.isPremium ? 'premium' : 'dim'}
            style={{ fontSize: 9 }}
          >
            RADAR
          </NeonText>
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
  fullCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.void,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: palette.void,
  },
  emptyCard: { width: '100%', borderRadius: radii.xl, gap: spacing.xs },
  hudTop: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  hudBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    ...glow.accentSoft,
  },
  hudCluster: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  hudBottom: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusPill: {
    paddingVertical: spacing.xs,
  },
  radarBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairlineStrong,
  },
  radarBtnActive: {
    borderColor: palette.premium,
    backgroundColor: 'rgba(255,210,74,0.08)',
    ...glow.premium,
  },
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '40%',
    height: 1,
    backgroundColor: palette.accent,
    opacity: 0.18,
  },
});
