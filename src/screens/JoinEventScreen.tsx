// =============================================================================
// JoinEventScreen.tsx
// Join event screen with request-based joining and optional access code
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { getEventByCode } from '../services/event.service';
import {
  requestToJoinEvent,
  joinEventWithCode,
  getParticipantStatus,
} from '../services/participant.service';

interface JoinEventScreenProps {
  userId: string;
  onEventJoined: () => void;
}

export function JoinEventScreen({ userId, onEventJoined }: JoinEventScreenProps) {
  const [joinCode, setJoinCode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleJoinEvent = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Required', 'Please enter an event code');
      return;
    }

    setIsSubmitting(true);
    try {
      // First, get the event details
      const event = await getEventByCode(joinCode.trim());
      if (!event) {
        Alert.alert('Error', 'Event not found. Please check the code and try again.');
        return;
      }

      // Check if user already joined
      const existingStatus = await getParticipantStatus(event.id, userId);
      if (existingStatus) {
        if (existingStatus === 'approved') {
          Alert.alert('Already Joined', 'You have already joined this event.');
          onEventJoined();
        } else if (existingStatus === 'pending') {
          Alert.alert('Pending', 'Your join request is pending approval from the host.');
        } else if (existingStatus === 'rejected') {
          Alert.alert('Rejected', 'Your join request was rejected by the host.');
        }
        return;
      }

      // If access code provided, use it for auto-approval
      if (accessCode.trim()) {
        try {
          await joinEventWithCode(event.id, userId, accessCode.trim());
          Alert.alert('Success', 'You have joined the event!');
          onEventJoined();
        } catch (error) {
          Alert.alert('Invalid Code', 'The access code is incorrect. Try again or request to join.');
        }
        return;
      }

      // Otherwise, request to join
      console.log('[JoinEvent] Requesting to join event:', event.id);
      console.log('[JoinEvent] Requires approval:', event.requires_approval);

      await requestToJoinEvent(event.id, userId);

      if (event.requires_approval) {
        console.log('[JoinEvent] Join request sent, waiting for approval');
        Alert.alert(
          'Request Sent',
          'Your join request has been sent to the host. You will be notified when approved.',
          [
            {
              text: 'OK',
              onPress: () => {
                console.log('[JoinEvent] Calling onEventJoined for pending request');
                onEventJoined();
              }
            }
          ]
        );
      } else {
        console.log('[JoinEvent] Auto-approved, joining event');
        Alert.alert('Success', 'You have joined the event!', [
          {
            text: 'OK',
            onPress: () => {
              console.log('[JoinEvent] Calling onEventJoined for auto-approved');
              onEventJoined();
            }
          }
        ]);
      }
    } catch (error) {
      console.error('Failed to join event:', error);
      Alert.alert('Error', 'Failed to join event. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Join an Event</Text>
          <Text style={styles.subtitle}>
            Enter the event code provided by the host
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Event Code</Text>
            <TextInput
              style={styles.input}
              placeholder="ABC123"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholderTextColor="#999"
              maxLength={6}
              editable={!isSubmitting}
            />
          </View>

          {showAccessCode ? (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Access Code (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter access code"
                value={accessCode}
                onChangeText={(text) => setAccessCode(text.toUpperCase())}
                autoCapitalize="characters"
                placeholderTextColor="#999"
                editable={!isSubmitting}
              />
              <Text style={styles.hint}>
                Skip approval by using the host's access code
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.accessCodeLink}
              onPress={() => setShowAccessCode(true)}
            >
              <Text style={styles.accessCodeLinkText}>
                Have an access code? Click here
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.joinButton, isSubmitting && styles.joinButtonDisabled]}
            onPress={handleJoinEvent}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.joinButtonText}>Request to Join</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#999',
    lineHeight: 22,
  },
  form: {
    gap: 24,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#FFF',
    letterSpacing: 2,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#999',
  },
  accessCodeLink: {
    paddingVertical: 8,
  },
  accessCodeLinkText: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
  },
  joinButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
