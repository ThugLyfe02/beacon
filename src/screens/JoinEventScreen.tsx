// =============================================================================
// Beacon MVP — Join Event Screen
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
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useEvent } from '../hooks/useEvent';

interface JoinEventScreenProps {
  onEventJoined: () => void;
}

export function JoinEventScreen({ onEventJoined }: JoinEventScreenProps) {
  const { user } = useAuth();
  const { joinEventByCode, loading } = useEvent();
  const [joinCode, setJoinCode] = useState('');

  const handleJoinEvent = async () => {
    console.log('[JoinEventScreen] handleJoinEvent called');
    console.log('[JoinEventScreen] user:', user?.id);
    console.log('[JoinEventScreen] joinCode:', joinCode);

    if (!user) {
      Alert.alert('Error', 'You must be logged in to join an event');
      return;
    }

    if (!joinCode.trim()) {
      Alert.alert('Error', 'Please enter an event code');
      return;
    }

    console.log('[JoinEventScreen] Calling joinEventByCode...');
    const { data, error } = await joinEventByCode(joinCode, user.id);
    console.log('[JoinEventScreen] Result:', { data, error });

    if (error) {
      Alert.alert('Error', error);
      return;
    }

    if (data) {
      console.log('[JoinEventScreen] Success! Event joined:', data);
      onEventJoined();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join an Event</Text>
      <Text style={styles.instruction}>
        Enter the event code provided by the organizer
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Event Code (e.g. ABC123)"
        value={joinCode}
        onChangeText={(text) => setJoinCode(text.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleJoinEvent}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Join Event</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  instruction: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#000',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
