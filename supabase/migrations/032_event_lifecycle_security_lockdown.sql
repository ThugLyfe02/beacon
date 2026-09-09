-- =============================================================================
-- 032_event_lifecycle_security_lockdown.sql
-- Database-authoritative lifecycle and SECURITY DEFINER hardening.
--
-- Security goals:
--   * Established events are never deleted as a normal lifecycle operation.
--   * Live-only mutations fail closed after the event window or finalization.
--   * SECURITY DEFINER functions restate the invariants RLS would otherwise
--     provide, and legacy direct-call bypasses lose PUBLIC execution.
--   * Join/access secrets are never returned by pre-membership lookup RPCs.
--   * Spatial presence keeps immersive distance/bearing while raw peer GPS
--     coordinates no longer cross the client boundary used by the 3D field.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Canonical lifecycle predicates. These intentionally expose only a boolean;
-- callers cannot use them to enumerate event metadata.
-- ---------------------------------------------------------------------------
create or replace function public.event_accepts_join_requests(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.finalized_at is null
      and (e.ends_at is null or e.ends_at > now())
  );
$$;

create or replace function public.event_accepts_live_actions(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.finalized_at is null
      and (e.starts_at is null or e.starts_at <= now())
      and (e.ends_at is null or e.ends_at > now())
  );
$$;

create or replace function public.event_is_unfinalized(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.finalized_at is null
  );
$$;

revoke all on function public.event_accepts_join_requests(uuid) from public;
revoke all on function public.event_accepts_live_actions(uuid) from public;
revoke all on function public.event_is_unfinalized(uuid) from public;
grant execute on function public.event_accepts_join_requests(uuid) to authenticated;
grant execute on function public.event_accepts_live_actions(uuid) to authenticated;
grant execute on function public.event_is_unfinalized(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Event deletion/update lockdown.
-- Successful event creation always creates a host participant row. Therefore a
-- service/admin can still compensate an event that never finished creation, but
-- any established event becomes append/archive oriented rather than deletable.
-- ---------------------------------------------------------------------------
drop policy if exists "events: host delete" on public.events;
revoke delete on table public.events from authenticated;
revoke delete on table public.events from anon;

create or replace function public.prevent_established_event_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.finalized_at is not null
     or exists (
       select 1 from public.event_participants ep where ep.event_id = old.id
     )
     or exists (
       select 1 from public.connection_requests cr where cr.event_id = old.id
     )
     or exists (
       select 1 from public.matches m where m.event_id = old.id
     )
     or exists (
       select 1 from public.event_outcome_snapshots s where s.event_id = old.id
     ) then
    raise exception 'Established event history is immutable and cannot be deleted; finalize/archive the event instead';
  end if;
  return old;
end;
$$;

drop trigger if exists prevent_established_event_delete on public.events;
create trigger prevent_established_event_delete
before delete on public.events
for each row execute function public.prevent_established_event_delete();

-- Direct host updates are allowed only before the live window closes. The
-- SECURITY DEFINER finalization RPC bypasses RLS and is the only supported path
-- that can move an event into finalized_at.
drop policy if exists "events: host update" on public.events;
create policy "events: host update live only"
on public.events for update
to authenticated
using (
  auth.uid() = host_id
  and finalized_at is null
  and (ends_at is null or ends_at > now())
)
with check (
  auth.uid() = host_id
  and finalized_at is null
  and (ends_at is null or ends_at > now())
);

-- ---------------------------------------------------------------------------
-- Participant lifecycle. Joining/approval/leaving must stop at the event end so
-- the participant set used by final outcome intelligence cannot be rewritten.
-- ---------------------------------------------------------------------------
drop policy if exists "event_participants: request join" on public.event_participants;
create policy "event_participants: request join open event"
on public.event_participants for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "event_participants: host update status" on public.event_participants;
create policy "event_participants: host update open event"
on public.event_participants for update
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
)
with check (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "event_participants: host delete" on public.event_participants;
drop policy if exists "event_participants: self leave" on public.event_participants;
create policy "event_participants: self leave open event"
on public.event_participants for delete
to authenticated
using (
  auth.uid() = user_id
  and public.event_accepts_join_requests(event_id)
);

-- ---------------------------------------------------------------------------
-- High-impact direct table mutation bypasses. Modern clients use atomic secure
-- RPCs; remove direct INSERT capability so a modified client cannot skip nonce,
-- security-mode, block, scarcity, or eligibility checks.
-- ---------------------------------------------------------------------------
drop policy if exists "connection_requests: validated insert" on public.connection_requests;
revoke insert on table public.connection_requests from authenticated;
revoke insert on table public.connection_requests from anon;

drop policy if exists "oh_requests_insert_requester" on public.office_hours_requests;
revoke insert on table public.office_hours_requests from authenticated;
revoke insert on table public.office_hours_requests from anon;

-- Request withdrawal is a live-field action. Once the live window ends, preserve
-- it as evidence rather than allowing late mutation before finalization.
drop policy if exists "connection_requests: requester update" on public.connection_requests;
create policy "connection_requests: requester update live event"
on public.connection_requests for update
to authenticated
using (
  auth.uid() = requester_id
  and public.event_accepts_live_actions(event_id)
)
with check (
  auth.uid() = requester_id
  and public.event_accepts_live_actions(event_id)
);

-- Existing Office Hours may resolve after the scheduled window but never after
-- the host seals final outcomes.
drop policy if exists "oh_requests_update_party" on public.office_hours_requests;
create policy "oh_requests_update_party unfinalized"
on public.office_hours_requests for update
to authenticated
using (
  (auth.uid() = requester_id or auth.uid() = recipient_id)
  and public.event_is_unfinalized(event_id)
)
with check (
  (auth.uid() = requester_id or auth.uid() = recipient_id)
  and public.event_is_unfinalized(event_id)
);

-- ---------------------------------------------------------------------------
-- Trigger-level invariants apply even inside SECURITY DEFINER functions where
-- table RLS is bypassed. This is the critical second line of defense.
-- ---------------------------------------------------------------------------
create or replace function public.guard_connection_request_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.event_accepts_live_actions(new.event_id) then
    raise exception 'Event is not accepting live connection signals';
  end if;
  if auth.uid() is null or new.requester_id <> auth.uid() then
    raise exception 'Connection requester must be the authenticated actor';
  end if;
  if new.requester_id = new.recipient_id then
    raise exception 'Cannot signal yourself';
  end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id
      and ep.user_id = new.requester_id
      and ep.status = 'approved'
  ) or not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id
      and ep.user_id = new.recipient_id
      and ep.status = 'approved'
  ) then
    raise exception 'Both users must be approved event participants';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_connection_request_write on public.connection_requests;
