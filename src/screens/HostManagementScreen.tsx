// =============================================================================
// HostManagementScreen.tsx
// Host management screen for managing active event and approving join requests
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import {
  getHostedEvent,
  updateEvent,
  deleteEvent,
  updateEventLocation,
} from '../services/event.service';
import {
  getPendingJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
} from '../services/participant.service';
import { watchLocation, getCurrentLocation } from '../services/location.service';
import type { EventRow, PendingJoinRequest } from '../types/database';
import type { LocationSubscription } from 'expo-location';

interface HostManagementScreenProps {
  userId: string;
  onEventEnded: () => void;
}

export default function HostManagementScreen({ userId, onEventEnded }: HostManagementScreenProps) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [requests, setRequests] = useState<PendingJoinRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<LocationSubscription | null>(null);

  useEffect(() => {
    loadEventData();
  }, [userId]);

  useEffect(() => {
    if (event?.location_type === 'live' && isBroadcasting) {
      startLocationBroadcast();
    } else {
      stopLocationBroadcast();
    }

    return () => {
      stopLocationBroadcast();
    };
  }, [isBroadcasting, event?.location_type]);

  const loadEventData = async () => {
    try {
      setIsLoading(true);
      console.log('[HostManagement] Loading event data for user:', userId);

      const hostedEvent = await getHostedEvent(userId);
      console.log('[HostManagement] Hosted event:', hostedEvent);
      setEvent(hostedEvent);

      if (hostedEvent) {
        console.log('[HostManagement] Fetching pending requests for event:', hostedEvent.id);
        const pendingRequests = await getPendingJoinRequests(hostedEvent.id);
        console.log('[HostManagement] Pending requests:', pendingRequests);
        console.log('[HostManagement] Number of pending requests:', pendingRequests.length);
        setRequests(pendingRequests);

        if (hostedEvent.location_type === 'live') {
          setIsBroadcasting(true);
        }
      }
    } catch (error) {
      console.error('[HostManagement] Failed to load event data:', error);
      Alert.alert('Error', 'Failed to load event data');
    } finally {
      setIsLoading(false);
    }
  };

  const startLocationBroadcast = async () => {
    if (!event) return;

    const subscription = await watchLocation(async (coords) => {
      try {
        await updateEventLocation(event.id, userId, coords.latitude, coords.longitude);
        console.log('Location updated:', coords);
      } catch (error) {
        console.error('Failed to update location:', error);
      }
    });

    setLocationSubscription(subscription);
  };

  const stopLocationBroadcast = () => {
    if (locationSubscription) {
      locationSubscription.remove();
      setLocationSubscription(null);
    }
  };

  const handleApprove = async (participantId: string) => {
    try {
      await approveJoinRequest(participantId);
      setRequests((prev) => prev.filter((r) => r.participant_id !== participantId));
      Alert.alert('Success', 'Join request approved');
    } catch (error) {
      console.error('Failed to approve request:', error);
      Alert.alert('Error', 'Failed to approve request');
    }
  };

  const handleReject = async (participantId: string) => {
    try {
      await rejectJoinRequest(participantId);
      setRequests((prev) => prev.filter((r) => r.participant_id !== participantId));
      Alert.alert('Success', 'Join request rejected');
    } catch (error) {
      console.error('Failed to reject request:', error);
      Alert.alert('Error', 'Failed to reject request');
    }
  };

  const handleEndEvent = () => {
    Alert.alert(
      'End Event',
      'Are you sure you want to end this event? This will delete the event and remove all participants.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Event',
          style: 'destructive',
          onPress: async () => {
            try {
              if (event) {
                await deleteEvent(event.id, userId);
                onEventEnded();
              }
            } catch (error) {
              console.error('Failed to end event:', error);
              Alert.alert('Error', 'Failed to end event');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No active event</Text>
        <Text style={styles.emptySubtext}>Create an event to get started</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerInfo}>
            <Text style={styles.title}>{event.name}</Text>
            <Text style={styles.joinCode}>Join Code: {event.join_code}</Text>
            {event.access_code && (
              <Text style={styles.accessCode}>Access Code: {event.access_code}</Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={loadEventData}
          >
            <Text style={styles.refreshButtonText}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>

      {event.location_type === 'live' && (
        <View style={styles.broadcastSection}>
          <View style={styles.broadcastHeader}>
            <View>
              <Text style={styles.sectionTitle}>Location Broadcasting</Text>
              <Text style={styles.broadcastStatus}>
                {isBroadcasting ? '🟢 Active' : '⚪ Paused'}
              </Text>
            </View>
            <Switch
              value={isBroadcasting}
              onValueChange={setIsBroadcasting}
              trackColor={{ false: '#333', true: '#00CC00' }}
              thumbColor="#FFF"
            />
          </View>
        </View>
      )}

      {requests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Pending Requests ({requests.length})
          </Text>
          {requests.map((request) => (
            <View key={request.participant_id} style={styles.requestCard}>
              <View style={styles.requestInfo}>
                <Text style={styles.requestName}>
                  {request.name || 'Anonymous'}
                </Text>
                {request.role && (
                  <Text style={styles.requestRole}>{request.role}</Text>
                )}
                {request.one_liner && (
                  <Text style={styles.requestOneLiner}>{request.one_liner}</Text>
                )}
              </View>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={styles.approveButton}
                  onPress={() => handleApprove(request.participant_id)}
                >
                  <Text style={styles.approveButtonText}>✓</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rejectButton}
                  onPress={() => handleReject(request.participant_id)}
                >
                  <Text style={styles.rejectButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <TouchableOpacity style={styles.endButton} onPress={handleEndEvent}>
          <Text style={styles.endButtonText}>End Event</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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
  },
  header: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 12,
  },
  joinCode: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 4,
  },
  accessCode: {
    fontSize: 14,
    color: '#999',
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerInfo: {
    flex: 1,
  },
  refreshButton: {
    padding: 8,
    marginLeft: 12,
  },
  refreshButtonText: {
    fontSize: 24,
  },
  broadcastSection: {
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  broadcastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  broadcastStatus: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  section: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 16,
  },
  requestCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  requestInfo: {
    flex: 1,
    marginRight: 12,
  },
  requestName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  requestRole: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 4,
  },
  requestOneLiner: {
    fontSize: 14,
    color: '#999',
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approveButton: {
    backgroundColor: '#00CC00',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  approveButtonText: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: '700',
  },
  rejectButton: {
    backgroundColor: '#FF4444',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButtonText: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: '700',
  },
  endButton: {
    backgroundColor: '#FF4444',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  endButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
