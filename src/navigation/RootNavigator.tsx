import React, { useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';

import { GridBackground, Loader, NeonTabBar, NeonText } from '../components/ui';
import { palette, spacing } from '../theme';
import { useAuth } from '../hooks/useAuth';
import { hasCompletedProfile } from '../services/user.service';
import { getUserEvents, getHostedEvent } from '../services/event.service';

import { OtpScreen } from '../screens/OtpScreen';
import ProfileSetupScreen from '../screens/ProfileSetupScreen';
import EventGatewayScreen from '../screens/EventGatewayScreen';
import { JoinEventScreen } from '../screens/JoinEventScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import MapScreen from '../screens/MapScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { MatchesScreen } from '../screens/MatchesScreen';
import HostManagementScreen from '../screens/HostManagementScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function EventTabs({
  userId,
  isHost,
  onEventEnded,
}: {
  userId: string;
  isHost: boolean;
  onEventEnded: () => void;
}) {
  return (
    <Tab.Navigator
      tabBar={NeonTabBar}
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: palette.space },
        headerTitleStyle: { color: palette.text, fontWeight: '700', letterSpacing: 1 },
        headerTintColor: palette.accent,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: palette.void },
      }}
    >
      <Tab.Screen name="Map" options={{ tabBarLabel: 'MAP' }}>
        {(props) => <MapScreen {...props} userId={userId} />}
      </Tab.Screen>

      {isHost && (
        <Tab.Screen
          name="Host"
          options={{ tabBarLabel: 'HOST', title: 'Event Management' }}
        >
          {(props) => (
            <HostManagementScreen
              {...props}
              userId={userId}
              onEventEnded={onEventEnded}
            />
          )}
        </Tab.Screen>
      )}

      <Tab.Screen name="Discover" options={{ tabBarLabel: 'DISCOVER' }}>
        {(props) => <DiscoverScreen {...props} userId={userId} />}
      </Tab.Screen>

      <Tab.Screen name="Matches" options={{ tabBarLabel: 'MATCHES' }}>
        {(props) => <MatchesScreen {...props} userId={userId} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading: authLoading } = useAuth();
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [hasEvents, setHasEvents] = useState<boolean | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);

  // Check profile completion when user changes
  useEffect(() => {
    async function checkProfile() {
      console.log('[RootNavigator] Checking profile, user:', user?.id);

      if (!user) {
        console.log('[RootNavigator] No user, resetting state');
        setCheckingProfile(false);
        setProfileComplete(null);
        setHasEvents(null);
        return;
      }

      setCheckingProfile(true);
      try {
        console.log('[RootNavigator] Calling hasCompletedProfile for:', user.id);
        const completed = await hasCompletedProfile(user.id);
        console.log('[RootNavigator] Profile completed:', completed);
        setProfileComplete(completed);

        if (completed) {
          // Check if user has any events or is hosting
          console.log('[RootNavigator] Checking events for user:', user.id);
          try {
            const [events, hostedEvent] = await Promise.all([
              getUserEvents(user.id),
              getHostedEvent(user.id),
            ]);
            console.log('[RootNavigator] Events:', events.length, 'Hosted:', hostedEvent !== null);
            setHasEvents(events.length > 0 || hostedEvent !== null);
            setIsHost(hostedEvent !== null);
          } catch (eventError) {
            console.error('[RootNavigator] Error checking events (profile is still complete):', eventError);
            // Don't reset profileComplete - just set hasEvents to false
            setHasEvents(false);
            setIsHost(false);
          }
        }
      } catch (error) {
        console.error('[RootNavigator] Error checking profile:', error);
        // Only set profileComplete to false if profile check itself failed
        setProfileComplete(false);
        setHasEvents(false);
      } finally {
        setCheckingProfile(false);
      }
    }

    checkProfile();
  }, [user]);

  // Show loading screen while auth is loading
  if (authLoading || checkingProfile) {
    return (
      <View style={styles.loadingContainer}>
        <GridBackground />
        <View style={styles.loadingInner}>
          <Loader size={64} />
          <NeonText variant="label" tone="accent" style={styles.loadingText}>
            Calibrating signal
          </NeonText>
        </View>
      </View>
    );
  }

  // Not authenticated → Show OTP screen
  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Otp" component={OtpScreen} />
      </Stack.Navigator>
    );
  }

  // Authenticated but profile incomplete → Show profile setup
  if (profileComplete !== true) {
    console.log('[RootNavigator] Render: PROFILE SETUP (profile not complete)', { profileComplete });
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ProfileSetup">
          {(props) => (
            <ProfileSetupScreen
              {...props}
              userId={user.id}
              onComplete={async () => {
                console.log('[RootNavigator] Profile completed, checking events');
                setProfileComplete(true);

                // Check for events after profile completion
                try {
                  const [events, hostedEvent] = await Promise.all([
                    getUserEvents(user.id),
                    getHostedEvent(user.id),
                  ]);
                  console.log('[RootNavigator] Events check after profile:', events.length, hostedEvent);
                  setHasEvents(events.length > 0 || hostedEvent !== null);
                  setIsHost(hostedEvent !== null);
                } catch (error) {
                  console.error('[RootNavigator] Error checking events after profile:', error);
                  setHasEvents(false);
                }
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  // Profile complete but no events → Show gateway (join or create)
  console.log('[RootNavigator] Render: EVENT GATEWAY', { profileComplete, hasEvents });
  if (hasEvents === false) {
    return (
      <Stack.Navigator>
        <Stack.Screen
          name="EventGateway"
          options={{ headerShown: false }}
        >
          {(props) => (
            <EventGatewayScreen
              {...props}
              onJoinEvent={() => props.navigation.navigate('JoinEvent')}
              onCreateEvent={() => props.navigation.navigate('CreateEvent')}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="JoinEvent"
          options={{ title: 'Join Event' }}
        >
          {(props) => (
            <JoinEventScreen
              {...props}
              userId={user.id}
              onEventJoined={() => {
                // Refresh events check
                setHasEvents(true);
              }}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="CreateEvent"
          options={{ headerShown: false }}
        >
          {(props) => (
            <CreateEventScreen
              {...props}
              userId={user.id}
              onEventCreated={() => {
                // Refresh and mark as host
                setHasEvents(true);
                setIsHost(true);
              }}
              onCancel={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  // Has events → Show event tabs
  return (
    <EventTabs
      userId={user.id}
      isHost={isHost}
      onEventEnded={async () => {
        console.log('[RootNavigator] Event ended, updating state');
        // Event has been deleted, user is no longer a host
        setIsHost(false);

        // Check if user has any other events (as a participant)
        try {
          const events = await getUserEvents(user.id);
          console.log('[RootNavigator] Remaining events after host event ended:', events.length);
          setHasEvents(events.length > 0);
        } catch (error) {
          console.error('[RootNavigator] Error checking events after ending:', error);
          setHasEvents(false);
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: palette.void,
  },
  loadingInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.lg,
  },
});
