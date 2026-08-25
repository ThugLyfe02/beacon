// =============================================================================
// proximity.service.ts
// Computes per-event proximity signals between approved attendees from their
// last known GPS positions. Feeds the PresenceEngine.
// Reads peer positions via SECURITY DEFINER RPC `get_event_proximity_signals`
// which enforces approved + discoverable + not-blocked filtering.
// =============================================================================

import { supabase } from '../lib/supabase';
import { bearingDegrees, haversineMeters } from '../lib/geometry';
import type { ProximitySignal } from '../presence/PresenceEngine';

// A 40-foot live field cannot truthfully use multi-minute-old position fixes.
// The app polls every 5s while active; after 90s without a peer fix Beacon drops
// that person from live spatial placement instead of pretending the old position
// is current. Historical/recap systems own longer-lived event memory separately.
const STALE_LOCATION_MS = 90 * 1000;
const METERS_PER_FOOT = 0.3048;

interface PeerRow {
  user_id: string;
  is_premium: boolean | null;
  last_known_lat: number | null;
  last_known_lng: number | null;
  last_location_at: string | null;
  avatar_url_3d: string | null;
}

export async function getEventProximitySignals(
  eventId: string,
  observerId: string,
  observerLat: number,
  observerLng: number
): Promise<ProximitySignal[]> {
  const { data, error } = await supabase.rpc('get_event_proximity_signals', {
    p_event_id: eventId,
  } as never);

  if (error) {
    console.error('[proximity.service] rpc error:', error);
    return [];
  }

  const now = Date.now();
  const peers = (data ?? []) as unknown as PeerRow[];

  return peers.flatMap((p) => {
    if (p.last_known_lat == null || p.last_known_lng == null) return [];

    let peerFixAt = now;
    if (p.last_location_at) {
      const parsed = Date.parse(p.last_location_at);
      if (!Number.isFinite(parsed)) return [];
      peerFixAt = parsed;
      const ageMs = Math.max(0, now - parsed);
      if (ageMs > STALE_LOCATION_MS) return [];
    }

    const meters = haversineMeters(
      observerLat,
      observerLng,
      p.last_known_lat,
      p.last_known_lng
    );

    const signal: ProximitySignal = {
      observerId,
      targetId: p.user_id,
      eventId,
      distanceFeet: meters / METERS_PER_FOOT,
      targetPremium: !!p.is_premium,
      mutual: false,
      // Preserve the actual peer fix time. Downstream spatial/focus layers can
      // now decay or suppress stale directional guidance instead of receiving a
      // freshly stamped signal for an old coordinate.
      timestamp: peerFixAt,
      targetAvatarUrl3d: p.avatar_url_3d ?? null,
      bearingFromObserverDeg: bearingDegrees(
        observerLat,
        observerLng,
        p.last_known_lat,
        p.last_known_lng
      ),
    };
    return [signal];
  });
}
