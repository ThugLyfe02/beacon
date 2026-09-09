-- =============================================================================
-- 033_security_definer_audit_closure.sql
-- Completes the legacy SECURITY DEFINER audit started by migration 032.
--
-- Principles:
--   * SECURITY DEFINER is a security perimeter, not an RLS shortcut.
--   * No callable function relies on PostgreSQL's default PUBLIC EXECUTE.
--   * Read RPCs disclose only fields required by the product surface.
--   * Block relationships are enforced consistently in direct RLS and feed RPCs.
--   * Host/security configuration freezes when the live event window closes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Privilege-helper functions are required by RLS, but anonymous callers should
-- not inherit EXECUTE through PUBLIC.
-- ---------------------------------------------------------------------------
revoke all on function public.is_user_in_event(uuid, uuid) from public;
grant execute on function public.is_user_in_event(uuid, uuid) to authenticated;
revoke all on function public.is_event_host(uuid, uuid) from public;
grant execute on function public.is_event_host(uuid, uuid) to authenticated;
revoke all on function public.is_approved_participant(uuid, uuid) from public;
grant execute on function public.is_approved_participant(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Security control-plane functions: authenticated callers get only the intended
-- online authorization surfaces. Maintenance pruning is service-role only.
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_event_security_controls(uuid) from public;
grant execute on function public.ensure_event_security_controls(uuid) to authenticated;

revoke all on function public.authorize_sensitive_action(
  uuid, public.security_action_kind, text, uuid, jsonb
) from public;
grant execute on function public.authorize_sensitive_action(
  uuid, public.security_action_kind, text, uuid, jsonb
) to authenticated;

revoke all on function public.prune_security_control_plane() from public;
revoke execute on function public.prune_security_control_plane() from authenticated;
grant execute on function public.prune_security_control_plane() to service_role;

-- Host-controlled security switches are live controls, not editable historical
-- evidence. Freeze them once the event window closes.
drop policy if exists "security_controls_host_insert" on public.event_security_controls;
create policy "security_controls_host_insert_open_event"
on public.event_security_controls for insert
to authenticated
with check (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "security_controls_host_update" on public.event_security_controls;
create policy "security_controls_host_update_open_event"
on public.event_security_controls for update
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
)
with check (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

-- ---------------------------------------------------------------------------
-- Outcome/provenance RPC privilege hygiene. Their internal authorization remains
-- authoritative; this removes accidental anonymous execution via PUBLIC.
-- ---------------------------------------------------------------------------
revoke all on function public.capture_event_outcome_snapshot(uuid) from public;
grant execute on function public.capture_event_outcome_snapshot(uuid) to authenticated;

revoke all on function public.get_outcome_handshake_state(uuid) from public;
grant execute on function public.get_outcome_handshake_state(uuid) to authenticated;

revoke all on function public.propose_outcome_handshake(
  uuid, public.outcome_intent, text, text
) from public;
grant execute on function public.propose_outcome_handshake(
  uuid, public.outcome_intent, text, text
) to authenticated;

revoke all on function public.complete_outcome_handshake(uuid) from public;
grant execute on function public.complete_outcome_handshake(uuid) to authenticated;

revoke all on function public.record_opportunity_decision_receipt(
  uuid, uuid, public.decision_domain, public.decision_outcome, text[], text,
  text, jsonb, jsonb, timestamptz
) from public;
grant execute on function public.record_opportunity_decision_receipt(
  uuid, uuid, public.decision_domain, public.decision_outcome, text[], text,
  text, jsonb, jsonb, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- Host pending-join lookup: the host can review the request identity/profile, but
-- email is not required by the current approval UI and is no longer disclosed.
-- ---------------------------------------------------------------------------
create or replace function public.get_pending_join_requests(p_event_id uuid)
returns table (
  participant_id uuid,
  user_id uuid,
  event_id uuid,
  joined_at timestamptz,
  name text,
  email text,
  role text,
  one_liner text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;

  return query
  select ep.id,
         ep.user_id,
         ep.event_id,
         ep.joined_at,
         u.name,
         null::text as email,
         u.role,
         u.one_liner
  from public.event_participants ep
  join public.users u on u.id = ep.user_id
  where ep.event_id = p_event_id
    and ep.status = 'pending'
  order by ep.joined_at desc;
end;
$$;
revoke all on function public.get_pending_join_requests(uuid) from public;
grant execute on function public.get_pending_join_requests(uuid) to authenticated;

-- Participant discovery is public-profile discovery, not an email directory.
-- Hosts retain full event visibility; ordinary participants do not receive users
-- with whom either party has an active block relationship.
create or replace function public.get_event_approved_participants(
  p_event_id uuid,
  p_exclude_user_id uuid default null
)
returns table (
  participant_id uuid,
  user_id uuid,
  event_id uuid,
  status text,
  joined_at timestamptz,
  email text,
  name text,
  role text,
  one_liner text,
  is_premium boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_host boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_is_host := public.is_event_host(p_event_id, auth.uid());

  if not (v_is_host or public.is_approved_participant(p_event_id, auth.uid())) then
    raise exception 'Not authorized';
  end if;

  return query
  select ep.id,
         ep.user_id,
         ep.event_id,
         ep.status::text,
         ep.joined_at,
         null::text as email,
         u.name,
         u.role,
         u.one_liner,
         coalesce(u.is_premium, false)
  from public.event_participants ep
  join public.users u on u.id = ep.user_id
  where ep.event_id = p_event_id
    and ep.status = 'approved'
    and (p_exclude_user_id is null or ep.user_id <> p_exclude_user_id)
    and (
      v_is_host
      or not exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id = auth.uid() and ub.blocked_id = ep.user_id)
           or (ub.blocker_id = ep.user_id and ub.blocked_id = auth.uid())
      )
    )
  order by ep.joined_at desc;
end;
$$;
revoke all on function public.get_event_approved_participants(uuid, uuid) from public;
grant execute on function public.get_event_approved_participants(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Social visibility: RLS and SECURITY DEFINER feeds now agree on block semantics.
-- ---------------------------------------------------------------------------
drop policy if exists "posts_read" on public.posts;
create policy "posts_read_visible_relationships"
on public.posts for select
to authenticated
using (
  (
    event_id is null
    or public.is_approved_participant(event_id, auth.uid())
  )
  and not exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = auth.uid() and ub.blocked_id = author_id)
       or (ub.blocker_id = author_id and ub.blocked_id = auth.uid())
  )
);

create or replace function public.get_home_feed(
  p_limit int default 50,
  p_before timestamptz default null
)
returns table (
  id uuid,
  author_id uuid,
  event_id uuid,
  body text,
  image_path text,
  created_at timestamptz,
  author_name text,
  author_role text,
  author_is_premium boolean,
  like_count int,
  viewer_liked boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  return query
  select p.id,
         p.author_id,
         p.event_id,
         p.body,
         p.image_path,
         p.created_at,
         u.name,
         u.role,
         u.is_premium,
         coalesce(lc.cnt, 0)::int,
         exists (
           select 1 from public.post_likes pl
           where pl.post_id = p.id and pl.user_id = auth.uid()
         )
  from public.posts p
  join public.users u on u.id = p.author_id
  left join lateral (
    select count(*) as cnt from public.post_likes pl where pl.post_id = p.id
  ) lc on true
  where p.event_id is null
    and (
      p.author_id = auth.uid()
      or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.followed_id = p.author_id
      )
    )
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = p.author_id)
         or (ub.blocker_id = p.author_id and ub.blocked_id = auth.uid())
    )
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;
revoke all on function public.get_home_feed(int, timestamptz) from public;
grant execute on function public.get_home_feed(int, timestamptz) to authenticated;

