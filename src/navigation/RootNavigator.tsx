import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { useEvent } from '../hooks/useEvent';

import { OtpScreen } from '../screens/OtpScreen';
import { JoinEventScreen } from '../screens/JoinEventScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { MatchesScreen } from '../screens/MatchesScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function EventTabs() {
  const { clearEvent } = useEvent();

  return (
    <Tab.Navigator
      screenOptions={{
        headerRight: () => (
          <TouchableOpacity style={styles.headerButton} onPress={clearEvent}>
            <Text style={styles.headerButtonText}>Leave Event</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Matches" component={MatchesScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading: authLoading } = useAuth();
  const { activeEvent } = useEvent();

  console.log('[RootNavigator] Render:', { user: user?.id, authLoading, activeEvent });

  if (authLoading) {
    console.log('[RootNavigator] Showing loading screen');
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    console.log('[RootNavigator] No user, showing OTP screen');
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Otp" component={OtpScreen} />
      </Stack.Navigator>
    );
  }

  if (!activeEvent) {
    console.log('[RootNavigator] No active event, showing JoinEventScreen');
    return (
      <Stack.Navigator>
        <Stack.Screen name="JoinEvent" options={{ title: 'Join Event' }}>
          {(props) => (
            <JoinEventScreen
              onEventJoined={() => {
                console.log('[RootNavigator] onEventJoined callback called');
                // Navigation happens automatically when activeEvent updates via Context
              }}
              {...props}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  console.log('[RootNavigator] Active event exists, showing EventTabs');
  return <EventTabs />;
}

const styles = StyleSheet.create({
  headerButton: { marginRight: 16 },
  headerButtonText: { color: '#007AFF', fontSize: 16 },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff',
  },
  loadingText: { marginTop: 10 },
});