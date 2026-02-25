-- =============================================================================
-- Beacon MVP — Initial Schema Migration
-- profile_scope: global | auth_method: otp
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE request_status AS ENUM ('pending', 'withdrawn');

-- ============================================================
-- TABLE: users
-- One row per authenticated user. Profile is global (shared
-- across all events) because profile_scope = "global".
-- ============================================================
CREATE TABLE users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  role        TEXT,
  one_liner   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create user row on sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: self read"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "users: self insert"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users: self update"
  ON users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- TABLE: events
-- Created and managed by the service-role / admin only.
-- ============================================================
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  join_code   TEXT NOT NULL UNIQUE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: events — authenticated users may read; no client mutations
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: authenticated read"
  ON events FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================
-- TABLE: event_participants
-- Joins a user to an event; controls discoverability.
-- ============================================================
CREATE TABLE event_participants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_discoverable  BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_event_participants_event ON event_participants(event_id);
CREATE INDEX idx_event_participants_user  ON event_participants(user_id);

-- RLS: event_participants
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

-- SELECT: only visible if caller is also a participant of the same event
CREATE POLICY "event_participants: shared event read"
  ON event_participants FOR SELECT
  USING (
    event_id IN (
      SELECT ep2.event_id FROM event_participants ep2
      WHERE ep2.user_id = auth.uid()
    )
  );

-- INSERT: self-only
CREATE POLICY "event_participants: self insert"
  ON event_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: self-only
CREATE POLICY "event_participants: self update"
  ON event_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: self-only
CREATE POLICY "event_participants: self delete"
  ON event_participants FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: connection_requests
-- ============================================================
CREATE TABLE connection_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       request_status NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, requester_id, recipient_id)
);

CREATE INDEX idx_conn_req_event_requester ON connection_requests(event_id, requester_id);
CREATE INDEX idx_conn_req_event_recipient ON connection_requests(event_id, recipient_id);

-- RLS: connection_requests
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: only the two parties may see the request
CREATE POLICY "connection_requests: parties read"
  ON connection_requests FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

-- INSERT: requester must be caller; caller must be in event; recipient must be discoverable
CREATE POLICY "connection_requests: validated insert"
  ON connection_requests FOR INSERT
  WITH CHECK (
    auth.uid() = requester_id
    AND EXISTS (
      SELECT 1 FROM event_participants
      WHERE event_id = connection_requests.event_id
        AND user_id  = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM event_participants
      WHERE event_id       = connection_requests.event_id
        AND user_id        = connection_requests.recipient_id
        AND is_discoverable = TRUE
    )
  );

-- UPDATE: requester may withdraw
CREATE POLICY "connection_requests: requester update"
  ON connection_requests FOR UPDATE
  USING (auth.uid() = requester_id)
  WITH CHECK (auth.uid() = requester_id);

-- ============================================================
-- TABLE: matches
-- Created exclusively via detect_mutual_match() SECURITY DEFINER.
-- ============================================================
CREATE TABLE matches (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_a_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Canonical ordering enforced at insert time: user_a < user_b
  UNIQUE (event_id, user_a_id, user_b_id)
);

CREATE INDEX idx_matches_event ON matches(event_id);

-- RLS: matches — parties read only; no client writes
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches: parties read"
  ON matches FOR SELECT
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- ============================================================
-- FUNCTION: detect_mutual_match
-- SECURITY DEFINER — elevated to bypass client RLS for match insert.
-- Called by connection.service.ts after a successful request insert.
-- ============================================================
CREATE OR REPLACE FUNCTION detect_mutual_match(
  p_event_id     UUID,
  p_requester_id UUID,
  p_recipient_id UUID
)
RETURNS TABLE (
  id         UUID,
  event_id   UUID,
  user_a_id  UUID,
  user_b_id  UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
BEGIN
  -- Check for reciprocal pending request
  IF NOT EXISTS (
    SELECT 1 FROM connection_requests cr
    WHERE cr.event_id     = p_event_id
      AND cr.requester_id = p_recipient_id
      AND cr.recipient_id = p_requester_id
      AND cr.status       = 'pending'
  ) THEN
    RETURN; -- No match, return empty
  END IF;

  -- Apply canonical ordering (lower UUID first)
  IF p_requester_id < p_recipient_id THEN
    v_user_a := p_requester_id;
    v_user_b := p_recipient_id;
  ELSE
    v_user_a := p_recipient_id;
    v_user_b := p_requester_id;
  END IF;

  -- Idempotent insert
  INSERT INTO matches (event_id, user_a_id, user_b_id)
  VALUES (p_event_id, v_user_a, v_user_b)
  ON CONFLICT (event_id, user_a_id, user_b_id) DO NOTHING;

  -- Return the match row (existing or newly created)
  RETURN QUERY
    SELECT m.id, m.event_id, m.user_a_id, m.user_b_id, m.created_at
    FROM matches m
    WHERE m.event_id  = p_event_id
      AND m.user_a_id = v_user_a
      AND m.user_b_id = v_user_b;
END;
$$;
