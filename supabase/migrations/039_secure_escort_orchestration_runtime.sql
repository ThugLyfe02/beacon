-- =============================================================================
-- 039_secure_escort_orchestration_runtime.sql
-- Atomic, lifecycle-aware physical Office Hours orchestration.
-- Depends on migration 038 committing security_action_kind.escort_assignment.
-- =============================================================================

-- Room configuration is a live host concern. Retain attendee SELECT for assigned
-- room visibility, but remove direct mutation surfaces from mobile clients.
drop policy if exists "venue_rooms_host_all" on public.venue_rooms;
revoke insert, update, delete on table public.venue_rooms from authenticated;
revoke insert, update, delete on table public.venue_rooms from anon;

create unique index if not exists venue_rooms_event_label_unique
  on public.venue_rooms (event_id, lower(trim(label)));

create or replace function public.create_venue_room_secure(
  p_event_id uuid,
  p_label text,
  p_capacity smallint default 2
)
returns public.venue_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.venue_rooms;
begin
  if auth.uid() is null
     or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'Only the event host can create venue rooms';
  end if;
  if not public.event_accepts_live_actions(p_event_id) then
    raise exception 'Venue rooms can only change during the live event window';
  end if;
  if nullif(trim(p_label), '') is null or char_length(trim(p_label)) > 80 then
    raise exception 'Room label must be between 1 and 80 characters';
  end if;
  if p_capacity < 1 or p_capacity > 50 then
    raise exception 'Room capacity must be between 1 and 50';
  end if;

  insert into public.venue_rooms (event_id, label, capacity, is_busy)
  values (p_event_id, trim(p_label), p_capacity, false)
  returning * into v_room;

  return v_room;
end;
$$;
revoke all on function public.create_venue_room_secure(uuid, text, smallint) from public;
grant execute on function public.create_venue_room_secure(uuid, text, smallint) to authenticated;

-- Host-scoped queue read exposing only the public identity needed for physical
-- handoff. It does not depend on direct users-table RLS joins.
create or replace function public.get_host_escort_queue(p_event_id uuid)
returns table (
  id uuid,
  status public.office_hours_status,
  proposed_start timestamptz,
  proposed_end timestamptz,
  requester_id uuid,
  recipient_id uuid,
  room_id uuid,
  requester_name text,
  recipient_name text,
  room_label text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'Only the event host can view the escort queue';
  end if;

  return query
  select
    r.id,
    r.status,
    r.proposed_start,
    r.proposed_end,
    r.requester_id,
    r.recipient_id,
    r.room_id,
    requester.name,
    recipient.name,
    room.label
  from public.office_hours_requests r
  join public.users requester on requester.id = r.requester_id
  join public.users recipient on recipient.id = r.recipient_id
  left join public.venue_rooms room on room.id = r.room_id
  where r.event_id = p_event_id
    and r.status in ('accepted', 'awaiting_escort')
  order by r.proposed_start, r.created_at;
end;
$$;
revoke all on function public.get_host_escort_queue(uuid) from public;
grant execute on function public.get_host_escort_queue(uuid) to authenticated;

-- Atomic room assignment. The security control-plane nonce prevents replay and
-- the interval-overlap check is authoritative even if two host devices act at once.
create or replace function public.assign_escort_room_secure(
  p_request_id uuid,
  p_room_id uuid,
  p_nonce text
)
returns public.office_hours_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.office_hours_requests;
  v_room public.venue_rooms;
  v_authorization record;
  v_result public.office_hours_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.office_hours_requests r
  where r.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Office Hours request not found';
  end if;
  if not public.is_event_host(v_request.event_id, auth.uid()) then
    raise exception 'Only the event host can assign escort rooms';
  end if;
  if not public.event_accepts_live_actions(v_request.event_id) then
    raise exception 'Escort assignment is closed outside the live event window';
  end if;
  if v_request.status not in ('accepted', 'awaiting_escort') then
    raise exception 'Only accepted Office Hours requests can enter escort assignment';
  end if;
  if v_request.proposed_end <= now() then
    raise exception 'This Office Hours window has already elapsed';
  end if;

  select * into v_room
  from public.venue_rooms room
  where room.id = p_room_id
    and room.event_id = v_request.event_id
  for update;

  if v_room.id is null then
    raise exception 'Room does not belong to this event';
  end if;

  select * into v_authorization
  from public.authorize_sensitive_action(
    v_request.event_id,
    'escort_assignment'::public.security_action_kind,
    p_nonce,
    v_request.recipient_id,
    jsonb_build_object(
      'mutation', 'assign_escort_room',
      'request_id', p_request_id,
      'room_id', p_room_id
    )
  );

  if not coalesce(v_authorization.allowed, false) then
    raise exception 'Escort assignment denied: %', coalesce(v_authorization.reason_code, 'unknown');
  end if;

  if exists (
    select 1
    from public.office_hours_requests existing
    where existing.event_id = v_request.event_id
      and existing.room_id = p_room_id
      and existing.id <> p_request_id
      and existing.status = 'awaiting_escort'
      and existing.proposed_start < v_request.proposed_end
      and existing.proposed_end > v_request.proposed_start
  ) then
    raise exception 'Room is already committed during this Office Hours window';
  end if;

  update public.office_hours_requests
  set room_id = p_room_id,
      status = 'awaiting_escort',
      responded_at = coalesce(responded_at, now())
  where id = p_request_id
  returning * into v_result;

  return v_result;
end;
$$;
revoke all on function public.assign_escort_room_secure(uuid, uuid, text) from public;
grant execute on function public.assign_escort_room_secure(uuid, uuid, text) to authenticated;

comment on function public.assign_escort_room_secure(uuid, uuid, text) is
  'Replay-protected host room assignment with event lifecycle, ownership, status, and time-overlap validation.';
