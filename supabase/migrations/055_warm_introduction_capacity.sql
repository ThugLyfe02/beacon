-- Warm introduction capacity and withdrawal discipline
--
-- Serializes admission around requester, target, and connector capacity so a
-- burst of concurrent mobile requests cannot exceed the limits checked by the
-- application RPC. Disabling connector availability also closes requests that
-- are still waiting on that connector's first decision.

create or replace function public.set_my_introduction_preference(
  p_event_id uuid,
  p_enabled boolean,
  p_max_active integer default 2
)
returns table (
  event_id uuid,
  user_id uuid,
  enabled boolean,
  max_active integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_max_active integer := greatest(1, least(coalesce(p_max_active, 2), 4));
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'introduction preference can be changed only while the event is operational';
  end if;
  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'approved event participation required';
  end if;

  insert into public.event_introduction_preferences (
    event_id,
    user_id,
    enabled,
    max_active,
    updated_at
  ) values (
    p_event_id,
    auth.uid(),
    v_enabled,
    v_max_active,
    now()
  )
  on conflict (event_id, user_id) do update
  set
    enabled = excluded.enabled,
    max_active = excluded.max_active,
    updated_at = now();

  if not v_enabled then
    -- A participant can withdraw before making the connector decision. Requests
    -- already passed to a target are not silently revoked because the connector
    -- explicitly accepted those individual bridges before disabling new work.
    update public.event_introduction_requests r
    set
      status = 'declined',
      connector_responded_at = coalesce(r.connector_responded_at, now()),
      declined_at = coalesce(r.declined_at, now()),
      declined_by = coalesce(r.declined_by, 'connector'),
      updated_at = now()
    where r.event_id = p_event_id
      and r.connector_id = auth.uid()
      and r.status = 'connector-pending';
  end if;

  return query
  select
    p.event_id,
    p.user_id,
    p.enabled,
    p.max_active,
    p.updated_at
  from public.event_introduction_preferences p
  where p.event_id = p_event_id
    and p.user_id = auth.uid();
end;
$$;

create or replace function public.enforce_warm_introduction_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_lock bigint;
  v_target_lock bigint;
  v_requester_active integer;
  v_requester_total integer;
  v_target_unresolved integer;
  v_target_pending integer;
  v_connector_active integer;
  v_connector_max integer;
begin
  -- Advisory locks make count-based admission atomic without an event-wide lock.
  -- Acquire the two participant-scope keys in numeric order to avoid deadlock
  -- when two users request introductions to each other concurrently.
  v_requester_lock := hashtextextended(
    'warm-introduction:requester:' || new.event_id::text || ':' || new.requester_id::text,
    0
  );
  v_target_lock := hashtextextended(
    'warm-introduction:target:' || new.event_id::text || ':' || new.target_id::text,
    0
  );

  perform pg_advisory_xact_lock(least(v_requester_lock, v_target_lock));
  if v_requester_lock <> v_target_lock then
    perform pg_advisory_xact_lock(greatest(v_requester_lock, v_target_lock));
  end if;

  select
    count(*) filter (
      where r.status in ('connector-pending','target-pending','accepted')
    )::integer,
    count(*)::integer
  into v_requester_active, v_requester_total
  from public.event_introduction_requests r
  where r.event_id = new.event_id
    and r.requester_id = new.requester_id;

  if coalesce(v_requester_active, 0) >= 3 then
    raise exception 'finish or close an active introduction before requesting another';
  end if;
  if coalesce(v_requester_total, 0) >= 6 then
    raise exception 'event introduction request limit reached';
  end if;

  select
    count(*) filter (
      where r.status in ('connector-pending','target-pending')
        and r.expires_at > now()
    )::integer,
    count(*) filter (
      where r.status = 'target-pending'
        and r.expires_at > now()
    )::integer
  into v_target_unresolved, v_target_pending
  from public.event_introduction_requests r
  where r.event_id = new.event_id
    and r.target_id = new.target_id;

  if coalesce(v_target_unresolved, 0) >= 8
     or coalesce(v_target_pending, 0) >= 4 then
    raise exception 'this participant already has too many introduction decisions in flight';
  end if;

  select pref.max_active into v_connector_max
  from public.event_introduction_preferences pref
  where pref.event_id = new.event_id
    and pref.user_id = new.connector_id
    and pref.enabled = true
  for update;

  if v_connector_max is null then
    raise exception 'the selected connector is no longer available';
  end if;

  select count(*)::integer into v_connector_active
  from public.event_introduction_requests r
  where r.event_id = new.event_id
    and r.connector_id = new.connector_id
    and r.status in ('connector-pending','target-pending')
    and r.expires_at > now();

  if coalesce(v_connector_active, 0) >= v_connector_max then
    raise exception 'the selected connector has reached their active request limit';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_warm_introduction_capacity_before_insert
  on public.event_introduction_requests;
create trigger enforce_warm_introduction_capacity_before_insert
before insert on public.event_introduction_requests
for each row execute function public.enforce_warm_introduction_capacity();

revoke all on function public.enforce_warm_introduction_capacity() from public;

comment on function public.set_my_introduction_preference(uuid,boolean,integer) is
  'Caller-owned event connector preference. Disabling closes only connector-pending assignments; previously accepted bridges remain subject to target choice.';
comment on function public.enforce_warm_introduction_capacity() is
  'Concurrency-safe admission for requester, target, and connector limits using ordered transaction advisory locks and a locked connector preference row.';
