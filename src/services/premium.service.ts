// =============================================================================
// premium.service.ts
// Premium tier + GPS proximity. Wraps the migration 006 fields and RPCs.
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
 * DEV STUB: toggle current user's premium status without payments.
 * Replace with payment-webhook-driven flow before launch.
 */
export async function setPremiumDev(isPremium: boolean): Promise<UserRow> {
  const { data, error } = await supabase.rpc('set_premium_dev', {
    p_is_premium: isPremium,
  });
  if (error) {
    console.error('[premium.service] set_premium_dev error:', error);
    throw new Error('Could not update premium status');
  }
  // The Postgres function returns SETOF users; Supabase wraps as array of one.
  return Array.isArray(data) ? data[0] : (data as UserRow);
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

export async function pushMyLocation(
  userId: string,
  lat: number,
  lng: number
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      last_known_lat: lat,
      last_known_lng: lng,
      last_location_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) {
    console.error('[premium.service] pushMyLocation error:', error);
  }
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
