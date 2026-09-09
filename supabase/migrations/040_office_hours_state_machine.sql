-- =============================================================================
-- 040_office_hours_state_machine.sql
-- Makes Office Hours lifecycle state authoritative and evidence-backed.
--
-- Invariants:
--   * ordinary clients cannot update arbitrary Office Hours columns/statuses;
--   * recipient alone may accept/decline a pending request;
--   * either party may cancel a still-open request while the event is unfinalized;
--   * room_id remains host-controlled through assign_escort_room_secure only;
--   * `completed` requires independent confirmation from both parties;
--   * attendees can see only rooms actually assigned to their own Office Hours.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Venue-room read privacy.
-- ---------------------------------------------------------------------------
drop policy if exists "venue_rooms_attendee_select" on public.venue_rooms;
drop policy if exists "venue_rooms_host_select" on public.venue_rooms;
drop policy if exists "venue_rooms_assigned_party_select" on public.venue_rooms;

create policy "venue_rooms_host_select"
on public.venue_rooms for select
to authenticated
using (public.is_event_host(event_id, auth.uid()));

create policy "venue_rooms_assigned_party_select"
on public.venue_rooms for select
to authenticated
using (
  exists (
    select 1
    from public.office_hours_requests r
    where r.room_id = venue_rooms.id
      and r.event_id = venue_rooms.event_id
      and auth.uid() in (r.requester_id, r.recipient_id)
      and r.status in ('accepted', 'awaiting_escort', 'completed')
  )
);

-- ---------------------------------------------------------------------------
-- Remove broad party UPDATE. SECURITY DEFINER state-machine RPCs below are the
-- only mobile write surface; host room assignment remains the dedicated RPC from
-- migration 039.
-- ---------------------------------------------------------------------------
drop policy if exists "oh_requests_update_party" on public.office_hours_requests;
drop policy if exists "oh_requests_update_party unfinalized" on public.office_hours_requests;
revoke update on table public.office_hours_requests from authenticated;
revoke update on table public.office_hours_requests from anon;

create table if not exists public.office_hours_completion_confirmations (
  request_id uuid not null references public.office_hours_requests(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

alter table public.office_hours_completion_confirmations enable row level security;

create policy "office_hours_completion_parties_read"
on public.office_hours_completion_confirmations for select
to authenticated
using (
  exists (
    select 1
    from public.office_hours_requests r
    where r.id = office_hours_completion_confirmations.request_id
      and auth.uid() in (r.requester_id, r.recipient_id)
  )
);

create or replace function public.transition_office_hours_request(
  p_request_id uuid,
  p_status public.office_hours_status
)
returns public.office_hours_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.office_hours_requests;
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
  if auth.uid() not in (v_request.requester_id, v_request.recipient_id) then
    raise exception 'Office Hours party access required';
  end if;
  if not public.event_is_unfinalized(v_request.event_id) then
    raise exception 'Finalized event evidence cannot be mutated';
  end if;

  if p_status = 'accepted' then
    if auth.uid() <> v_request.recipient_id or v_request.status <> 'pending' then
      raise exception 'Only the recipient can accept a pending request';
    end if;
  elsif p_status = 'declined' then
    if auth.uid() <> v_request.recipient_id or v_request.status <> 'pending' then
      raise exception 'Only the recipient can decline a pending request';
    end if;
  elsif p_status = 'cancelled' then
    if v_request.status not in ('pending', 'accepted', 'awaiting_escort') then
      raise exception 'This Office Hours request can no longer be cancelled';
    end if;
  else
    raise exception 'Unsupported direct Office Hours transition';
  end if;

  update public.office_hours_requests
  set status = p_status,
      responded_at = case
        when p_status in ('accepted', 'declined') then coalesce(responded_at, now())
        else responded_at
      end
  where id = p_request_id
  returning * into v_result;

  return v_result;
end;
$$;
revoke all on function public.transition_office_hours_request(uuid, public.office_hours_status) from public;
grant execute on function public.transition_office_hours_request(uuid, public.office_hours_status) to authenticated;

create or replace function public.confirm_office_hours_completion(p_request_id uuid)
returns table (
  request_id uuid,
  status public.office_hours_status,
  own_confirmed boolean,
  counterpart_confirmed boolean,
  confirmation_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.office_hours_requests;
  v_count integer;
  v_other_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.office_hours_requests r
  where r.id = p_request_id
  for update;

  if v_request.id is null
     or auth.uid() not in (v_request.requester_id, v_request.recipient_id) then
    raise exception 'Office Hours party access required';
  end if;
  if not public.event_is_unfinalized(v_request.event_id) then
    raise exception 'Finalized event evidence cannot be mutated';
  end if;
  if v_request.status not in ('accepted', 'awaiting_escort', 'completed') then
    raise exception 'Only an accepted Office Hours session can be completed';
  end if;

  -- Confirmation is meaningful only when the scheduled session has actually
  -- started. This prevents pre-committing a completion before the meeting exists.
  if v_request.proposed_start > now() then
    raise exception 'Office Hours completion cannot be confirmed before the session starts';
  end if;

  insert into public.office_hours_completion_confirmations (request_id, user_id)
  values (p_request_id, auth.uid())
  on conflict (request_id, user_id) do nothing;

  select count(*)::integer into v_count
  from public.office_hours_completion_confirmations c
  where c.request_id = p_request_id
    and c.user_id in (v_request.requester_id, v_request.recipient_id);

  if v_count >= 2 and v_request.status <> 'completed' then
    update public.office_hours_requests
    set status = 'completed'
    where id = p_request_id;
    v_request.status := 'completed';
  end if;

  v_other_id := case
    when auth.uid() = v_request.requester_id then v_request.recipient_id
    else v_request.requester_id
  end;

  return query
  select
    p_request_id,
    v_request.status,
    true,
    exists (
      select 1 from public.office_hours_completion_confirmations c
      where c.request_id = p_request_id and c.user_id = v_other_id
    ),
    v_count;
end;
$$;
revoke all on function public.confirm_office_hours_completion(uuid) from public;
grant execute on function public.confirm_office_hours_completion(uuid) to authenticated;

create or replace function public.get_office_hours_completion_state(p_request_id uuid)
returns table (
  request_id uuid,
  status public.office_hours_status,
  own_confirmed boolean,
  counterpart_confirmed boolean,
  confirmation_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.office_hours_requests;
  v_other_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_request
  from public.office_hours_requests r
  where r.id = p_request_id;

  if v_request.id is null
     or auth.uid() not in (v_request.requester_id, v_request.recipient_id) then
    raise exception 'Office Hours party access required';
  end if;

  v_other_id := case
    when auth.uid() = v_request.requester_id then v_request.recipient_id
    else v_request.requester_id
  end;

  return query
  select
    p_request_id,
    v_request.status,
    exists (
      select 1 from public.office_hours_completion_confirmations c
      where c.request_id = p_request_id and c.user_id = auth.uid()
    ),
    exists (
      select 1 from public.office_hours_completion_confirmations c
      where c.request_id = p_request_id and c.user_id = v_other_id
    ),
    (
      select count(*)::integer
      from public.office_hours_completion_confirmations c
      where c.request_id = p_request_id
        and c.user_id in (v_request.requester_id, v_request.recipient_id)
    );
end;
$$;
revoke all on function public.get_office_hours_completion_state(uuid) from public;
grant execute on function public.get_office_hours_completion_state(uuid) to authenticated;

comment on function public.confirm_office_hours_completion(uuid) is
  'Records one independent Office Hours completion receipt; marks the session completed only after both parties confirm.';
