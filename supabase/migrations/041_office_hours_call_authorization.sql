-- =============================================================================
-- 041_office_hours_call_authorization.sql
-- Canonical authorization context for LiveKit Office Hours grants.
--
-- The token issuer must not recreate lifecycle/privacy policy in edge code. This
-- RPC returns a grantable context only when the authenticated caller is a party,
-- the event is unfinalized, Office Hours is not security-disabled, neither party
-- has blocked the other, the request is accepted/escorted, and DB time is inside
-- the narrow call window. TTL is capped to the remaining authorized window.
-- =============================================================================

create or replace function public.get_office_hours_call_context(p_request_id uuid)
returns table (
  request_id uuid,
  event_id uuid,
  requester_id uuid,
  recipient_id uuid,
  proposed_start timestamptz,
  proposed_end timestamptz,
  window_closes_at timestamptz,
  token_ttl_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.office_hours_requests;
  v_controls public.event_security_controls;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_ttl integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_request
  from public.office_hours_requests r
  where r.id = p_request_id;

  -- Deliberately use one generic denial so this RPC cannot be used to distinguish
  -- request existence from party/lifecycle/security failure.
  if v_request.id is null
     or auth.uid() not in (v_request.requester_id, v_request.recipient_id)
     or v_request.status not in ('accepted', 'awaiting_escort')
     or not public.event_is_unfinalized(v_request.event_id) then
    return;
  end if;

  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_request.requester_id and ub.blocked_id = v_request.recipient_id)
       or (ub.blocker_id = v_request.recipient_id and ub.blocked_id = v_request.requester_id)
  ) then
    return;
  end if;

  select * into v_controls
  from public.event_security_controls c
  where c.event_id = v_request.event_id;

  if v_controls.event_id is not null and (
    v_controls.mode = 'locked'
    or not v_controls.office_hours_enabled
  ) then
    return;
  end if;

  v_window_open := v_request.proposed_start - interval '5 minutes';
  v_window_close := v_request.proposed_end + interval '5 minutes';

  if now() < v_window_open or now() > v_window_close then
    return;
  end if;

  v_ttl := greatest(
    30,
    least(
      3600,
      floor(extract(epoch from (v_window_close - now())))::integer
    )
  );

  return query
  select
    v_request.id,
    v_request.event_id,
    v_request.requester_id,
    v_request.recipient_id,
    v_request.proposed_start,
    v_request.proposed_end,
    v_window_close,
    v_ttl;
end;
$$;

revoke all on function public.get_office_hours_call_context(uuid) from public;
grant execute on function public.get_office_hours_call_context(uuid) to authenticated;

comment on function public.get_office_hours_call_context(uuid) is
  'Returns a short-lived LiveKit grant context only when Office Hours lifecycle, security mode, block privacy, party identity, and DB-time window all permit the call.';
