-- Event lifecycle access boundaries
-- Ending an event must preserve operational evidence while also closing every
-- ordinary entry/action path that could accidentally keep the event "live".

-- Pre-membership lookup intentionally preserves the legacy result shape, but it
-- never exposes the event access code. Possession of a join code must not reveal
-- the second factor used to approve a participant.
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
language sql
stable
security definer
set search_path = public
as $$
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
    and e.ended_at is null
    and (e.ends_at is null or e.ends_at > now())
  limit 1;
$$;

revoke all on function public.get_event_by_join_code(text) from public;
grant execute on function public.get_event_by_join_code(text) to authenticated;

-- Joining is server-scoped to the authenticated caller and an event that has not
-- been explicitly or temporally closed. Existing membership remains idempotent.
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
    raise exception 'not authenticated';
  end if;

  select e.requires_approval
    into v_requires_approval
  from public.events e
  where e.id = p_event_id
    and e.ended_at is null
    and (e.ends_at is null or e.ends_at > now());

  if not found then
    raise exception 'event is not available for joining';
  end if;

  select * into v_existing
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.user_id = auth.uid();

  if found then
    return v_existing;
  end if;

  insert into public.event_participants (event_id, user_id, status)
  values (
    p_event_id,
    auth.uid(),
    case when v_requires_approval then 'pending'::public.participant_status else 'approved'::public.participant_status end
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.request_to_join_event(uuid) from public;
grant execute on function public.request_to_join_event(uuid) to authenticated;

-- Replaces the legacy RPC that accepted an arbitrary p_user_id. The authenticated
-- user may only approve their own pending membership and only while the event is
-- still operational. The secret is compared server-side and is never returned by
-- the join-code lookup above.
create or replace function public.approve_self_with_event_code(
  p_event_id uuid,
  p_access_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select e.access_code
    into v_event_code
  from public.events e
  where e.id = p_event_id
    and e.ended_at is null
    and (e.ends_at is null or e.ends_at > now());

  if not found or v_event_code is null then
    return false;
  end if;

  if v_event_code <> trim(coalesce(p_access_code, '')) then
    return false;
  end if;

  update public.event_participants ep
  set status = 'approved'
  where ep.event_id = p_event_id
    and ep.user_id = auth.uid()
    and ep.status = 'pending';

  return found;
end;
$$;

-- The older function trusts a caller-supplied user id and is no longer an
-- authenticated-client boundary. Leave it in place for migration compatibility,
-- but remove client execute permission.
revoke all on function public.approve_participant_with_code(uuid, uuid, text) from public;
revoke execute on function public.approve_participant_with_code(uuid, uuid, text) from authenticated;
revoke all on function public.approve_self_with_event_code(uuid, text) from public;
grant execute on function public.approve_self_with_event_code(uuid, text) to authenticated;

-- Sensitive connection activation is also closed when the event is closed. The
-- rest of the atomic scarce-signal path is intentionally preserved.
create or replace function public.secure_send_connection_request(
  p_event_id uuid,
  p_recipient_id uuid,
  p_nonce text
)
returns table (
  request_id uuid,
  request_event_id uuid,
  requester_id uuid,
  recipient_id uuid,
  request_status public.request_status,
  request_created_at timestamptz,
  match_id uuid,
  match_event_id uuid,
  match_user_a_id uuid,
  match_user_b_id uuid,
  match_created_at timestamptz,
  remaining_signal_budget smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorization record;
  v_budget public.event_signal_budgets;
  v_request public.connection_requests;
  v_match public.matches;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_event_operational(p_event_id) then
    raise exception 'Event is closed';
  end if;

  if auth.uid() = p_recipient_id then
    raise exception 'Cannot signal yourself';
  end if;

  select * into v_authorization
  from public.authorize_sensitive_action(
    p_event_id,
    'signal'::public.security_action_kind,
    p_nonce,
    p_recipient_id,
    jsonb_build_object('mutation', 'secure_send_connection_request')
  );

  if not coalesce(v_authorization.allowed, false) then
    raise exception 'Sensitive action denied: %', coalesce(v_authorization.reason_code, 'unknown');
  end if;

  select * into v_budget
  from public.consume_signal_budget(p_event_id, p_recipient_id);

  insert into public.connection_requests (event_id, requester_id, recipient_id)
  values (p_event_id, auth.uid(), p_recipient_id)
  on conflict (event_id, requester_id, recipient_id)
  do update set status = 'pending'
  returning * into v_request;

  select * into v_match
  from public.detect_mutual_match(p_event_id, auth.uid(), p_recipient_id)
  limit 1;

  return query
  select
    v_request.id,
    v_request.event_id,
    v_request.requester_id,
    v_request.recipient_id,
    v_request.status,
    v_request.created_at,
    v_match.id,
    v_match.event_id,
    v_match.user_a_id,
    v_match.user_b_id,
    v_match.created_at,
    greatest(0, v_budget.budget_limit - v_budget.used_count)::smallint;
end;
$$;

revoke all on function public.secure_send_connection_request(uuid, uuid, text) from public;
grant execute on function public.secure_send_connection_request(uuid, uuid, text) to authenticated;

comment on function public.approve_self_with_event_code(uuid, text) is
  'Approves only auth.uid() against a server-held event access code while the event remains operational.';
