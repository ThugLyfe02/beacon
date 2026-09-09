-- =============================================================================
-- 037_event_column_and_membership_oracle_lockdown.sql
-- Column-level event ownership + caller-scoped membership helper semantics.
--
-- RLS protects rows, not columns. After moving access secrets out of events,
-- generic UPDATE must not be able to write legacy access_code or lifecycle-owned
-- fields. Likewise public SECURITY DEFINER helper predicates must not become
-- arbitrary membership-oracle RPCs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Explicit event column ownership.
-- ---------------------------------------------------------------------------
revoke update on table public.events from authenticated;
revoke update on table public.events from anon;

grant update (
  name,
  description,
  location_type,
  latitude,
  longitude,
  address,
  requires_approval,
  show_participant_count,
  starts_at,
  ends_at
) on public.events to authenticated;

revoke update (access_code, host_id, join_code, finalized_at)
  on public.events from authenticated;

-- ---------------------------------------------------------------------------
-- Caller-scoped helper predicates.
--
-- These functions remain SECURITY DEFINER because RLS policies depend on them to
-- avoid recursion. Their direct-call behavior now reveals no more than the caller
-- is already entitled to learn from event/member surfaces.
-- ---------------------------------------------------------------------------
create or replace function public.is_event_host(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return exists (
    select 1 from public.events e
    where e.id = p_event_id and e.host_id = auth.uid()
  );
end;
$$;

create or replace function public.is_approved_participant(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  );
end;
$$;

create or replace function public.is_user_in_event(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Self checks disclose only approved membership. Pending/rejected state remains
  -- available to the user's dedicated pending/status surfaces, not this oracle.
  if p_user_id = auth.uid() then
    return exists (
      select 1 from public.event_participants ep
      where ep.event_id = p_event_id
        and ep.user_id = auth.uid()
        and ep.status = 'approved'
    );
  end if;

  -- A host or approved attendee may ask whether another user is approved because
  -- approved participants are already visible on event discovery surfaces. They
  -- cannot use this helper to discover pending or rejected membership.
  if public.is_event_host(p_event_id, auth.uid())
     or public.is_approved_participant(p_event_id, auth.uid()) then
    return exists (
      select 1 from public.event_participants ep
      where ep.event_id = p_event_id
        and ep.user_id = p_user_id
        and ep.status = 'approved'
    );
  end if;

  return false;
end;
$$;

revoke all on function public.is_event_host(uuid, uuid) from public;
revoke all on function public.is_approved_participant(uuid, uuid) from public;
revoke all on function public.is_user_in_event(uuid, uuid) from public;
grant execute on function public.is_event_host(uuid, uuid) to authenticated;
grant execute on function public.is_approved_participant(uuid, uuid) to authenticated;
grant execute on function public.is_user_in_event(uuid, uuid) to authenticated;

comment on function public.is_user_in_event(uuid, uuid) is
  'Caller-scoped approved-membership predicate. Never reveals pending/rejected membership to arbitrary authenticated callers.';
