// =============================================================================
// EventGatewayScreen.tsx
// Gateway screen - user chooses to join or create an event
// =============================================================================

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';

interface EventGatewayScreenProps {
  onJoinEvent: () => void;
  onCreateEvent: () => void;
}

export default function EventGatewayScreen({
  onJoinEvent,
  onCreateEvent,
}: EventGatewayScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Welcome to Beacon</Text>
        <Text style={styles.subtitle}>
          Discover and broadcast events around you
        </Text>
      </View>

      <View style={styles.options}>
        <TouchableOpacity style={styles.optionCard} onPress={onJoinEvent}>
          <Text style={styles.optionIcon}>🔍</Text>
          <Text style={styles.optionTitle}>Join Event</Text>
          <Text style={styles.optionDescription}>
            Have an event code? Join an existing event
          </Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.optionCard} onPress={onCreateEvent}>
          <Text style={styles.optionIcon}>📍</Text>
          <Text style={styles.optionTitle}>Create Event</Text>
          <Text style={styles.optionDescription}>
            Host your own event and invite others
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    lineHeight: 22,
  },
  options: {
    gap: 20,
  },
  optionCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  optionIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  optionTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 8,
  },
  optionDescription: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  dividerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
});
