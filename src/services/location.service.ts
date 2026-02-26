// =============================================================================
// location.service.ts
// Device GPS and location management
// =============================================================================

import * as Location from 'expo-location';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Request location permissions
 */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('[location.service] Error requesting permission:', error);
    return false;
  }
}

/**
 * Get current device location
 */
export async function getCurrentLocation(): Promise<Coordinates | null> {
  try {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      console.error('[location.service] Location permission denied');
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (error) {
    console.error('[location.service] Error getting current location:', error);
    return null;
  }
}

/**
 * Watch location changes (for live broadcasting)
 */
export async function watchLocation(
  callback: (coords: Coordinates) => void
): Promise<Location.LocationSubscription | null> {
  try {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      console.error('[location.service] Location permission denied');
      return null;
    }

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000, // Update every 10 seconds
        distanceInterval: 10, // Update every 10 meters
      },
      (location) => {
        callback({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      }
    );

    return subscription;
  } catch (error) {
    console.error('[location.service] Error watching location:', error);
    return null;
  }
}

/**
 * Geocode an address to coordinates
 */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  try {
    const results = await Location.geocodeAsync(address);
    if (results.length > 0) {
      return {
        latitude: results[0].latitude,
        longitude: results[0].longitude,
      };
    }
    return null;
  } catch (error) {
    console.error('[location.service] Error geocoding address:', error);
    return null;
  }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(coords: Coordinates): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync(coords);
    if (results.length > 0) {
      const addr = results[0];
      return `${addr.street || ''} ${addr.city || ''}, ${addr.region || ''} ${addr.postalCode || ''}`.trim();
    }
    return null;
  } catch (error) {
    console.error('[location.service] Error reverse geocoding:', error);
    return null;
  }
}
