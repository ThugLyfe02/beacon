// =============================================================================
// proximity.service.ts
// Converts privacy-preserving event proximity vectors into PresenceEngine input.
// Raw peer GPS coordinates never cross this client boundary.
// =============================================================================

import { supabase } from '../lib/supabase';
import type { ProximitySignal } from '../presence/PresenceEngine';

const STALE_LOCATION_MS = 5 * 60 * 1000;
const METERS_PER_FOOT = 0.3048;

interface PeerVectorRow {
  user_id: string;
  is_premium: boolean | null;
  distance_m: number | null;
  bearing_deg: number | null;
  last_location_at: string | null;
  avatar_url_3d: string | null;
}

/**
 * Reads server-computed, range-adaptive proximity vectors.
 *
 * The observer coordinates remain parameters for backward-compatible callers but
 * are intentionally not used here. The database already has the caller's recent
 * self-published fix and derives distance/bearing without returning peer lat/lng.
 */
export async function getEventProximitySignals(
  eventId: string,
  observerId: string,
  _observerLat: number,
  _observerLng: number,
): Promise<ProximitySignal[]> {
  const { data, error } = await supabase.rpc('get_event_proximity_vectors', {
    p_event_id: eventId,
  } as never);

  if (error) {
    console.error('[proximity.service] vector RPC error:', error);
    return [];
  }

  const now = Date.now();
  const peers = (data ?? []) as unknown as PeerVectorRow[];

  return peers.flatMap((peer) => {
    if (peer.distance_m == null || peer.bearing_deg == null) return [];
    if (peer.last_location_at) {
      const ageMs = now - new Date(peer.last_location_at).getTime();
      if (ageMs > STALE_LOCATION_MS) return [];
    }

    const signal: ProximitySignal = {
      observerId,
      targetId: peer.user_id,
      eventId,
      distanceFeet: peer.distance_m / METERS_PER_FOOT,
      targetPremium: !!peer.is_premium,
      mutual: false,
      timestamp: now,
      targetAvatarUrl3d: peer.avatar_url_3d ?? null,
      bearingFromObserverDeg: peer.bearing_deg,
    };
    return [signal];
  });
}
