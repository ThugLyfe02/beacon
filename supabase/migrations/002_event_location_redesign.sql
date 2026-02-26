-- =============================================================================
-- Beacon - Event Location & Broadcasting Redesign
-- Adds host functionality, event locations, and request-based joining
-- =============================================================================

-- ============================================================
-- ENUM: location_type
-- ============================================================
DO $$ BEGIN
  CREATE TYPE location_type AS ENUM ('live', 'fixed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- ENUM: participant_status
-- ============================================================
DO $$ BEGIN
  CREATE TYPE participant_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- ALTER TABLE: event_participants
-- Add approval status for join requests (MUST BE DONE FIRST)
-- ============================================================

-- Add status column FIRST before creating policies that reference it
ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS status participant_status DEFAULT 'pending';

-- Update is_discoverable to status='approved' for existing rows
UPDATE event_participants SET status = 'approved' WHERE is_discoverable = TRUE;

-- Drop the old connection_requests policy that references is_discoverable
DROP POLICY IF EXISTS "connection_requests: validated insert" ON connection_requests;

-- Drop is_discoverable column (users are discoverable by default when approved)
ALTER TABLE event_participants DROP COLUMN IF EXISTS is_discoverable;

-- ============================================================
-- ALTER TABLE: events
-- Add host and location broadcasting features
-- ============================================================

-- Add new columns for event broadcasting
ALTER TABLE events ADD COLUMN IF NOT EXISTS host_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_type location_type DEFAULT 'fixed';
ALTER TABLE events ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE events ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE events ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT TRUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS access_code TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS show_participant_count BOOLEAN DEFAULT FALSE;

-- Create index for host lookups
CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id);

-- Update RLS policies for events

-- DROP old policies
DROP POLICY IF EXISTS "events: authenticated read" ON events;

-- SELECT: Users can see events they've joined (approved) or are hosting
DROP POLICY IF EXISTS "events: participant or host read" ON events;
CREATE POLICY "events: participant or host read"
  ON events FOR SELECT
  USING (
    auth.uid() = host_id
    OR EXISTS (
      SELECT 1 FROM event_participants ep
      WHERE ep.event_id = events.id
        AND ep.user_id = auth.uid()
        AND ep.status = 'approved'
    )
  );

-- INSERT: Any authenticated user can create an event (become host)
DROP POLICY IF EXISTS "events: host insert" ON events;
CREATE POLICY "events: host insert"
  ON events FOR INSERT
  WITH CHECK (auth.uid() = host_id);

-- UPDATE: Only the host can update their event
DROP POLICY IF EXISTS "events: host update" ON events;
CREATE POLICY "events: host update"
  ON events FOR UPDATE
  USING (auth.uid() = host_id)
  WITH CHECK (auth.uid() = host_id);

-- DELETE: Only the host can delete their event
DROP POLICY IF EXISTS "events: host delete" ON events;
CREATE POLICY "events: host delete"
  ON events FOR DELETE
  USING (auth.uid() = host_id);

-- Update RLS policies

-- DROP old policies
DROP POLICY IF EXISTS "event_participants: shared event read" ON event_participants;
DROP POLICY IF EXISTS "event_participants: self insert" ON event_participants;
DROP POLICY IF EXISTS "event_participants: self update" ON event_participants;
DROP POLICY IF EXISTS "event_participants: self delete" ON event_participants;

-- SELECT: Users can see participants of events they're in (approved) or hosting
DROP POLICY IF EXISTS "event_participants: approved or host read" ON event_participants;
CREATE POLICY "event_participants: approved or host read"
  ON event_participants FOR SELECT
  USING (
    -- User is the participant themselves
    auth.uid() = user_id
    -- OR user is the host of the event
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.host_id = auth.uid()
    )
    -- OR user is an approved participant in the same event
    OR (
      status = 'approved'
      AND EXISTS (
        SELECT 1 FROM event_participants ep
        WHERE ep.event_id = event_participants.event_id
          AND ep.user_id = auth.uid()
          AND ep.status = 'approved'
      )
    )
  );

-- INSERT: Users can request to join events
DROP POLICY IF EXISTS "event_participants: request join" ON event_participants;
CREATE POLICY "event_participants: request join"
  ON event_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Only event host can update participant status (approve/reject)
DROP POLICY IF EXISTS "event_participants: host update status" ON event_participants;
CREATE POLICY "event_participants: host update status"
  ON event_participants FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.host_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.host_id = auth.uid()
    )
  );

-- DELETE: Users can leave events (delete their own participation)
DROP POLICY IF EXISTS "event_participants: self leave" ON event_participants;
CREATE POLICY "event_participants: self leave"
  ON event_participants FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- UPDATE: connection_requests RLS
-- Update to use new participant status field
-- ============================================================

-- Recreate the policy to use status instead of is_discoverable
CREATE POLICY "connection_requests: validated insert"
  ON connection_requests FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
    AND is_user_in_event(connection_requests.event_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM event_participants ep
      WHERE ep.event_id = connection_requests.event_id
        AND ep.user_id = connection_requests.recipient_id
        AND ep.status = 'approved'
    )
  );

-- ============================================================
-- FUNCTION: approve_participant_with_code
-- Auto-approves participant if valid access code provided
-- ============================================================
CREATE OR REPLACE FUNCTION approve_participant_with_code(
  p_event_id UUID,
  p_user_id UUID,
  p_access_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_code TEXT;
BEGIN
  -- Get the event's access code
  SELECT access_code INTO v_event_code
  FROM events
  WHERE id = p_event_id;

  -- Check if codes match
  IF v_event_code IS NOT NULL AND v_event_code = p_access_code THEN
    -- Update participant status to approved
    UPDATE event_participants
    SET status = 'approved'
    WHERE event_id = p_event_id
      AND user_id = p_user_id;

    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;
