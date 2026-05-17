-- =============================================================================
-- Beacon — Social feed (posts, follows, likes)
-- Two feed modes:
--   * global: posts where event_id IS NULL
--   * event:  posts scoped to an event (visible only to approved participants)
-- =============================================================================

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS posts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  image_path  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_event_created  ON posts (event_id, created_at DESC) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_global_created ON posts (created_at DESC) WHERE event_id IS NULL;

DROP TRIGGER IF EXISTS posts_updated_at ON posts;
CREATE TRIGGER posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows (followed_id);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE posts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

-- posts: anyone can read global posts; event posts only by approved participants
DROP POLICY IF EXISTS "posts_read" ON posts;
CREATE POLICY "posts_read" ON posts FOR SELECT USING (
  event_id IS NULL
  OR EXISTS (
    SELECT 1 FROM event_participants ep
     WHERE ep.event_id = posts.event_id
       AND ep.user_id  = auth.uid()
       AND ep.status   = 'approved'
  )
);

DROP POLICY IF EXISTS "posts_insert_own" ON posts;
CREATE POLICY "posts_insert_own" ON posts FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND (
      event_id IS NULL
      OR EXISTS (
        SELECT 1 FROM event_participants ep
         WHERE ep.event_id = posts.event_id
           AND ep.user_id  = auth.uid()
           AND ep.status   = 'approved'
      )
    )
  );

DROP POLICY IF EXISTS "posts_update_own" ON posts;
CREATE POLICY "posts_update_own" ON posts FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "posts_delete_own" ON posts;
CREATE POLICY "posts_delete_own" ON posts FOR DELETE USING (author_id = auth.uid());

-- follows: anyone can read who follows whom; users manage their own follows
DROP POLICY IF EXISTS "follows_read" ON follows;
CREATE POLICY "follows_read" ON follows FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "follows_insert_own" ON follows;
CREATE POLICY "follows_insert_own" ON follows FOR INSERT
  WITH CHECK (follower_id = auth.uid());

DROP POLICY IF EXISTS "follows_delete_own" ON follows;
CREATE POLICY "follows_delete_own" ON follows FOR DELETE USING (follower_id = auth.uid());

-- post_likes: anyone can read counts; users manage their own likes on posts they can read
DROP POLICY IF EXISTS "post_likes_read" ON post_likes;
CREATE POLICY "post_likes_read" ON post_likes FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "post_likes_insert_own" ON post_likes;
CREATE POLICY "post_likes_insert_own" ON post_likes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM posts p
       WHERE p.id = post_likes.post_id
         AND (
           p.event_id IS NULL
           OR EXISTS (
             SELECT 1 FROM event_participants ep
              WHERE ep.event_id = p.event_id
                AND ep.user_id  = auth.uid()
                AND ep.status   = 'approved'
           )
         )
    )
  );

DROP POLICY IF EXISTS "post_likes_delete_own" ON post_likes;
CREATE POLICY "post_likes_delete_own" ON post_likes FOR DELETE USING (user_id = auth.uid());

-- ─── Feed functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_home_feed(p_limit INT DEFAULT 50, p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  id            UUID,
  author_id     UUID,
  event_id      UUID,
  body          TEXT,
  image_path    TEXT,
  created_at    TIMESTAMPTZ,
  author_name   TEXT,
  author_role   TEXT,
  author_is_premium BOOLEAN,
  like_count    INT,
  viewer_liked  BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.author_id,
    p.event_id,
    p.body,
    p.image_path,
    p.created_at,
    u.name        AS author_name,
    u.role        AS author_role,
    u.is_premium  AS author_is_premium,
    COALESCE(lc.cnt, 0)::INT  AS like_count,
    EXISTS (
      SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
    ) AS viewer_liked
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt FROM post_likes pl WHERE pl.post_id = p.id
  ) lc ON TRUE
  WHERE p.event_id IS NULL
    AND (
      p.author_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM follows f
         WHERE f.follower_id = auth.uid()
           AND f.followed_id = p.author_id
      )
    )
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY p.created_at DESC
  LIMIT LEAST(p_limit, 100);
