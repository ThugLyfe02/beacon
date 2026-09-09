-- =============================================================================
-- 036_atomic_event_creation_and_access_secrets.sql
-- Server-authoritative event creation and access-code handling.
--
-- Closes two legacy gaps:
--   1. Direct event_participants INSERT could let a modified client choose its
--      own participant status instead of using the join/approval protocol.
--   2. Event access bypass codes lived as plaintext on the broadly readable
--      events row.
--
-- New invariants:
--   * event creation + host approval row are one atomic SECURITY DEFINER RPC;
--   * ordinary clients cannot INSERT events or participant rows directly;
--   * access codes are bcrypt hashes in a no-client-policy secret table;
--   * pre-membership join lookup never returns exact venue coordinates/address;
--   * access-code approval remains actor-bound and rate-limited.
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.event_access_secrets (
  event_id uuid primary key references public.events(id) on delete cascade,
  access_code_hash text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

alter table public.event_access_secrets enable row level security;
-- Intentionally no direct client policies. Secrets are write/read only through
-- the controlled functions in this migration.

-- Migrate any historical plaintext access code before clearing the public row.
insert into public.event_access_secrets (event_id, access_code_hash)
select e.id, crypt(upper(trim(e.access_code)), gen_salt('bf', 10))
from public.events e
where nullif(trim(e.access_code), '') is not null
on conflict (event_id) do nothing;

update public.events
set access_code = null
where access_code is not null;

-- Direct event/participant creation is retired. SECURITY DEFINER RPCs below and
-- request_to_join_event remain the only client-facing creation paths.
drop policy if exists "events: host insert" on public.events;
revoke insert on table public.events from authenticated;
revoke insert on table public.events from anon;

drop policy if exists "event_participants: request join open event" on public.event_participants;
drop policy if exists "event_participants: request join" on public.event_participants;
drop policy if exists "event_participants: self insert" on public.event_participants;
revoke insert on table public.event_participants from authenticated;
revoke insert on table public.event_participants from anon;

create or replace function public.generate_human_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(6);
  v_code text := '';
  i integer;
begin
  for i in 0..5 loop
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(v_bytes, i) % length(v_alphabet)) + 1,
      1
    );
  end loop;
  return v_code;
end;
$$;
revoke all on function public.generate_human_join_code() from public;

