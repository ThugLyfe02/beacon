-- detect_mutual_match (introduced in 001) declared its OUT columns as
-- (id, event_id, user_a_id, user_b_id, created_at) — which Postgres puts
-- in scope of the function body. That makes the INSERT's ON CONFLICT
-- column list ambiguous between the OUT alias and the matches table.
-- Rename the OUT columns with an `out_` prefix so the INSERT below is
-- unambiguous; callers that select * still work because they don't
-- reference column names.

DROP FUNCTION IF EXISTS detect_mutual_match(UUID, UUID, UUID);

CREATE FUNCTION detect_mutual_match(
  p_event_id     UUID,
  p_requester_id UUID,
  p_recipient_id UUID
)
RETURNS TABLE (
  out_id         UUID,
  out_event_id   UUID,
  out_user_a_id  UUID,
  out_user_b_id  UUID,
  out_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM connection_requests cr
    WHERE cr.event_id     = p_event_id
      AND cr.requester_id = p_recipient_id
      AND cr.recipient_id = p_requester_id
      AND cr.status       = 'pending'
  ) THEN
    RETURN;
  END IF;

  IF p_requester_id < p_recipient_id THEN
    v_user_a := p_requester_id;
    v_user_b := p_recipient_id;
  ELSE
    v_user_a := p_recipient_id;
    v_user_b := p_requester_id;
  END IF;

  INSERT INTO matches (event_id, user_a_id, user_b_id)
  VALUES (p_event_id, v_user_a, v_user_b)
  ON CONFLICT (event_id, user_a_id, user_b_id) DO NOTHING;

  RETURN QUERY
    SELECT m.id, m.event_id, m.user_a_id, m.user_b_id, m.created_at
    FROM matches m
    WHERE m.event_id  = p_event_id
      AND m.user_a_id = v_user_a
      AND m.user_b_id = v_user_b;
END;
$$;