$$;

GRANT EXECUTE ON FUNCTION get_home_feed(INT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION get_event_feed(
  p_event_id UUID,
  p_limit    INT DEFAULT 50,
  p_before   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  author_id     UUID,
  event_id      UUID,
  body          TEXT,
  image_path    TEXT,
  created_at    TIMESTAMPTZ,
  author_name   TEXT,
  author_role   TEXT,
  author_is_premium BOOLEAN,
  like_count    INT,
  viewer_liked  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- caller must be an approved participant
  IF NOT EXISTS (
    SELECT 1 FROM event_participants ep
     WHERE ep.event_id = p_event_id
       AND ep.user_id  = auth.uid()
       AND ep.status   = 'approved'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.author_id,
    p.event_id,
    p.body,
    p.image_path,
    p.created_at,
    u.name        AS author_name,
    u.role        AS author_role,
    u.is_premium  AS author_is_premium,
    COALESCE(lc.cnt, 0)::INT  AS like_count,
    EXISTS (
      SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
    ) AS viewer_liked
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt FROM post_likes pl WHERE pl.post_id = p.id
  ) lc ON TRUE
  WHERE p.event_id = p_event_id
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY p.created_at DESC
  LIMIT LEAST(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION get_event_feed(UUID, INT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION get_user_posts(
  p_user_id UUID,
  p_limit   INT DEFAULT 50,
  p_before  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  author_id     UUID,
  event_id      UUID,
  body          TEXT,
  image_path    TEXT,
  created_at    TIMESTAMPTZ,
  author_name   TEXT,
  author_role   TEXT,
  author_is_premium BOOLEAN,
  like_count    INT,
  viewer_liked  BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only returns posts the viewer is allowed to see (global posts +
  -- event posts where the viewer is an approved participant of the event).
  SELECT
    p.id,
    p.author_id,
    p.event_id,
    p.body,
    p.image_path,
    p.created_at,
    u.name        AS author_name,
    u.role        AS author_role,
    u.is_premium  AS author_is_premium,
    COALESCE(lc.cnt, 0)::INT AS like_count,
    EXISTS (
      SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = auth.uid()
    ) AS viewer_liked
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt FROM post_likes pl WHERE pl.post_id = p.id
  ) lc ON TRUE
  WHERE p.author_id = p_user_id
    AND (
      p.event_id IS NULL
      OR EXISTS (
        SELECT 1 FROM event_participants ep
         WHERE ep.event_id = p.event_id
           AND ep.user_id  = auth.uid()
           AND ep.status   = 'approved'
      )
    )
    AND (p_before IS NULL OR p.created_at < p_before)
  ORDER BY p.created_at DESC
  LIMIT LEAST(p_limit, 100);
$$;

GRANT EXECUTE ON FUNCTION get_user_posts(UUID, INT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION toggle_post_like(p_post_id UUID)
RETURNS TABLE (liked BOOLEAN, like_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM post_likes
     WHERE post_id = p_post_id AND user_id = auth.uid()
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM post_likes WHERE post_id = p_post_id AND user_id = auth.uid();
  ELSE
    INSERT INTO post_likes (post_id, user_id) VALUES (p_post_id, auth.uid());
  END IF;

  RETURN QUERY
    SELECT NOT v_exists,
           (SELECT COUNT(*)::INT FROM post_likes WHERE post_id = p_post_id);
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_post_like(UUID) TO authenticated;

-- ─── Storage bucket: post-images ────────────────────────────────────────────
-- Public read; authors write to a path that starts with their auth.uid().
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', TRUE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "post_images_public_read" ON storage.objects;
CREATE POLICY "post_images_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'post-images');

DROP POLICY IF EXISTS "post_images_insert_own" ON storage.objects;
CREATE POLICY "post_images_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'post-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "post_images_delete_own" ON storage.objects;
CREATE POLICY "post_images_delete_own" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'post-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
