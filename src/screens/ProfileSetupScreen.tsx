// =============================================================================
// ProfileSetupScreen.tsx
// User profile setup after authentication
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { updateUserProfile } from '../services/user.service';

interface ProfileSetupScreenProps {
  userId: string;
  onComplete: () => void;
}

export default function ProfileSetupScreen({ userId, onComplete }: ProfileSetupScreenProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [oneLiner, setOneLiner] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name');
      return;
    }

    setIsSubmitting(true);
    try {
      console.log('[ProfileSetup] Updating profile for user:', userId);
      console.log('[ProfileSetup] Profile data:', {
        name: name.trim(),
        role: role.trim() || null,
        one_liner: oneLiner.trim() || null,
      });

      const updatedUser = await updateUserProfile(userId, {
        name: name.trim(),
        role: role.trim() || null,
        one_liner: oneLiner.trim() || null,
      });

      console.log('[ProfileSetup] Profile updated successfully:', updatedUser);
      console.log('[ProfileSetup] Calling onComplete callback');
      onComplete();
    } catch (error) {
      console.error('[ProfileSetup] Failed to update profile:', error);
      Alert.alert('Error', 'Failed to save profile. Please try again.');
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
          <Text style={styles.title}>Complete Your Profile</Text>
          <Text style={styles.subtitle}>
            Help others discover who you are at events
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Name <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor="#999"
              autoCapitalize="words"
              maxLength={50}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Role</Text>
            <TextInput
              style={styles.input}
              value={role}
              onChangeText={setRole}
              placeholder="e.g., Software Engineer, Designer"
              placeholderTextColor="#999"
              autoCapitalize="words"
              maxLength={50}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>One-liner</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={oneLiner}
              onChangeText={setOneLiner}
              placeholder="A brief description about yourself"
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
              maxLength={150}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Saving...' : 'Continue'}
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
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
