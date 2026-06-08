-- Beacon Presence Engine Tables

CREATE TABLE IF NOT EXISTS proximity_state (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  observer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  distance_bucket INT NOT NULL CHECK (distance_bucket BETWEEN 0 AND 3),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, observer_id, target_id)
);

CREATE TABLE IF NOT EXISTS office_hours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  premium_only BOOLEAN NOT NULL DEFAULT TRUE,
  capacity INT DEFAULT 5,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS missed_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  closest_bucket INT CHECK (closest_bucket BETWEEN 0 AND 3),
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);
