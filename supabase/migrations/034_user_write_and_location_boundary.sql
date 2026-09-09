-- =============================================================================
-- 034_user_write_and_location_boundary.sql
-- Replaces broad self-row mutation with explicit column privileges and moves
-- precise location publication behind a live-event SECURITY DEFINER boundary.
-- =============================================================================

-- RLS answers *which rows* a user may update; it does not constrain *which
-- columns*. The previous self-update policies therefore could not protect
-- is_premium or other server-owned fields from a modified client.
drop policy if exists "users: self update" on public.users;
drop policy if exists "users_update_own" on public.users;

create policy "users_update_own_profile"
on public.users for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Remove table-wide UPDATE and return only the columns the mobile client owns.
revoke update on table public.users from authenticated;
revoke update on table public.users from anon;

grant update (
  name,
  role,
  one_liner,
  is_discoverable,
  avatar_url_3d,
  expo_push_token
) on public.users to authenticated;

-- Turning discoverability off also destroys the last stored precise fix. This is
-- enforced below the client so opt-out semantics survive modified applications.
create or replace function public.clear_location_when_hidden()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_discoverable is distinct from false
     and new.is_discoverable = false then
    new.last_known_lat := null;
    new.last_known_lng := null;
    new.last_location_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_location_when_hidden on public.users;
create trigger clear_location_when_hidden
before update of is_discoverable on public.users
for each row execute function public.clear_location_when_hidden();

-- Precise fixes may be stored only while the caller is discoverable and inside a
-- live event in which they are approved. The raw coordinates remain server-side;
-- peer clients receive only migration 032's computed/quantized vectors.
create or replace function public.publish_event_location(
  p_event_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_location_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid location coordinates';
  end if;

  if not public.event_accepts_live_actions(p_event_id) then
    raise exception 'Event is not accepting live location publication';
  end if;

  if not public.is_approved_participant(p_event_id, auth.uid()) then
    raise exception 'Approved event participation required';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = auth.uid() and coalesce(u.is_discoverable, false) = true
  ) then
    raise exception 'Discoverability must be enabled before publishing location';
  end if;

  select u.last_location_at into v_last_location_at
  from public.users u
  where u.id = auth.uid();

  -- Prevent high-frequency location write amplification while still supporting
  -- smooth five-second PresenceEngine refreshes and normal native watchers.
  if v_last_location_at is not null
     and v_last_location_at > now() - interval '2 seconds' then
    return false;
  end if;

  update public.users
  set last_known_lat = p_latitude,
      last_known_lng = p_longitude,
      last_location_at = now(),
      updated_at = now()
  where id = auth.uid();

  return found;
end;
$$;

revoke all on function public.publish_event_location(uuid, double precision, double precision) from public;
grant execute on function public.publish_event_location(uuid, double precision, double precision) to authenticated;

-- No client role receives direct location-column mutation after this migration.
revoke update (last_known_lat, last_known_lng, last_location_at) on public.users from authenticated;
revoke update (is_premium, premium_since) on public.users from authenticated;

comment on function public.publish_event_location(uuid, double precision, double precision) is
  'Publishes the caller location only inside an approved live event while discoverability is enabled; peer coordinates are never directly exposed.';