create trigger guard_connection_request_write
before insert on public.connection_requests
for each row execute function public.guard_connection_request_write();

create or replace function public.guard_match_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.event_accepts_live_actions(new.event_id) then
    raise exception 'Event is not accepting new mutual matches';
  end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id and ep.user_id = new.user_a_id and ep.status = 'approved'
  ) or not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id and ep.user_id = new.user_b_id and ep.status = 'approved'
  ) then
    raise exception 'Mutual participants must both be approved';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_match_insert on public.matches;
create trigger guard_match_insert
before insert on public.matches
for each row execute function public.guard_match_insert();

create or replace function public.guard_office_hours_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.event_accepts_live_actions(new.event_id) then
    raise exception 'Event is not accepting new Office Hours requests';
  end if;
  if auth.uid() is null or new.requester_id <> auth.uid() then
    raise exception 'Office Hours requester must be the authenticated actor';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and coalesce(u.is_premium, false) = true
  ) then
    raise exception 'Premium access required for Office Hours';
  end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id and ep.user_id = new.requester_id and ep.status = 'approved'
  ) or not exists (
    select 1 from public.event_participants ep
    where ep.event_id = new.event_id and ep.user_id = new.recipient_id and ep.status = 'approved'
  ) then
    raise exception 'Both Office Hours parties must be approved event participants';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_office_hours_insert on public.office_hours_requests;
create trigger guard_office_hours_insert
before insert on public.office_hours_requests
for each row execute function public.guard_office_hours_insert();

create or replace function public.guard_signal_budget_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.event_accepts_live_actions(new.event_id) then
    raise exception 'Signal budget cannot mutate outside the live event window';
  end if;
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Signal budget owner must be the authenticated actor';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_signal_budget_write on public.event_signal_budgets;
create trigger guard_signal_budget_write
before insert or update on public.event_signal_budgets
for each row execute function public.guard_signal_budget_write();

