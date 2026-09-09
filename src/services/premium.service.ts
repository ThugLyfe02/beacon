// =============================================================================
// premium.service.ts
// Premium state, discoverability, and event-scoped proximity publication.
// =============================================================================

import { supabase } from '../lib/supabase';
import type { NearbyPremiumUser, UserRow } from '../types/database';

export async function getPremiumStatus(userId: string): Promise<{
  isPremium: boolean;
  isDiscoverable: boolean;
  premiumSince: string | null;
} | null> {
  const { data, error } = await supabase
    .from('users')
    .select('is_premium, is_discoverable, premium_since')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('[premium.service] getPremiumStatus error:', error);
    return null;
  }
  return {
    isPremium: !!data.is_premium,
    isDiscoverable: !!data.is_discoverable,
    premiumSince: data.premium_since,
  };
}

/**
 * Legacy development entry point retained only so older dev UI fails explicitly.
 * The database permanently denies self-service premium mutation.
 */
export async function setPremiumDev(_isPremium: boolean): Promise<UserRow> {
  throw new Error('Self-service premium mutation is disabled. Premium must come from a trusted server workflow.');
}

export async function setDiscoverable(
  userId: string,
  isDiscoverable: boolean
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ is_discoverable: isDiscoverable })
    .eq('id', userId);
  if (error) {
    console.error('[premium.service] setDiscoverable error:', error);
    throw new Error('Could not update discoverability');
  }
}

/**
 * Publishes a precise self-location only through the database's event-scoped
 * privacy boundary. The caller's user ID is derived from auth.uid() server-side.
 */
export async function pushMyLocation(
  eventId: string,
  lat: number,
  lng: number
): Promise<boolean> {
  const { data, error } = await supabase.rpc('publish_event_location', {
    p_event_id: eventId,
    p_latitude: lat,
    p_longitude: lng,
  });
  if (error) {
    console.warn('[premium.service] event location publication rejected:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function getNearbyPremium(
  eventId: string
): Promise<NearbyPremiumUser[]> {
  const { data, error } = await supabase.rpc('get_nearby_premium', {
    p_event_id: eventId,
  });
  if (error) {
    console.error('[premium.service] get_nearby_premium error:', error);
    return [];
  }
  return (data ?? []) as NearbyPremiumUser[];
}
