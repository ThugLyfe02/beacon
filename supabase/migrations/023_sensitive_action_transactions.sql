-- =============================================================================
-- 023_sensitive_action_transactions.sql
-- Atomic security authorization + mutation wrappers for Beacon's highest-impact
-- actions. These functions close the time-of-check/time-of-use gap that would
-- exist if the client authorized an action and mutated data in separate calls.
-- =============================================================================

create or replace function public.secure_consume_signal_budget(
  p_event_id uuid,
  p_recipient_id uuid,
  p_nonce text
)
returns public.event_signal_budgets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorization record;
  v_budget public.event_signal_budgets;
begin
  select * into v_authorization
  from public.authorize_sensitive_action(
    p_event_id,
    'signal'::public.security_action_kind,
    p_nonce,
    p_recipient_id,
    jsonb_build_object('mutation', 'consume_signal_budget')
  );

  if not coalesce(v_authorization.allowed, false) then
    raise exception 'Sensitive action denied: %', coalesce(v_authorization.reason_code, 'unknown');
  end if;

  select * into v_budget
  from public.consume_signal_budget(p_event_id, p_recipient_id);

  return v_budget;
end;
$$;

grant execute on function public.secure_consume_signal_budget(uuid, uuid, text)
  to authenticated;

create or replace function public.secure_claim_access_drop(
  p_drop_id uuid,
  p_nonce text
)
returns public.access_drop_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_authorization record;
  v_claim public.access_drop_claims;
begin
  select event_id into v_event_id
  from public.access_drop_windows
  where id = p_drop_id;

  if v_event_id is null then
    raise exception 'Access Drop not found';
  end if;

  select * into v_authorization
  from public.authorize_sensitive_action(
    v_event_id,
    'access_drop'::public.security_action_kind,
    p_nonce,
    null,
    jsonb_build_object('mutation', 'claim_access_drop', 'drop_id', p_drop_id)
  );

  if not coalesce(v_authorization.allowed, false) then
    raise exception 'Sensitive action denied: %', coalesce(v_authorization.reason_code, 'unknown');
  end if;

  select * into v_claim
  from public.claim_access_drop(p_drop_id);

  return v_claim;
end;
$$;

grant execute on function public.secure_claim_access_drop(uuid, text)
  to authenticated;

create or replace function public.secure_create_office_hours_request(
  p_event_id uuid,
  p_recipient_id uuid,
  p_proposed_start timestamptz,
  p_proposed_end timestamptz,
  p_nonce text
)
returns public.office_hours_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_authorization record;
  v_request public.office_hours_requests;
begin
  if p_proposed_end <= p_proposed_start then
    raise exception 'Office Hours end time must be after start time';
  end if;

  if p_proposed_start < now() - interval '2 minutes' then
    raise exception 'Office Hours start time is stale';
  end if;

  select * into v_authorization
  from public.authorize_sensitive_action(
    p_event_id,
    'office_hours'::public.security_action_kind,
    p_nonce,
    p_recipient_id,
    jsonb_build_object(
      'mutation', 'create_office_hours_request',
      'proposed_start', p_proposed_start,
      'proposed_end', p_proposed_end
    )
  );

  if not coalesce(v_authorization.allowed, false) then
    raise exception 'Sensitive action denied: %', coalesce(v_authorization.reason_code, 'unknown');
  end if;

  insert into public.office_hours_requests (
    event_id,
    requester_id,
    recipient_id,
    proposed_start,
    proposed_end
  ) values (
    p_event_id,
    auth.uid(),
    p_recipient_id,
    p_proposed_start,
    p_proposed_end
  )
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.secure_create_office_hours_request(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text
) to authenticated;

-- Direct execution remains available to existing code during migration, but the
-- secure wrappers are the required integration path for newly shipped UI.
comment on function public.secure_consume_signal_budget(uuid, uuid, text)
  is 'Atomically authorizes and consumes a high-intent signal budget.';
comment on function public.secure_claim_access_drop(uuid, text)
  is 'Atomically authorizes and claims or waitlists a Limited Access Drop.';
comment on function public.secure_create_office_hours_request(uuid, uuid, timestamptz, timestamptz, text)
  is 'Atomically authorizes and creates a premium Office Hours request.';
