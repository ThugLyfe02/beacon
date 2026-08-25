-- Atomic hosted-event creation
-- Creating an event and establishing host membership is one database transaction.
-- A process/network failure can no longer strand a hostless event between two
-- client-side mutations, and join-code generation no longer depends on client RNG.

create extension if not exists pgcrypto;

create or replace function public.generate_event_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text := '';
  v_index integer;
begin
  v_bytes := gen_random_bytes(6);
  for v_index in 0..5 loop
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1,
      1
    );
  end loop;
  return v_code;
end;
$$;

revoke all on function public.generate_event_join_code() from public;

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
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns public.events
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event public.events;
  v_join_code text;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'event name is required';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'event end time must be after its start time';
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90) then
    raise exception 'latitude outside valid range';
  end if;
  if p_longitude is not null and (p_longitude < -180 or p_longitude > 180) then
    raise exception 'longitude outside valid range';
  end if;

  for v_attempt in 1..10 loop
    v_join_code := public.generate_event_join_code();
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
        left(trim(p_name), 200),
        nullif(left(trim(coalesce(p_description, '')), 4000), ''),
        v_join_code,
        coalesce(p_location_type, 'fixed'::public.location_type),
        p_latitude,
        p_longitude,
        nullif(left(trim(coalesce(p_address, '')), 500), ''),
        coalesce(p_requires_approval, true),
        nullif(left(trim(coalesce(p_access_code, '')), 120), ''),
        coalesce(p_show_participant_count, false),
        p_starts_at,
        p_ends_at
      )
      returning * into v_event;

      -- Same transaction as the event row: either the host has approved
      -- membership when the function commits, or the event does not exist.
      insert into public.event_participants (event_id, user_id, status)
      values (v_event.id, auth.uid(), 'approved'::public.participant_status)
      on conflict (event_id, user_id) do update
        set status = 'approved'::public.participant_status;

      return v_event;
    exception
      when unique_violation then
        -- The only intentionally retried collision is the human-readable join
        -- code. Any other constraint problem should escape rather than being
        -- hidden behind an infinite retry loop.
        if exists (select 1 from public.events e where e.join_code = v_join_code) then
          continue;
        end if;
        raise;
    end;
  end loop;

  raise exception 'could not allocate a unique event join code';
end;
$$;

revoke all on function public.create_hosted_event(
  text,text,public.location_type,numeric,numeric,text,boolean,text,boolean,timestamptz,timestamptz
) from public;
grant execute on function public.create_hosted_event(
  text,text,public.location_type,numeric,numeric,text,boolean,text,boolean,timestamptz,timestamptz
) to authenticated;

comment on function public.create_hosted_event(
  text,text,public.location_type,numeric,numeric,text,boolean,text,boolean,timestamptz,timestamptz
) is 'Atomically creates an authenticated host event and approved host membership with a server-generated join code.';
