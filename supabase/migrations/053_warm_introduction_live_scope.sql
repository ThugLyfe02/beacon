-- Warm introduction live-field hardening
--
-- A modified client must not turn the warm-introduction RPC into an event-wide
-- participant or social-graph probe. The requester and target therefore need
-- fresh coordinates inside the same bounded physical field at request time, and
-- the selected connector must also have a fresh live fix.

create or replace function public.event_introduction_pair_in_live_field(
  p_event_id uuid,
  p_requester_id uuid,
  p_target_id uuid,
  p_max_distance_feet numeric default 45
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with requester as (
    select
      u.last_known_lat as latitude,
      u.last_known_lng as longitude,
      u.last_location_at
    from public.users u
    join public.event_participants ep
      on ep.user_id = u.id
     and ep.event_id = p_event_id
     and ep.status = 'approved'
    where u.id = p_requester_id
  ), target as (
    select
      u.last_known_lat as latitude,
      u.last_known_lng as longitude,
      u.last_location_at,
      coalesce(u.is_discoverable, false) as is_discoverable
    from public.users u
    join public.event_participants ep
      on ep.user_id = u.id
     and ep.event_id = p_event_id
     and ep.status = 'approved'
    where u.id = p_target_id
  ), measured as (
    select
      r.last_location_at as requester_fix_at,
      t.last_location_at as target_fix_at,
      t.is_discoverable,
      6371008.8 * 2 * asin(
        least(
          1::double precision,
          sqrt(
            power(sin(radians(t.latitude - r.latitude) / 2), 2)
            + cos(radians(r.latitude))
              * cos(radians(t.latitude))
              * power(sin(radians(t.longitude - r.longitude) / 2), 2)
          )
        )
      ) as distance_meters
    from requester r
    cross join target t
    where r.latitude is not null
      and r.longitude is not null
      and t.latitude is not null
      and t.longitude is not null
      and r.last_location_at is not null
      and t.last_location_at is not null
  )
  select exists (
    select 1
    from measured m
    where m.is_discoverable = true
      and m.requester_fix_at > now() - interval '90 seconds'
      and m.target_fix_at > now() - interval '90 seconds'
      and m.distance_meters <= greatest(1, least(coalesce(p_max_distance_feet, 45), 80)) * 0.3048
  );
$$;

create or replace function public.event_introduction_participant_live(
  p_event_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.event_participants ep
      on ep.user_id = u.id
     and ep.event_id = p_event_id
     and ep.status = 'approved'
    where u.id = p_user_id
      and coalesce(u.is_discoverable, false) = true
      and u.last_location_at is not null
      and u.last_location_at > now() - interval '90 seconds'
      and u.last_known_lat is not null
      and u.last_known_lng is not null
  );
$$;

-- Replaces the connector selector from migration 052 with one that requires a
-- fresh participant fix and distributes equally loaded requests by a stable pair
-- hash rather than connector popularity or graph degree.
create or replace function public.find_event_introduction_connector(
  p_event_id uuid,
  p_requester_id uuid,
  p_target_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pref.user_id
  from public.event_introduction_preferences pref
  join public.event_participants ep
    on ep.event_id = pref.event_id
   and ep.user_id = pref.user_id
   and ep.status = 'approved'
  cross join lateral (
    select count(*)::integer as active_count
    from public.event_introduction_requests active
    where active.event_id = p_event_id
      and active.connector_id = pref.user_id
      and active.status in ('connector-pending','target-pending')
      and active.expires_at > now()
  ) load
  where pref.event_id = p_event_id
    and pref.enabled = true
    and pref.user_id not in (p_requester_id, p_target_id)
    and load.active_count < pref.max_active
    and public.event_introduction_participant_live(p_event_id, pref.user_id)
    and public.event_introduction_pair_matched(p_event_id, p_requester_id, pref.user_id)
    and public.event_introduction_pair_matched(p_event_id, pref.user_id, p_target_id)
    and not public.event_introduction_pair_blocked(p_requester_id, pref.user_id)
    and not public.event_introduction_pair_blocked(pref.user_id, p_target_id)
  order by
    load.active_count,
    md5(pref.user_id::text || ':' || p_requester_id::text || ':' || p_target_id::text),
    pref.user_id
  limit 1;
$$;

create or replace function public.enforce_warm_introduction_live_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domains text[];
begin
  if auth.uid() is null or new.requester_id <> auth.uid() then
    raise exception 'warm introduction requester identity is invalid';
  end if;

  if not public.is_event_operational(new.event_id) then
    raise exception 'warm introductions require an operational event';
  end if;

  if not public.event_introduction_pair_in_live_field(
    new.event_id,
    new.requester_id,
    new.target_id,
    45
  ) then
    raise exception 'the target is not in the requester current live field';
  end if;

  if not public.event_introduction_participant_live(new.event_id, new.connector_id) then
    raise exception 'the selected connector is no longer live at this event';
  end if;

  if not public.event_introduction_pair_matched(new.event_id, new.requester_id, new.connector_id)
     or not public.event_introduction_pair_matched(new.event_id, new.connector_id, new.target_id) then
    raise exception 'the selected connector no longer has both verified mutual edges';
  end if;

  if public.event_introduction_pair_blocked(new.requester_id, new.target_id)
     or public.event_introduction_pair_blocked(new.requester_id, new.connector_id)
     or public.event_introduction_pair_blocked(new.connector_id, new.target_id) then
    raise exception 'warm introduction is blocked by a participant safety boundary';
  end if;

  v_domains := public.event_introduction_domains(
    new.event_id,
    new.requester_id,
    new.target_id
  );
  if not (new.intent_key = any(v_domains)) then
    raise exception 'warm introduction reason is no longer part of the explicit pairwise fit';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_warm_introduction_live_scope_before_insert
  on public.event_introduction_requests;
create trigger enforce_warm_introduction_live_scope_before_insert
before insert on public.event_introduction_requests
for each row execute function public.enforce_warm_introduction_live_scope();

revoke all on function public.event_introduction_pair_in_live_field(uuid,uuid,uuid,numeric) from public;
revoke all on function public.event_introduction_participant_live(uuid,uuid) from public;
revoke all on function public.enforce_warm_introduction_live_scope() from public;

comment on function public.event_introduction_pair_in_live_field(uuid,uuid,uuid,numeric) is
  'Server-side live-field proof for warm introduction admission. Requires fresh requester and target fixes and bounded physical distance; never releases coordinates.';
comment on function public.find_event_introduction_connector(uuid,uuid,uuid) is
  'Selects one opted-in live connector with verified mutual edges to both sides, bounded workload, bilateral block safety, and deterministic pair-based distribution. It never exposes a connector list or graph score.';
