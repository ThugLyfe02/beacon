-- =============================================================================
-- 015_fix_get_nearby_premium_mod.sql
-- Fixes get_nearby_premium (introduced in 006) which used MOD(double precision,
-- integer). Postgres only provides MOD for matching numeric types, so the call
-- failed with 42883 on every poll. Wrapping the angle in ::numeric resolves it.
-- =============================================================================

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
  SELECT u.is_premium, u.last_known_lat, u.last_known_lng
    INTO v_caller_premium, v_caller_lat, v_caller_lng
    FROM users u
   WHERE u.id = auth.uid();

  IF NOT COALESCE(v_caller_premium, FALSE) THEN
    RETURN;
  END IF;

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
    2 * 6371000 * ASIN(SQRT(
      POWER(SIN(RADIANS(p.last_known_lat - v_caller_lat) / 2), 2)
      + COS(RADIANS(v_caller_lat)) * COS(RADIANS(p.last_known_lat))
        * POWER(SIN(RADIANS(p.last_known_lng - v_caller_lng) / 2), 2)
    )) AS distance_m,
    -- bearing normalized to [0, 360) using numeric MOD (DOUBLE PRECISION has
    -- no matching mod() overload, hence the cast).
    MOD(
      (DEGREES(ATAN2(
        SIN(RADIANS(p.last_known_lng - v_caller_lng)) * COS(RADIANS(p.last_known_lat)),
        COS(RADIANS(v_caller_lat)) * SIN(RADIANS(p.last_known_lat))
          - SIN(RADIANS(v_caller_lat)) * COS(RADIANS(p.last_known_lat))
            * COS(RADIANS(p.last_known_lng - v_caller_lng))
      )) + 360)::numeric,
      360::numeric
    )::double precision AS bearing_deg,
    p.last_location_at
  FROM peers p
  ORDER BY distance_m ASC;
END;
$$;
