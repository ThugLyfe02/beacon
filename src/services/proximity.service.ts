// =============================================================================
// proximity.service.ts
// Computes per-event proximity signals between approved attendees from their
// last known GPS positions. Feeds the PresenceEngine.
// =============================================================================

import { supabase } from '../lib/supabase';
import type { ProximitySignal } from '../presence/PresenceEngine';

// Ignore peers whose last fix is older than this — they're probably gone.
const STALE_LOCATION_MS = 5 * 60 * 1000;
const METERS_PER_FOOT = 0.3048;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // m
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface AttendeeRow {
  user_id: string;
  users: {
    id: string;
    is_premium: boolean | null;
    is_discoverable: boolean | null;
    last_known_lat: number | null;
    last_known_lng: number | null;
    last_location_at: string | null;
    avatar_url_3d: string | null;
  } | null;
}

export async function getEventProximitySignals(
  eventId: string,
  observerId: string,
  observerLat: number,
  observerLng: number
): Promise<ProximitySignal[]> {
  const { data, error } = await supabase
    .from('event_participants')
    .select(
      'user_id, users(id, is_premium, is_discoverable, last_known_lat, last_known_lng, last_location_at, avatar_url_3d)'
    )
    .eq('event_id', eventId)
    .eq('status', 'approved');

  if (error) {
    console.error('[proximity.service] fetch attendees error:', error);
    return [];
  }

  const now = Date.now();
  const rows = (data ?? []) as unknown as AttendeeRow[];

  return rows.flatMap((row) => {
    const u = row.users;
    if (!u || u.id === observerId) return [];
    if (u.is_discoverable === false) return [];
    if (u.last_known_lat == null || u.last_known_lng == null) return [];
    if (u.last_location_at) {
      const ageMs = now - new Date(u.last_location_at).getTime();
      if (ageMs > STALE_LOCATION_MS) return [];
    }

    const meters = haversineMeters(
      observerLat,
      observerLng,
      u.last_known_lat,
      u.last_known_lng
    );

    const signal: ProximitySignal = {
      observerId,
      targetId: u.id,
      eventId,
      distanceFeet: meters / METERS_PER_FOOT,
      targetPremium: !!u.is_premium,
      mutual: false,
      timestamp: now,
      targetAvatarUrl3d: u.avatar_url_3d ?? null,
    };
    return [signal];
  });
}