create or replace function public.create_hosted_event(
  p_name text,
  p_description text,
  p_location_type public.location_type,
  p_latitude numeric,
  p_longitude numeric,
  p_address text,
  p_requires_approval boolean,
  p_access_code text,
  p_show_participant_count boolean,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_code text;
  v_attempt integer := 0;
  v_access text := nullif(upper(trim(p_access_code)), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 100 then
    raise exception 'Event name must be between 1 and 100 characters';
  end if;

  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'Event description is too long';
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'Invalid event latitude';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'Invalid event longitude';
  end if;

  if p_location_type = 'fixed' and nullif(trim(p_address), '') is null then
    raise exception 'A fixed event requires an address';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'Event end time must be after its start time';
  end if;

  if exists (
    select 1 from public.events e
    where e.host_id = auth.uid() and e.finalized_at is null
  ) then
    raise exception 'Finalize the existing hosted event before creating another';
  end if;

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 8 then
      raise exception 'Could not allocate a unique event join code';
    end if;

    v_code := public.generate_human_join_code();
    begin
      insert into public.events (
        host_id,
        name,
        description,
        join_code,
        location_type,
        latitude,
        longitude,
        address,
        requires_approval,
        access_code,
        show_participant_count,
        starts_at,
        ends_at
      ) values (
        auth.uid(),
        trim(p_name),
        nullif(trim(p_description), ''),
        v_code,
        p_location_type,
        p_latitude,
        p_longitude,
        case when p_location_type = 'fixed' then nullif(trim(p_address), '') else null end,
        coalesce(p_requires_approval, true),
        null,
        coalesce(p_show_participant_count, false),
        p_starts_at,
        p_ends_at
      )
      returning * into v_event;
      exit;
    exception when unique_violation then
      -- Join-code collision: retry with fresh cryptographic entropy.
    end;
  end loop;

  insert into public.event_participants (event_id, user_id, status)
  values (v_event.id, auth.uid(), 'approved');

  if v_access is not null then
    insert into public.event_access_secrets (event_id, access_code_hash)
    values (v_event.id, crypt(v_access, gen_salt('bf', 10)));
  end if;

  return v_event;
end;
$$;

revoke all on function public.create_hosted_event(
  text, text, public.location_type, numeric, numeric, text,
  boolean, text, boolean, timestamptz, timestamptz
) from public;
grant execute on function public.create_hosted_event(
  text, text, public.location_type, numeric, numeric, text,
  boolean, text, boolean, timestamptz, timestamptz
) to authenticated;

-- Host-only rotation/removal. The plaintext code exists only in this function's
-- argument for the duration of the transaction and is never written to events.
create or replace function public.set_event_access_code(
  p_event_id uuid,
  p_access_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access text := nullif(upper(trim(p_access_code)), '');
begin
  if auth.uid() is null
     or not public.is_event_host(p_event_id, auth.uid())
     or not public.event_accepts_join_requests(p_event_id) then
    raise exception 'Only the host can rotate access during an open event';
  end if;

  if v_access is null then
    delete from public.event_access_secrets where event_id = p_event_id;
    return true;
  end if;

  insert into public.event_access_secrets (event_id, access_code_hash, rotated_at)
  values (p_event_id, crypt(v_access, gen_salt('bf', 10)), now())
  on conflict (event_id) do update
    set access_code_hash = excluded.access_code_hash,
        rotated_at = now();

  return true;
end;
$$;
revoke all on function public.set_event_access_code(uuid, text) from public;
grant execute on function public.set_event_access_code(uuid, text) to authenticated;

-- Replace plaintext comparison with bcrypt verification. Caller binding and
-- rate limiting from migration 032 remain intact.
create or replace function public.approve_participant_with_code(
  p_event_id uuid,
  p_user_id uuid,
  p_access_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_recent_failures integer;
  v_success boolean := false;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'Access-code approval may only target the authenticated user';
  end if;
  if not public.event_accepts_join_requests(p_event_id) then
    raise exception 'Event is no longer accepting join requests';
  end if;

  select count(*) into v_recent_failures
  from public.event_access_code_attempts a
  where a.actor_id = auth.uid()
    and a.event_id = p_event_id
    and a.succeeded = false
    and a.attempted_at > now() - interval '10 minutes';

  if v_recent_failures >= 8 then
    raise exception 'Too many invalid access-code attempts; try again later';
  end if;

  select s.access_code_hash into v_hash
  from public.event_access_secrets s
  where s.event_id = p_event_id;

  v_success := v_hash is not null
    and nullif(trim(p_access_code), '') is not null
    and crypt(upper(trim(p_access_code)), v_hash) = v_hash;

  insert into public.event_access_code_attempts (actor_id, event_id, succeeded)
  values (auth.uid(), p_event_id, v_success);

  if not v_success then return false; end if;

  update public.event_participants
  set status = 'approved'
  where event_id = p_event_id
    and user_id = auth.uid()
    and status = 'pending';

  return found;
end;
$$;
revoke all on function public.approve_participant_with_code(uuid, uuid, text) from public;
grant execute on function public.approve_participant_with_code(uuid, uuid, text) to authenticated;

-- Pre-membership lookup is discovery metadata, not a venue-location disclosure.
-- Approved participants and hosts retrieve full event coordinates later through
-- ordinary event RLS after membership exists.
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
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    e.id,
    e.host_id,
    e.name,
    e.description,
    e.join_code,
    e.location_type,
    case
      when public.is_event_host(e.id, auth.uid())
        or public.is_approved_participant(e.id, auth.uid())
      then e.latitude else null::numeric
    end,
    case
      when public.is_event_host(e.id, auth.uid())
        or public.is_approved_participant(e.id, auth.uid())
      then e.longitude else null::numeric
    end,
    case
      when public.is_event_host(e.id, auth.uid())
        or public.is_approved_participant(e.id, auth.uid())
      then e.address else null::text
    end,
    e.requires_approval,
    null::text,
    e.show_participant_count,
    e.starts_at,
    e.ends_at,
    e.created_at
  from public.events e
  where e.join_code = upper(trim(p_join_code))
    and e.finalized_at is null
    and (e.ends_at is null or e.ends_at > now())
  limit 1;
end;
$$;
revoke all on function public.get_event_by_join_code(text) from public;
grant execute on function public.get_event_by_join_code(text) to authenticated;

comment on table public.event_access_secrets is
  'Bcrypt-protected event bypass codes. No direct client read/write policy.';
comment on function public.create_hosted_event(
  text, text, public.location_type, numeric, numeric, text,
  boolean, text, boolean, timestamptz, timestamptz
) is 'Atomically creates a hosted event, approved host membership, cryptographic join code, and optional protected access secret.';
