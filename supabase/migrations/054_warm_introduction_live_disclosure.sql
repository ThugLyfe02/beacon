-- Warm introduction live-field disclosure boundary
--
-- Narrows both the pairwise reason helper and availability projection so a
-- modified client cannot use either RPC to test arbitrary event participants.
-- A target outside the caller's current physical field is indistinguishable from
-- an unavailable target; no declared-fit or connector information is released.

create or replace function public.event_introduction_domains(
  p_event_id uuid,
  p_requester_id uuid,
  p_target_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with admitted as (
    select public.event_introduction_pair_in_live_field(
      p_event_id,
      p_requester_id,
      p_target_id,
      45
    ) as allowed
  ), requester as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    cross join admitted a
    where a.allowed = true
      and i.event_id = p_event_id
      and i.user_id = p_requester_id
      and i.enabled = true
  ), target as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    cross join admitted a
    where a.allowed = true
      and i.event_id = p_event_id
      and i.user_id = p_target_id
      and i.enabled = true
  ), overlap as (
    select key
    from requester r
    cross join target t
    cross join lateral unnest(r.seeking) as key
    where key = any(t.offering)
    union
    select key
    from requester r
    cross join target t
    cross join lateral unnest(r.offering) as key
    where key = any(t.seeking)
  )
  select coalesce(array_agg(key order by key), '{}'::text[])
  from overlap;
$$;

create or replace function public.get_warm_introduction_availability(
  p_event_id uuid,
  p_target_id uuid
)
returns table (
  available boolean,
  reason text,
  eligible_domains text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_domains text[] := '{}';
  v_connector_id uuid;
  v_active_count integer;
  v_total_count integer;
begin
  if auth.uid() is null then
    return query select false, 'authentication-required'::text, '{}'::text[];
    return;
  end if;
  if not public.is_event_operational(p_event_id) then
    return query select false, 'event-closed'::text, '{}'::text[];
    return;
  end if;
  if p_target_id is null or p_target_id = auth.uid() then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if not public.event_introduction_pair_in_live_field(
    p_event_id,
    auth.uid(),
    p_target_id,
    45
  ) then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if public.event_introduction_pair_blocked(auth.uid(), p_target_id) then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if public.event_introduction_pair_matched(p_event_id, auth.uid(), p_target_id) then
    return query select false, 'already-connected'::text, '{}'::text[];
    return;
  end if;

  v_domains := public.event_introduction_domains(p_event_id, auth.uid(), p_target_id);
  if cardinality(v_domains) = 0 then
    return query select false, 'no-declared-fit'::text, '{}'::text[];
    return;
  end if;

  if exists (
    select 1
    from public.event_introduction_requests r
    where r.event_id = p_event_id
      and r.requester_id = auth.uid()
      and r.target_id = p_target_id
      and r.status in ('connector-pending','target-pending','accepted')
  ) then
    return query select false, 'already-requested'::text, v_domains;
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid()
    and r.status in ('connector-pending','target-pending','accepted');

  select count(*)::integer into v_total_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid();

  if v_active_count >= 3 or v_total_count >= 6 then
    return query select false, 'request-limit'::text, v_domains;
    return;
  end if;

  v_connector_id := public.find_event_introduction_connector(
    p_event_id,
    auth.uid(),
    p_target_id
  );
  if v_connector_id is null then
    return query select false, 'no-opted-in-connector'::text, v_domains;
    return;
  end if;

  return query select true, 'connector-available'::text, v_domains;
end;
$$;

comment on function public.event_introduction_domains(uuid,uuid,uuid) is
  'Returns only explicit pairwise intent intersections while the requester and target are inside the same fresh bounded live field. Outside-field callers receive no domains.';
comment on function public.get_warm_introduction_availability(uuid,uuid) is
  'Caller-scoped availability for one current live-field target. It releases no connector identity, connector list, graph degree, or declared-fit evidence for an outside-field target.';
