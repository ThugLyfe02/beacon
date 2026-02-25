import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';
import { useEvent } from '../hooks/useEvent';
import { OtpScreen } from '../screens/OtpScreen';
import { JoinEventScreen } from '../screens/JoinEventScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { MatchesScreen } from '../screens/MatchesScreen';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
function EventTabs() {
  const { signOut } = useAuth();
  const { clearEvent } = useEvent();
  const handleLeaveEvent = () => {
    clearEvent();
  };
  return (
    <Tab.Navigator
      screenOptions={{
        headerRight: () => (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleLeaveEvent}
          >
            <Text style={styles.headerButtonText}>Leave Event</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ title: 'Discover' }}
      />
      <Tab.Screen
        name="Matches"
        component={MatchesScreen}
        options={{ title: 'Matches' }}
      />
    </Tab.Navigator>
  );
}
export function RootNavigator() {
  const { user, loading: authLoading } = useAuth();
  const { activeEvent } = useEvent();
  const [hasJoinedEvent, setHasJoinedEvent] = useState(false);
  console.log('RootNavigator render:', { user: !!user, authLoading, activeEvent: !!activeEvent, hasJoinedEvent });
  if (authLoading) {
    console.log('Showing loading spinner...');
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Loading...</Text>
      </View>
    );
  }
  // Not authenticated → OTP flow
  if (!user) {
    console.log('No user, showing OTP screen');
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Otp" component={OtpScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }
  // Authenticated but no event joined yet → Join Event screen
  if (!activeEvent && !hasJoinedEvent) {
    console.log('User authenticated, showing Join Event screen');
    return (
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="JoinEvent"
            options={{ title: 'Join Event' }}
          >
            {(props) => (
              <JoinEventScreen
                {...props}
                onEventJoined={() => setHasJoinedEvent(true)}
              />
            )}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    );
  }
  // Authenticated + event joined → Main app tabs
  console.log('User authenticated and event joined, showing tabs');
  return (
    <NavigationContainer>
      <EventTabs />
    </NavigationContainer>
  );
}
const styles = StyleSheet.create({
  headerButton: {
    marginRight: 16,
  },
  headerButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
});