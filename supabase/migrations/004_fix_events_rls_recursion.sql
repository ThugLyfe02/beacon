-- =============================================================================
-- Fix infinite recursion in events and event_participants RLS policies
-- =============================================================================

-- ============================================================
-- HELPER FUNCTION: is_event_host
-- Check if user is the host of an event (bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION is_event_host(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM events
    WHERE id = p_event_id AND host_id = p_user_id
  );
END;
$$;

-- ============================================================
-- HELPER FUNCTION: is_approved_participant
-- Check if user is an approved participant in an event (bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION is_approved_participant(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM event_participants
    WHERE event_id = p_event_id
      AND user_id = p_user_id
      AND status = 'approved'
  );
END;
$$;

-- ============================================================
-- UPDATE: events RLS policies
-- Use helper function to avoid recursion
-- ============================================================

DROP POLICY IF EXISTS "events: participant or host read" ON events;
CREATE POLICY "events: participant or host read"
  ON events FOR SELECT
  USING (
    auth.uid() = host_id
    OR is_approved_participant(events.id, auth.uid())
  );

-- ============================================================
-- UPDATE: event_participants RLS policies
-- Use helper function to avoid recursion
-- ============================================================

DROP POLICY IF EXISTS "event_participants: approved or host read" ON event_participants;
CREATE POLICY "event_participants: approved or host read"
  ON event_participants FOR SELECT
  USING (
    -- User is the participant themselves
    auth.uid() = user_id
    -- OR user is the host of the event
    OR is_event_host(event_participants.event_id, auth.uid())
    -- OR user is an approved participant in the same event
    OR (
      status = 'approved'
      AND is_approved_participant(event_participants.event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "event_participants: host update status" ON event_participants;
CREATE POLICY "event_participants: host update status"
  ON event_participants FOR UPDATE
  USING (is_event_host(event_participants.event_id, auth.uid()))
  WITH CHECK (is_event_host(event_participants.event_id, auth.uid()));
