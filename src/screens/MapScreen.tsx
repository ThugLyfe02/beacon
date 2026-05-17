import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { getUserEvents, getParticipantCount } from '../services/event.service';
import { getCurrentLocation } from '../services/location.service';
import { DARK_MAP_STYLE } from '../lib/mapStyle';
import {
  BeaconMarker,
  GridBackground,
  Loader,
  NeonText,
  Pill,
  Surface,
} from '../components/ui';
import { glow, palette, radii, spacing } from '../theme';
import type { EventRow } from '../types/database';

interface MapScreenProps {
  userId: string;
  onEventPress?: (event: EventRow) => void;
}

export default function MapScreen({ userId, onEventPress }: Readonly<MapScreenProps>) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});

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
    loadEvents();
    (async () => {
      const location = await getCurrentLocation();
      if (location) setUserLocation(location);
    })();
  }, [loadEvents]);

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
          <NeonText variant="bodyMuted" style={{ marginTop: spacing.sm }}>
            Join an event with a code, or light your own beacon to see it pulse on the map.
          </NeonText>
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
              description={event.description || undefined}
              onCalloutPress={() => onEventPress?.(event)}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <BeaconMarker
                count={event.show_participant_count ? participantCounts[event.id] : undefined}
              />
            </Marker>
          );
        })}
      </MapView>

      <View pointerEvents="box-none" style={styles.hudTop}>
        <Surface style={styles.hudBar}>
          <View style={styles.hudCluster}>
            <Pill label="Live · scanning" tone="accent" dot />
            <NeonText variant="label" tone="muted">
              {events.length} signal{events.length === 1 ? '' : 's'}
            </NeonText>
          </View>
          <Pressable onPress={loadEvents} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}>
            <NeonText variant="h2" tone="accent" glow>↻</NeonText>
          </Pressable>
        </Surface>
      </View>

      <View pointerEvents="none" style={styles.scanline} />
      <View pointerEvents="none" style={styles.vignette} />
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
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '40%',
    height: 1,
    backgroundColor: palette.accent,
    opacity: 0.18,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderColor: 'rgba(0,0,0,0.4)',
    borderWidth: 24,
  },
});
