// =============================================================================
// MapScreen.tsx
// Map view showing events user has joined
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { getUserEvents, getParticipantCount } from '../services/event.service';
import { getCurrentLocation } from '../services/location.service';
import type { EventRow } from '../types/database';

interface MapScreenProps {
  userId: string;
  onEventPress?: (event: EventRow) => void;
}

export default function MapScreen({ userId, onEventPress }: MapScreenProps) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    loadEvents();
    loadUserLocation();
  }, [userId]);

  const loadUserLocation = async () => {
    const location = await getCurrentLocation();
    if (location) {
      setUserLocation(location);
    }
  };

  const loadEvents = async () => {
    try {
      setIsLoading(true);
      const fetchedEvents = await getUserEvents(userId);
      setEvents(fetchedEvents);

      // Load participant counts for events that show count
      const counts: Record<string, number> = {};
      await Promise.all(
        fetchedEvents
          .filter((e) => e.show_participant_count)
          .map(async (event) => {
            const count = await getParticipantCount(event.id);
            counts[event.id] = count;
          })
      );
      setParticipantCounts(counts);
    } catch (error) {
      console.error('Failed to load events:', error);
      Alert.alert('Error', 'Failed to load events');
    } finally {
      setIsLoading(false);
    }
  };

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
      return {
        ...userLocation,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }

    // Default to San Francisco
    return {
      latitude: 37.78825,
      longitude: -122.4324,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    };
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No events found</Text>
        <Text style={styles.emptySubtext}>
          Join an event to see it on the map
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={getInitialRegion()}
        showsUserLocation
        showsMyLocationButton
      >
        {events.map((event) => {
          if (!event.latitude || !event.longitude) return null;

          return (
            <Marker
              key={event.id}
              coordinate={{
                latitude: event.latitude,
                longitude: event.longitude,
              }}
              title={event.name}
              description={event.description || undefined}
              onCalloutPress={() => onEventPress?.(event)}
            >
              <View style={styles.markerContainer}>
                <View style={styles.marker}>
                  <Text style={styles.markerText}>📍</Text>
                </View>
                {event.show_participant_count && participantCounts[event.id] !== undefined && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{participantCounts[event.id]}</Text>
                  </View>
                )}
              </View>
            </Marker>
          );
        })}
      </MapView>

      <TouchableOpacity style={styles.refreshButton} onPress={loadEvents}>
        <Text style={styles.refreshText}>🔄</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#000',
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  markerContainer: {
    alignItems: 'center',
  },
  marker: {
    backgroundColor: '#007AFF',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  markerText: {
    fontSize: 20,
  },
  countBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  countText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  refreshButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#FFF',
    borderRadius: 24,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  refreshText: {
    fontSize: 24,
  },
});
