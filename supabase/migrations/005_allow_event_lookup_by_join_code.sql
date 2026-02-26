-- =============================================================================
-- Allow users to look up events by join code (needed for joining events)
-- =============================================================================

-- ============================================================
-- FUNCTION: get_event_by_join_code
-- Look up event by join code (bypasses RLS)
-- This is needed because users need to see an event before they can join it
-- ============================================================
CREATE OR REPLACE FUNCTION get_event_by_join_code(p_join_code TEXT)
RETURNS TABLE (
  id UUID,
  host_id UUID,
  name TEXT,
  description TEXT,
  join_code TEXT,
  location_type location_type,
  latitude NUMERIC,
  longitude NUMERIC,
  address TEXT,
  requires_approval BOOLEAN,
  access_code TEXT,
  show_participant_count BOOLEAN,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.host_id,
    e.name,
    e.description,
    e.join_code,
    e.location_type,
    e.latitude,
    e.longitude,
    e.address,
    e.requires_approval,
    e.access_code,
    e.show_participant_count,
    e.starts_at,
    e.ends_at,
    e.created_at
  FROM events e
  WHERE e.join_code = UPPER(TRIM(p_join_code));
END;
$$;
