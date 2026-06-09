import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { saveExpoPushToken } from '../services/escort.service';

/**
 * Registers the current device for Expo push notifications and persists
 * the token on the user row. Safe to call on every app start.
 */
export function useRegisterPushToken(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;
    if (!Device.isDevice) return;

    let cancelled = false;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let status = existing;
        if (existing !== 'granted') {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== 'granted') return;

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }

        const tokenResp = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;
        if (tokenResp.data) await saveExpoPushToken(userId, tokenResp.data);
      } catch (err) {
        console.warn('[useRegisterPushToken] failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);
}
