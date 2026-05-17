-- =============================================================================
-- Beacon — Premium tier + GPS proximity
-- Adds discoverability + last-known location to users.
-- Adds get_nearby_premium(): returns premium+discoverable users in the
-- caller's event, sorted by distance. Filters out the caller's own row.
-- =============================================================================

-- ─── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_premium       BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS premium_since    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_discoverable  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_known_lat   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_known_lng   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

-- Stale-location index — used by proximity queries to ignore old positions.
CREATE INDEX IF NOT EXISTS idx_users_premium_discoverable
  ON users (is_premium, is_discoverable)
  WHERE is_premium = TRUE AND is_discoverable = TRUE;

-- ─── RLS update: users can update their own discoverability + location ──────
-- We let users update their own row's discoverability + location. Premium
-- itself is NOT user-updatable in production (set via SECURITY DEFINER fn or
-- admin); see set_premium_dev below for the stub.
DO $$ BEGIN
  DROP POLICY IF EXISTS "users_update_own" ON users;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE POLICY "users_update_own"
  ON users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── Function: set_premium_dev ──────────────────────────────────────────────
-- STUB for development. Lets a user toggle their own premium status without
-- payments wired up. Replace with payment-webhook-backed flow before launch.
CREATE OR REPLACE FUNCTION set_premium_dev(p_is_premium BOOLEAN)
RETURNS users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result users;
BEGIN
  UPDATE users
     SET is_premium    = p_is_premium,
         premium_since = CASE WHEN p_is_premium THEN COALESCE(premium_since, NOW()) ELSE NULL END,
         updated_at    = NOW()
   WHERE id = auth.uid()
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'User row not found for auth.uid()=%', auth.uid();
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION set_premium_dev(BOOLEAN) TO authenticated;

-- ─── Function: get_nearby_premium ───────────────────────────────────────────
-- Returns premium+discoverable users in the same event as the caller, sorted
-- by distance from the caller's last_known location. The caller must:
--   1. be premium themselves (else returns no rows)
--   2. be an approved participant of the event
-- Caller's own row is excluded. Stale locations (>10min) are excluded.
CREATE OR REPLACE FUNCTION get_nearby_premium(p_event_id UUID)
RETURNS TABLE (
  user_id       UUID,
  name          TEXT,
  role          TEXT,
  one_liner     TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  distance_m    DOUBLE PRECISION,
  bearing_deg   DOUBLE PRECISION,
  last_seen_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_lat DOUBLE PRECISION;
  v_caller_lng DOUBLE PRECISION;
  v_caller_premium BOOLEAN;
BEGIN
  -- Caller must be premium + have a recent location
  SELECT u.is_premium, u.last_known_lat, u.last_known_lng
    INTO v_caller_premium, v_caller_lat, v_caller_lng
    FROM users u
   WHERE u.id = auth.uid();

  IF NOT COALESCE(v_caller_premium, FALSE) THEN
    RETURN;
  END IF;

  -- Caller must be an approved participant of the event
  IF NOT EXISTS (
    SELECT 1 FROM event_participants ep
     WHERE ep.event_id = p_event_id
       AND ep.user_id  = auth.uid()
       AND ep.status   = 'approved'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH peers AS (
    SELECT u.id, u.name, u.role, u.one_liner,
           u.last_known_lat, u.last_known_lng, u.last_location_at
      FROM users u
      JOIN event_participants ep ON ep.user_id = u.id
     WHERE ep.event_id = p_event_id
       AND ep.status   = 'approved'
       AND u.is_premium      = TRUE
       AND u.is_discoverable = TRUE
       AND u.id <> auth.uid()
       AND u.last_known_lat  IS NOT NULL
       AND u.last_known_lng  IS NOT NULL
       AND u.last_location_at > NOW() - INTERVAL '10 minutes'
  )
  SELECT
    p.id,
    p.name,
    p.role,
    p.one_liner,
    p.last_known_lat,
    p.last_known_lng,
    -- haversine in meters (R = 6371000)
    2 * 6371000 * ASIN(SQRT(
      POWER(SIN(RADIANS(p.last_known_lat - v_caller_lat) / 2), 2)
      + COS(RADIANS(v_caller_lat)) * COS(RADIANS(p.last_known_lat))
        * POWER(SIN(RADIANS(p.last_known_lng - v_caller_lng) / 2), 2)
    )) AS distance_m,
    -- compass bearing from caller toward peer (degrees, 0 = N)
    MOD(DEGREES(ATAN2(
      SIN(RADIANS(p.last_known_lng - v_caller_lng)) * COS(RADIANS(p.last_known_lat)),
      COS(RADIANS(v_caller_lat)) * SIN(RADIANS(p.last_known_lat))
        - SIN(RADIANS(v_caller_lat)) * COS(RADIANS(p.last_known_lat))
          * COS(RADIANS(p.last_known_lng - v_caller_lng))
    )) + 360, 360) AS bearing_deg,
    p.last_location_at
  FROM peers p
  ORDER BY distance_m ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_nearby_premium(UUID) TO authenticated;
