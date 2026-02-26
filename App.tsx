import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RootNavigator } from './src/navigation/RootNavigator';
import { EventProvider } from './src/hooks/useEvent';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <EventProvider>
          <RootNavigator />
        </EventProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
