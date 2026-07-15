-- =============================================================================
-- 027_secure_connection_activation.sql
-- Atomically authorizes, spends a scarce signal, inserts the connection request,
-- detects a mutual, and returns the resulting state.
-- =============================================================================

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

  insert into public.connection_requests (
    event_id,
    requester_id,
    recipient_id
  ) values (
    p_event_id,
    auth.uid(),
    p_recipient_id
  )
  on conflict (event_id, requester_id, recipient_id)
  do update set status = 'pending'
  returning * into v_request;

  select * into v_match
  from public.detect_mutual_match(
    p_event_id,
    auth.uid(),
    p_recipient_id
  )
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

grant execute on function public.secure_send_connection_request(uuid, uuid, text)
  to authenticated;

revoke execute on function public.consume_signal_budget(uuid, uuid)
  from authenticated;

comment on function public.secure_send_connection_request(uuid, uuid, text)
  is 'Atomically authorizes and activates a scarce event-scoped connection signal.';