create or replace function public.guard_access_drop_claim_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  select d.event_id into v_event_id
  from public.access_drop_windows d
  where d.id = new.drop_id;

  if v_event_id is null or not public.event_accepts_live_actions(v_event_id) then
    raise exception 'Access Drop is outside the live event window';
  end if;
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Access Drop claimant must be the authenticated actor';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_access_drop_claim_insert on public.access_drop_claims;
create trigger guard_access_drop_claim_insert
before insert on public.access_drop_claims
for each row execute function public.guard_access_drop_claim_insert();

-- ---------------------------------------------------------------------------
-- Freeze host-controlled live configuration after the event window. Reads remain
-- available for archive/reflection surfaces.
-- ---------------------------------------------------------------------------
drop policy if exists "role_attestations_manage_host" on public.event_role_attestations;
create policy "role_attestations_manage_host open event"
on public.event_role_attestations for all
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
)
with check (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "drops_manage_event_host" on public.access_drop_windows;
create policy "drops_manage_event_host open event"
on public.access_drop_windows for all
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
)
with check (
  public.is_event_host(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "vip_settings_insert_own" on public.vip_visibility_settings;
create policy "vip_settings_insert_own open event"
on public.vip_visibility_settings for insert
to authenticated
with check (
  auth.uid() = user_id
  and public.is_approved_participant(event_id, auth.uid())
  and public.event_accepts_join_requests(event_id)
);

drop policy if exists "vip_settings_update_own" on public.vip_visibility_settings;
create policy "vip_settings_update_own open event"
on public.vip_visibility_settings for update
to authenticated
using (
  auth.uid() = user_id
  and public.event_accepts_join_requests(event_id)
)
with check (
  auth.uid() = user_id
  and public.event_accepts_join_requests(event_id)
);

-- ---------------------------------------------------------------------------
-- Outcome snapshots after the live clock may only be produced by the atomic
-- finalization transaction. This prevents a host from training venue memory via
-- the generic diagnostic snapshot RPC without actually sealing the event.
-- ---------------------------------------------------------------------------
create or replace function public.guard_final_outcome_snapshot_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event public.events;
  v_finalization_marker text;
begin
  select * into v_event from public.events e where e.id = new.event_id;
  v_finalization_marker := current_setting('beacon.finalization_event_id', true);

  if v_event.id is null then
    raise exception 'Outcome snapshot event not found';
  end if;

  if (
    v_event.finalized_at is not null
    or (v_event.ends_at is not null and v_event.ends_at <= now())
  ) and v_finalization_marker is distinct from new.event_id::text then
    raise exception 'Post-window outcome snapshots require atomic event finalization';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_final_outcome_snapshot_insert on public.event_outcome_snapshots;
create trigger guard_final_outcome_snapshot_insert
before insert on public.event_outcome_snapshots
for each row execute function public.guard_final_outcome_snapshot_insert();

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER execution lockdown. PostgreSQL grants EXECUTE to PUBLIC on
-- new functions by default; revoking only `authenticated` is insufficient because
-- authenticated users still inherit PUBLIC. Keep only intended RPC surfaces.
-- ---------------------------------------------------------------------------
revoke all on function public.detect_mutual_match(uuid, uuid, uuid) from public;
revoke all on function public.consume_signal_budget(uuid, uuid) from public;
revoke all on function public.get_or_create_signal_budget(uuid, smallint) from public;
revoke all on function public.claim_access_drop(uuid) from public;
revoke all on function public.prune_security_control_plane() from public;
revoke all on function public.get_event_proximity_signals(uuid) from public;
revoke all on function public.get_nearby_premium(uuid) from public;

revoke execute on function public.detect_mutual_match(uuid, uuid, uuid) from authenticated;
revoke execute on function public.consume_signal_budget(uuid, uuid) from authenticated;
revoke execute on function public.get_or_create_signal_budget(uuid, smallint) from authenticated;
revoke execute on function public.claim_access_drop(uuid) from authenticated;
revoke execute on function public.prune_security_control_plane() from authenticated;
revoke execute on function public.get_event_proximity_signals(uuid) from authenticated;
revoke execute on function public.get_nearby_premium(uuid) from authenticated;

-- Revoke PUBLIC from the modern mutation wrappers too, then explicitly grant the
-- authenticated surface. This prevents anonymous execution from relying on
-- incidental auth.uid() failure behavior.
revoke all on function public.secure_send_connection_request(uuid, uuid, text) from public;
grant execute on function public.secure_send_connection_request(uuid, uuid, text) to authenticated;
revoke all on function public.secure_consume_signal_budget(uuid, uuid, text) from public;
grant execute on function public.secure_consume_signal_budget(uuid, uuid, text) to authenticated;
revoke all on function public.secure_claim_access_drop(uuid, text) from public;
grant execute on function public.secure_claim_access_drop(uuid, text) to authenticated;
revoke all on function public.secure_create_office_hours_request(uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.secure_create_office_hours_request(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Join-code lookup: preserve the existing return contract while never returning
-- the access secret itself. Ended/finalized events stop resolving by join code.
-- ---------------------------------------------------------------------------
create or replace function public.get_event_by_join_code(p_join_code text)
returns table (
  id uuid,
  host_id uuid,
  name text,
  description text,
  join_code text,
  location_type public.location_type,
  latitude numeric,
  longitude numeric,
  address text,
  requires_approval boolean,
  access_code text,
  show_participant_count boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
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
    null::text as access_code,
    e.show_participant_count,
    e.starts_at,
    e.ends_at,
    e.created_at
  from public.events e
  where e.join_code = upper(trim(p_join_code))
    and e.finalized_at is null
    and (e.ends_at is null or e.ends_at > now())
  limit 1;
end;
$$;
revoke all on function public.get_event_by_join_code(text) from public;
grant execute on function public.get_event_by_join_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Join RPCs: caller identity is authoritative; an access code cannot approve an
-- arbitrary p_user_id supplied by a modified client.
-- ---------------------------------------------------------------------------
create or replace function public.request_to_join_event(p_event_id uuid)
returns public.event_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requires_approval boolean;
  v_existing public.event_participants;
  v_result public.event_participants;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.event_accepts_join_requests(p_event_id) then
    raise exception 'Event is no longer accepting join requests';
  end if;

  select requires_approval into v_requires_approval
  from public.events where id = p_event_id;
  if not found then raise exception 'Event not found'; end if;

  select * into v_existing
  from public.event_participants
  where event_id = p_event_id and user_id = auth.uid();
  if found then return v_existing; end if;

  insert into public.event_participants (event_id, user_id, status)
  values (
    p_event_id,
    auth.uid(),
    case when v_requires_approval then 'pending' else 'approved' end
  )
  returning * into v_result;

  return v_result;
end;
$$;
revoke all on function public.request_to_join_event(uuid) from public;
grant execute on function public.request_to_join_event(uuid) to authenticated;

create table if not exists public.event_access_code_attempts (
  actor_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null,
  primary key (actor_id, event_id, attempted_at)
);
create index if not exists event_access_code_attempts_actor_window_idx
  on public.event_access_code_attempts (actor_id, event_id, attempted_at desc);
alter table public.event_access_code_attempts enable row level security;
-- No client policies: attempts are written only by the controlled RPC below.

create or replace function public.approve_participant_with_code(
  p_event_id uuid,
  p_user_id uuid,
  p_access_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_code text;
  v_recent_failures integer;
  v_success boolean := false;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Access-code approval may only target the authenticated user';
  end if;
  if not public.event_accepts_join_requests(p_event_id) then
    raise exception 'Event is no longer accepting join requests';
  end if;

  select count(*) into v_recent_failures
  from public.event_access_code_attempts a
  where a.actor_id = auth.uid()
    and a.event_id = p_event_id
    and a.succeeded = false
    and a.attempted_at > now() - interval '10 minutes';

  if v_recent_failures >= 8 then
    raise exception 'Too many invalid access-code attempts; try again later';
  end if;

  select e.access_code into v_event_code
  from public.events e
  where e.id = p_event_id;

  v_success := v_event_code is not null
    and nullif(trim(p_access_code), '') is not null
    and v_event_code = trim(p_access_code);

  insert into public.event_access_code_attempts (actor_id, event_id, succeeded)
  values (auth.uid(), p_event_id, v_success);

  if not v_success then return false; end if;

  update public.event_participants
  set status = 'approved'
  where event_id = p_event_id
    and user_id = auth.uid()
    and status = 'pending';

  return found;
end;
$$;
revoke all on function public.approve_participant_with_code(uuid, uuid, text) from public;
grant execute on function public.approve_participant_with_code(uuid, uuid, text) to authenticated;

create or replace function public.get_my_pending_requests()
returns table (
  participant_id uuid,
  event_id uuid,
  event_name text,
  joined_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select ep.id, ep.event_id, e.name, ep.joined_at
  from public.event_participants ep
  join public.events e on e.id = ep.event_id
  where ep.user_id = auth.uid()
    and ep.status = 'pending'
    and e.finalized_at is null
    and (e.ends_at is null or e.ends_at > now())
  order by ep.joined_at desc;
$$;
revoke all on function public.get_my_pending_requests() from public;
grant execute on function public.get_my_pending_requests() to authenticated;

-- Public discovery profiles never need attendee email addresses. Preserve RPC
-- column compatibility by returning NULL for email rather than widening users RLS.
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
begin
  if auth.uid() is null or not (
    public.is_event_host(p_event_id, auth.uid())
    or public.is_approved_participant(p_event_id, auth.uid())
  ) then
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
  order by ep.joined_at desc;
end;
$$;
revoke all on function public.get_event_approved_participants(uuid, uuid) from public;
grant execute on function public.get_event_approved_participants(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Social definer repair: toggle_post_like must independently enforce the post's
-- event visibility because SECURITY DEFINER bypasses post/post_like RLS.
-- ---------------------------------------------------------------------------
create or replace function public.toggle_post_like(p_post_id uuid)
returns table (liked boolean, like_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts;
  v_exists boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_post from public.posts p where p.id = p_post_id;
  if v_post.id is null then raise exception 'Post not found'; end if;

  if v_post.event_id is not null and not public.is_approved_participant(v_post.event_id, auth.uid()) then
    raise exception 'Post is not visible to the current user';
  end if;

  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = auth.uid() and ub.blocked_id = v_post.author_id)
       or (ub.blocker_id = v_post.author_id and ub.blocked_id = auth.uid())
  ) then
    raise exception 'Post is not available';
  end if;

  select exists (
    select 1 from public.post_likes pl
    where pl.post_id = p_post_id and pl.user_id = auth.uid()
  ) into v_exists;

  if v_exists then
    delete from public.post_likes where post_id = p_post_id and user_id = auth.uid();
  else
    insert into public.post_likes (post_id, user_id) values (p_post_id, auth.uid());
  end if;

  return query
  select not v_exists,
         (select count(*)::int from public.post_likes where post_id = p_post_id);
end;
$$;
revoke all on function public.toggle_post_like(uuid) from public;
grant execute on function public.toggle_post_like(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Adaptive privacy-resolution proximity vectors for the immersive 3D field.
-- Distance/bearing are calculated server-side from stored fixes, dynamically
-- quantized by range, and raw peer coordinates never leave this RPC.
-- ---------------------------------------------------------------------------
create or replace function public.get_event_proximity_vectors(p_event_id uuid)
returns table (
  user_id uuid,
  is_premium boolean,
  distance_m double precision,
  bearing_deg double precision,
  last_location_at timestamptz,
  avatar_url_3d text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_last_location_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.event_accepts_live_actions(p_event_id) then return; end if;
  if not public.is_approved_participant(p_event_id, auth.uid()) then return; end if;

  select u.last_known_lat, u.last_known_lng, u.last_location_at
  into v_lat, v_lng, v_last_location_at
  from public.users u
  where u.id = auth.uid() and coalesce(u.is_discoverable, false) = true;

  if v_lat is null or v_lng is null
     or v_last_location_at is null
     or v_last_location_at <= now() - interval '5 minutes' then
    return;
  end if;

  return query
  with raw as (
    select
      u.id,
      u.is_premium,
      u.last_location_at,
      u.avatar_url_3d,
      2 * 6371000 * asin(sqrt(
        power(sin(radians(u.last_known_lat - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(u.last_known_lat))
          * power(sin(radians(u.last_known_lng - v_lng) / 2), 2)
      )) as raw_distance,
      mod(
        (degrees(atan2(
          sin(radians(u.last_known_lng - v_lng)) * cos(radians(u.last_known_lat)),
          cos(radians(v_lat)) * sin(radians(u.last_known_lat))
            - sin(radians(v_lat)) * cos(radians(u.last_known_lat))
              * cos(radians(u.last_known_lng - v_lng))
        )) + 360)::numeric,
        360::numeric
      )::double precision as raw_bearing
    from public.event_participants ep
    join public.users u on u.id = ep.user_id
    where ep.event_id = p_event_id
      and ep.status = 'approved'
      and u.id <> auth.uid()
      and coalesce(u.is_discoverable, false) = true
      and u.last_known_lat is not null
      and u.last_known_lng is not null
      and u.last_location_at > now() - interval '5 minutes'
      and not exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id = auth.uid() and ub.blocked_id = u.id)
           or (ub.blocker_id = u.id and ub.blocked_id = auth.uid())
      )
  )
  select
    r.id,
    r.is_premium,
    case
      when r.raw_distance <= 15
        then (round((r.raw_distance * 2)::numeric) / 2)::double precision
      else (round((r.raw_distance / 2)::numeric) * 2)::double precision
    end,
    case
      when r.raw_distance <= 15
        then mod(round((r.raw_bearing / 2)::numeric) * 2, 360)::double precision
      else mod(round((r.raw_bearing / 5)::numeric) * 5, 360)::double precision
    end,
    r.last_location_at,
    r.avatar_url_3d
  from raw r
  order by r.raw_distance asc;
end;
$$;
revoke all on function public.get_event_proximity_vectors(uuid) from public;
grant execute on function public.get_event_proximity_vectors(uuid) to authenticated;

-- Legacy premium radar/map endpoint remains available only through a hardened,
-- live-event, block-aware, reduced-precision contract. It no longer returns raw
-- GPS precision even though the historical return shape is preserved.
create or replace function public.get_nearby_premium(p_event_id uuid)
returns table (
  user_id uuid,
  name text,
  role text,
  one_liner text,
  latitude double precision,
  longitude double precision,
  distance_m double precision,
  bearing_deg double precision,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_premium boolean;
  v_discoverable boolean;
begin
  if auth.uid() is null or not public.event_accepts_live_actions(p_event_id) then return; end if;

  select u.is_premium, u.is_discoverable, u.last_known_lat, u.last_known_lng
  into v_premium, v_discoverable, v_lat, v_lng
  from public.users u where u.id = auth.uid();

  if not coalesce(v_premium, false) or not coalesce(v_discoverable, false)
     or v_lat is null or v_lng is null
     or not public.is_approved_participant(p_event_id, auth.uid()) then
    return;
  end if;

  return query
  with raw as (
    select
      u.id, u.name, u.role, u.one_liner,
      u.last_known_lat, u.last_known_lng, u.last_location_at,
      2 * 6371000 * asin(sqrt(
        power(sin(radians(u.last_known_lat - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(u.last_known_lat))
          * power(sin(radians(u.last_known_lng - v_lng) / 2), 2)
      )) as raw_distance,
      mod(
        (degrees(atan2(
          sin(radians(u.last_known_lng - v_lng)) * cos(radians(u.last_known_lat)),
          cos(radians(v_lat)) * sin(radians(u.last_known_lat))
            - sin(radians(v_lat)) * cos(radians(u.last_known_lat))
              * cos(radians(u.last_known_lng - v_lng))
        )) + 360)::numeric,
        360::numeric
      )::double precision as raw_bearing
    from public.event_participants ep
    join public.users u on u.id = ep.user_id
    where ep.event_id = p_event_id
      and ep.status = 'approved'
      and u.id <> auth.uid()
      and coalesce(u.is_premium, false) = true
      and coalesce(u.is_discoverable, false) = true
      and u.last_known_lat is not null
      and u.last_known_lng is not null
      and u.last_location_at > now() - interval '5 minutes'
      and not exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id = auth.uid() and ub.blocked_id = u.id)
           or (ub.blocker_id = u.id and ub.blocked_id = auth.uid())
      )
  )
  select
    r.id,
    r.name,
    r.role,
    r.one_liner,
    round(r.last_known_lat::numeric, 4)::double precision,
    round(r.last_known_lng::numeric, 4)::double precision,
    (round((r.raw_distance / 5)::numeric) * 5)::double precision,
    mod(round((r.raw_bearing / 5)::numeric) * 5, 360)::double precision,
    r.last_location_at
  from raw r
  order by r.raw_distance asc;
end;
$$;
revoke all on function public.get_nearby_premium(uuid) from public;
grant execute on function public.get_nearby_premium(uuid) to authenticated;

comment on function public.get_event_proximity_vectors(uuid) is
  'Live-event proximity surface for the 3D field. Returns adaptive distance/bearing vectors without exposing raw peer coordinates.';
comment on function public.event_accepts_live_actions(uuid) is
  'Canonical database boundary for mutations and spatial reveals that only exist during the live event window.';
