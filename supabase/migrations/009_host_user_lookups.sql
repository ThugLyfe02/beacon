-- =============================================================================
-- Beacon — Host-side user lookups
-- The "users" table has a self-only SELECT policy (auth.uid() = id), which
-- means PostgREST joins like `event_participants(*, users(*))` silently return
-- users = NULL for every row except the caller's own. That caused the host's
-- "pending requests" screen to crash with "cannot read property 'name' of null"
-- and the discover screen to show empty profiles.
--
-- Rather than loosening the users RLS, we expose narrow SECURITY DEFINER RPCs
-- that return *only* the public profile columns and *only* for users who are
-- participants of an event the caller hosts or is approved into.
-- =============================================================================

-- ─── Pending join requests for a host ───────────────────────────────────────
CREATE OR REPLACE FUNCTION get_pending_join_requests(p_event_id UUID)
RETURNS TABLE (
  participant_id UUID,
  user_id        UUID,
  event_id       UUID,
  joined_at      TIMESTAMPTZ,
  name           TEXT,
  email          TEXT,
  role           TEXT,
  one_liner      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_event_host(p_event_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT ep.id, ep.user_id, ep.event_id, ep.joined_at,
           u.name, u.email, u.role, u.one_liner
      FROM event_participants ep
      JOIN users u ON u.id = ep.user_id
     WHERE ep.event_id = p_event_id
       AND ep.status   = 'pending'
     ORDER BY ep.joined_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_join_requests(UUID) TO authenticated;

-- ─── Approved participants of an event (for discovery / networking) ────────
CREATE OR REPLACE FUNCTION get_event_approved_participants(
  p_event_id        UUID,
  p_exclude_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  participant_id UUID,
  user_id        UUID,
  event_id       UUID,
  status         TEXT,
  joined_at      TIMESTAMPTZ,
  email          TEXT,
  name           TEXT,
  role           TEXT,
  one_liner      TEXT,
  is_premium     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be the host or an approved participant themselves.
  IF NOT (
    is_event_host(p_event_id, auth.uid())
    OR is_approved_participant(p_event_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT ep.id,
           ep.user_id,
           ep.event_id,
           ep.status::TEXT,
           ep.joined_at,
           u.email,
           u.name,
           u.role,
           u.one_liner,
           COALESCE(u.is_premium, FALSE)
      FROM event_participants ep
      JOIN users u ON u.id = ep.user_id
     WHERE ep.event_id = p_event_id
       AND ep.status   = 'approved'
       AND (p_exclude_user_id IS NULL OR ep.user_id <> p_exclude_user_id)
     ORDER BY ep.joined_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_event_approved_participants(UUID, UUID) TO authenticated;
