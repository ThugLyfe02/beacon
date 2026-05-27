-- =============================================================================
-- Beacon — Join flow fixes
-- Server-side join that:
--   * auto-approves when the event has requires_approval = FALSE
--   * stays pending when approval is required
--   * returns the existing row if the user already requested
-- Also: bring the participant SELECT/UPDATE policies into a known-good state in
-- case migration 004 wasn't applied on this deployment.
-- =============================================================================

-- ─── Helper functions (re-declared idempotently from migration 004) ─────────
-- We re-declare these here so this migration works standalone, in case
-- migration 004 was skipped or partially applied.

CREATE OR REPLACE FUNCTION is_event_host(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM events WHERE id = p_event_id AND host_id = p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_approved_participant(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM event_participants
     WHERE event_id = p_event_id AND user_id = p_user_id AND status = 'approved'
  );
END;
$$;

-- ─── Idempotent re-apply of the read/update policies that hosts depend on ────
-- (No harm if these already exist from migration 004; the DROP IF EXISTS pattern
-- makes this safe to run on any schema version.)

-- Make sure the events SELECT policy lets the host read their own event row
-- (the helper functions only check participants; events still has its own RLS).
DROP POLICY IF EXISTS "events: participant or host read" ON events;
CREATE POLICY "events: participant or host read"
  ON events FOR SELECT
  USING (
    auth.uid() = host_id
    OR is_approved_participant(events.id, auth.uid())
  );

DROP POLICY IF EXISTS "event_participants: approved or host read" ON event_participants;
CREATE POLICY "event_participants: approved or host read"
  ON event_participants FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_event_host(event_participants.event_id, auth.uid())
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

DROP POLICY IF EXISTS "event_participants: host delete" ON event_participants;
CREATE POLICY "event_participants: host delete"
  ON event_participants FOR DELETE
  USING (is_event_host(event_participants.event_id, auth.uid()));

-- ─── Server-side join ───────────────────────────────────────────────────────
-- Single source of truth for "join this event". Reads requires_approval and
-- inserts the correct status. SECURITY DEFINER so it bypasses RLS for the
-- insert (we enforce caller identity via auth.uid()).
CREATE OR REPLACE FUNCTION request_to_join_event(p_event_id UUID)
RETURNS event_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requires_approval BOOLEAN;
  v_existing event_participants;
  v_result   event_participants;
BEGIN
  -- caller identity
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- event must exist; pull approval flag
  SELECT requires_approval INTO v_requires_approval
    FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  -- if the caller already has a row, return it (caller can re-call safely)
  SELECT * INTO v_existing
    FROM event_participants
   WHERE event_id = p_event_id AND user_id = auth.uid();
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO event_participants (event_id, user_id, status)
  VALUES (
    p_event_id,
    auth.uid(),
    CASE WHEN v_requires_approval THEN 'pending' ELSE 'approved' END
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION request_to_join_event(UUID) TO authenticated;

-- ─── User's pending requests (so the client can show "awaiting approval") ───
CREATE OR REPLACE FUNCTION get_my_pending_requests()
RETURNS TABLE (
  participant_id UUID,
  event_id       UUID,
  event_name     TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ep.id, ep.event_id, e.name, ep.joined_at
    FROM event_participants ep
    JOIN events e ON e.id = ep.event_id
   WHERE ep.user_id = auth.uid()
     AND ep.status  = 'pending'
   ORDER BY ep.joined_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_my_pending_requests() TO authenticated;