create or replace function public.get_event_feed(
  p_event_id uuid,
  p_limit int default 50,
  p_before timestamptz default null
)
returns table (
  id uuid,
  author_id uuid,
  event_id uuid,
  body text,
  image_path text,
  created_at timestamptz,
  author_name text,
  author_role text,
  author_is_premium boolean,
  like_count int,
  viewer_liked boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_approved_participant(p_event_id, auth.uid()) then
    return;
  end if;

  return query
  select p.id,
         p.author_id,
         p.event_id,
         p.body,
         p.image_path,
         p.created_at,
         u.name,
         u.role,
         u.is_premium,
         coalesce(lc.cnt, 0)::int,
         exists (
           select 1 from public.post_likes pl
           where pl.post_id = p.id and pl.user_id = auth.uid()
         )
  from public.posts p
  join public.users u on u.id = p.author_id
  left join lateral (
    select count(*) as cnt from public.post_likes pl where pl.post_id = p.id
  ) lc on true
  where p.event_id = p_event_id
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = p.author_id)
         or (ub.blocker_id = p.author_id and ub.blocked_id = auth.uid())
    )
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;
revoke all on function public.get_event_feed(uuid, int, timestamptz) from public;
grant execute on function public.get_event_feed(uuid, int, timestamptz) to authenticated;

create or replace function public.get_user_posts(
  p_user_id uuid,
  p_limit int default 50,
  p_before timestamptz default null
)
returns table (
  id uuid,
  author_id uuid,
  event_id uuid,
  body text,
  image_path text,
  created_at timestamptz,
  author_name text,
  author_role text,
  author_is_premium boolean,
  like_count int,
  viewer_liked boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  if p_user_id <> auth.uid() and exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = auth.uid() and ub.blocked_id = p_user_id)
       or (ub.blocker_id = p_user_id and ub.blocked_id = auth.uid())
  ) then
    return;
  end if;

  return query
  select p.id,
         p.author_id,
         p.event_id,
         p.body,
         p.image_path,
         p.created_at,
         u.name,
         u.role,
         u.is_premium,
         coalesce(lc.cnt, 0)::int,
         exists (
           select 1 from public.post_likes pl
           where pl.post_id = p.id and pl.user_id = auth.uid()
         )
  from public.posts p
  join public.users u on u.id = p.author_id
  left join lateral (
    select count(*) as cnt from public.post_likes pl where pl.post_id = p.id
  ) lc on true
  where p.author_id = p_user_id
    and (
      p.event_id is null
      or public.is_approved_participant(p.event_id, auth.uid())
    )
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;
revoke all on function public.get_user_posts(uuid, int, timestamptz) from public;
grant execute on function public.get_user_posts(uuid, int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Office Hours intake controls are live configuration. Existing request status
-- may settle while unfinalized, but intake policy cannot be rewritten post-window.
-- ---------------------------------------------------------------------------
drop policy if exists "office_hours_controls_manage_own" on public.office_hours_host_controls;
create policy "office_hours_controls_manage_own_open_event"
on public.office_hours_host_controls for all
to authenticated
using (
  auth.uid() = host_id
  and public.event_accepts_join_requests(event_id)
)
with check (
  auth.uid() = host_id
  and public.event_accepts_join_requests(event_id)
);

-- Ensure the development privilege-escalation stub stays unreachable even if a
-- future migration accidentally re-grants a role without revoking PUBLIC first.
revoke all on function public.set_premium_dev(boolean) from public;
revoke execute on function public.set_premium_dev(boolean) from authenticated;

comment on function public.get_pending_join_requests(uuid) is
  'Host-only pending request surface. Returns public profile context without exposing participant email.';
comment on function public.get_event_approved_participants(uuid, uuid) is
  'Event participant discovery surface with block filtering and no participant email disclosure.';
