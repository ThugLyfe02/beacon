// =============================================================================
// CreateEventScreen.tsx
// Event creation screen for hosts
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { createEvent } from '../services/event.service';
import { getCurrentLocation, geocodeAddress } from '../services/location.service';
import type { LocationType } from '../types/database';

interface CreateEventScreenProps {
  userId: string;
  onEventCreated: (eventId: string) => void;
  onCancel: () => void;
}

export default function CreateEventScreen({
  userId,
  onEventCreated,
  onCancel,
}: CreateEventScreenProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('live');
  const [address, setAddress] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [accessCode, setAccessCode] = useState('');
  const [showParticipantCount, setShowParticipantCount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCreateEvent = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter an event name');
      return;
    }

    if (locationType === 'fixed' && !address.trim()) {
      Alert.alert('Required', 'Please enter an address for fixed location');
      return;
    }

    setIsSubmitting(true);
    try {
      let latitude: number | undefined;
      let longitude: number | undefined;

      if (locationType === 'live') {
        // Get current location
        const currentLocation = await getCurrentLocation();
        if (!currentLocation) {
          Alert.alert('Error', 'Failed to get current location. Please enable location services.');
          setIsSubmitting(false);
          return;
        }
        latitude = currentLocation.latitude;
        longitude = currentLocation.longitude;
      } else if (locationType === 'fixed' && address.trim()) {
        // Geocode address
        const coords = await geocodeAddress(address.trim());
        if (!coords) {
          Alert.alert('Error', 'Could not find the address. Please enter a valid address.');
          setIsSubmitting(false);
          return;
        }
        latitude = coords.latitude;
        longitude = coords.longitude;
      }

      const event = await createEvent(userId, {
        name: name.trim(),
        description: description.trim() || undefined,
        location_type: locationType,
        latitude,
        longitude,
        address: locationType === 'fixed' ? address.trim() : undefined,
        requires_approval: requiresApproval,
        access_code: accessCode.trim() || undefined,
        show_participant_count: showParticipantCount,
      });

      Alert.alert('Success', `Event created! Join code: ${event.join_code}`);
      onEventCreated(event.id);
    } catch (error) {
      console.error('Failed to create event:', error);
      Alert.alert('Error', 'Failed to create event. Please try again.');
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
          <Text style={styles.title}>Create Event</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Event Name <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g., Tech Meetup"
              placeholderTextColor="#999"
              maxLength={100}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="What's this event about?"
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
              maxLength={500}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Location Type</Text>
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  locationType === 'live' && styles.optionButtonActive,
                ]}
                onPress={() => setLocationType('live')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    locationType === 'live' && styles.optionButtonTextActive,
                  ]}
                >
                  📍 Live (Broadcast my location)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.optionButton,
                  locationType === 'fixed' && styles.optionButtonActive,
                ]}
                onPress={() => setLocationType('fixed')}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    locationType === 'fixed' && styles.optionButtonTextActive,
                  ]}
                >
                  📌 Fixed Address
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {locationType === 'fixed' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Address <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={address}
                onChangeText={setAddress}
                placeholder="123 Main St, City, State"
                placeholderTextColor="#999"
                maxLength={200}
              />
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Require Approval</Text>
              <Text style={styles.settingDescription}>
                Approve join requests manually
              </Text>
            </View>
            <Switch
              value={requiresApproval}
              onValueChange={setRequiresApproval}
              trackColor={{ false: '#333', true: '#007AFF' }}
              thumbColor="#FFF"
            />
          </View>

          {requiresApproval && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Access Code (Optional)
              </Text>
              <TextInput
                style={styles.input}
                value={accessCode}
                onChangeText={(text) => setAccessCode(text.toUpperCase())}
                placeholder="Optional bypass code"
                placeholderTextColor="#999"
                autoCapitalize="characters"
                maxLength={20}
              />
              <Text style={styles.hint}>
                Users with this code can join without approval
              </Text>
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Show Participant Count</Text>
              <Text style={styles.settingDescription}>
                Display how many people joined
              </Text>
            </View>
            <Switch
              value={showParticipantCount}
              onValueChange={setShowParticipantCount}
              trackColor={{ false: '#333', true: '#007AFF' }}
              thumbColor="#FFF"
            />
          </View>

          <TouchableOpacity
            style={[styles.createButton, isSubmitting && styles.createButtonDisabled]}
            onPress={handleCreateEvent}
            disabled={isSubmitting}
          >
            <Text style={styles.createButtonText}>
              {isSubmitting ? 'Creating...' : 'Create Event'}
            </Text>
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
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
  },
  cancelText: {
    fontSize: 16,
    color: '#007AFF',
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
  required: {
    color: '#FF4444',
  },
  input: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFF',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: -4,
  },
  buttonGroup: {
    gap: 12,
  },
  optionButton: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionButtonActive: {
    backgroundColor: '#007AFF20',
    borderColor: '#007AFF',
  },
  optionButtonText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  optionButtonTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#999',
  },
  createButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
