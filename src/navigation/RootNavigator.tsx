import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Pressable, View, StyleSheet } from 'react-native';

import { GridBackground, Loader, NeonTabBar, NeonText } from '../components/ui';
import { palette, spacing } from '../theme';
import { useAuth } from '../hooks/useAuth';
import { useRegisterPushToken } from '../hooks/useRegisterPushToken';
import { hasCompletedProfile } from '../services/user.service';
import { getUserEvents, getHostedEvent } from '../services/event.service';
import { NavigatorContext } from './NavigatorContext';

import { OtpScreen } from '../screens/OtpScreen';
import ProfileSetupScreen from '../screens/ProfileSetupScreen';
import { JoinEventScreen } from '../screens/JoinEventScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import MapScreen from '../screens/MapScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { MatchesScreen } from '../screens/MatchesScreen';
import HostManagementScreen from '../screens/HostManagementScreen';
import RadarScreen from '../screens/RadarScreen';
import HomeFeedScreen from '../screens/HomeFeedScreen';
import ComposePostScreen from '../screens/ComposePostScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import EventFeedScreen from '../screens/EventFeedScreen';
import EventLobbyScreen from '../screens/EventLobbyScreen';
import SpatialFieldScreen from '../spatial/SpatialFieldScreen';
import ChooseAvatarScreen from '../screens/ChooseAvatarScreen';
import OfficeHoursRequestScreen from '../screens/OfficeHoursRequestScreen';
import OfficeHoursInboxScreen from '../screens/OfficeHoursInboxScreen';
import OfficeHoursCallScreen from '../screens/OfficeHoursCallScreen';
import EscortPanelScreen from '../screens/EscortPanelScreen';
import ARFieldScreen from '../spatial/ARFieldScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

interface MainTabsProps {
  userId: string;
  isHost: boolean;
  onEventEnded: () => void;
}

function MainTabs({ userId, isHost, onEventEnded }: Readonly<MainTabsProps>) {
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
      <Tab.Screen name="Home" options={{ tabBarLabel: 'HOME', headerShown: false }}>
        {(props) => <HomeFeedScreen {...props} userId={userId} />}
      </Tab.Screen>

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

      <Tab.Screen name="Me" options={{ tabBarLabel: 'ME', headerShown: false }}>
        {() => <ProfileScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, loading: authLoading } = useAuth();
  useRegisterPushToken(user?.id);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [revision, setRevision] = useState(0);

  const refreshEventState = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  const navCtx = useMemo(() => ({ refreshEventState }), [refreshEventState]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!user) {
        setCheckingProfile(false);
        setProfileComplete(null);
        setIsHost(false);
        return;
      }
      setCheckingProfile(true);
      try {
        const completed = await hasCompletedProfile(user.id);
        if (cancelled) return;
        setProfileComplete(completed);
        if (completed) {
          try {
            const hostedEvent = await getHostedEvent(user.id);
            if (!cancelled) setIsHost(hostedEvent !== null);
          } catch (eventError) {
            console.error('[RootNavigator] Error checking host status:', eventError);
            if (!cancelled) setIsHost(false);
          }
        }
      } catch (error) {
        console.error('[RootNavigator] Error checking profile:', error);
        if (!cancelled) setProfileComplete(false);
      } finally {
        if (!cancelled) setCheckingProfile(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [user, revision]);

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

  if (!user) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Otp" component={OtpScreen} />
      </Stack.Navigator>
    );
  }

  if (profileComplete !== true) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ProfileSetup">
          {(props) => (
            <ProfileSetupScreen
              {...props}
              userId={user.id}
              onComplete={() => {
                setProfileComplete(true);
                refreshEventState();
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  const handleEventEnded = async () => {
    setIsHost(false);
    try {
      await getUserEvents(user.id);
    } catch (error) {
      console.error('[RootNavigator] Error checking events after ending:', error);
    }
    refreshEventState();
  };

  return (
    <NavigatorContext.Provider value={navCtx}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="MainTabs">
          {() => (
            <MainTabs
              userId={user.id}
              isHost={isHost}
              onEventEnded={handleEventEnded}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ animation: 'slide_from_right' }}
        />

        <Stack.Screen
          name="EditProfile"
          component={EditProfileScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
          }}
        />

        <Stack.Screen
          name="ChooseAvatar"
          component={ChooseAvatarScreen}
          options={({ navigation }) => ({
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
            headerShown: true,
            title: '3D Avatar',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            headerLeft: () => (
              <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
                <NeonText variant="label" tone="accent">CLOSE</NeonText>
              </Pressable>
            ),
          })}
        />

        <Stack.Screen
          name="OfficeHoursRequest"
          component={OfficeHoursRequestScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
            headerShown: true,
            title: 'Office Hours',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
          }}
        />

        <Stack.Screen
          name="OfficeHoursInbox"
          component={OfficeHoursInboxScreen}
          options={{
            headerShown: true,
            title: 'Office Hours',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            animation: 'slide_from_right',
          }}
        />

        <Stack.Screen
          name="OfficeHoursCall"
          component={OfficeHoursCallScreen}
          options={{
            presentation: 'fullScreenModal',
            animation: 'fade',
            contentStyle: { backgroundColor: '#0a0a0a' },
            headerShown: false,
          }}
        />

        <Stack.Screen
          name="ARField"
          component={ARFieldScreen}
          options={{
            headerShown: true,
            title: 'AR Field',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            animation: 'fade',
          }}
        />

        <Stack.Screen
          name="EscortPanel"
          component={EscortPanelScreen}
          options={{
            headerShown: true,
            title: 'Escort Queue',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            animation: 'slide_from_right',
          }}
        />

        <Stack.Screen
          name="EventFeed"
          component={EventFeedScreen}
          options={{ animation: 'slide_from_right' }}
        />

        <Stack.Screen
          name="EventLobby"
          component={EventLobbyScreen}
          options={{
            headerShown: true,
            title: 'Lobby',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            animation: 'slide_from_right',
          }}
        />

        <Stack.Screen
          name="SpatialField"
          component={SpatialFieldScreen}
          options={{
            headerShown: true,
            title: 'Field',
            headerStyle: { backgroundColor: palette.space },
            headerTitleStyle: { color: palette.text, fontWeight: '700' },
            headerTintColor: palette.accent,
            animation: 'fade',
          }}
        />

        <Stack.Screen
          name="Compose"
          component={ComposePostScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
          }}
        />

        <Stack.Screen
          name="Radar"
          component={RadarScreen}
          options={{
            presentation: 'modal',
            animation: 'fade',
            contentStyle: { backgroundColor: palette.void },
          }}
        />

        <Stack.Screen
          name="JoinEvent"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
          }}
        >
          {(props) => (
            <JoinEventScreen
              {...props}
              userId={user.id}
              onEventJoined={() => {
                refreshEventState();
                props.navigation.goBack();
              }}
              onCancel={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>

        <Stack.Screen
          name="CreateEvent"
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: palette.void },
          }}
        >
          {(props) => (
            <CreateEventScreen
              {...props}
              userId={user.id}
              onEventCreated={() => {
                setIsHost(true);
                refreshEventState();
                props.navigation.goBack();
              }}
              onCancel={() => props.navigation.goBack()}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigatorContext.Provider>
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
