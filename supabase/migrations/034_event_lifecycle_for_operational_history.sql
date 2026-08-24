-- Event lifecycle for operational history
-- Venue intervention evidence cannot compound if ending an event hard-deletes the
-- event row and cascades through every measurement. End is therefore separated
-- from destructive deletion.

alter table public.events
  add column if not exists ended_at timestamptz;

create index if not exists events_active_host_idx
  on public.events (host_id, created_at desc)
  where ended_at is null;

create index if not exists events_active_join_code_idx
  on public.events (join_code)
  where ended_at is null;

create or replace function public.is_event_operational(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.ended_at is null
      and (e.ends_at is null or e.ends_at > now())
  );
$$;

create or replace function public.end_event(p_event_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ended_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;

  update public.events
  set
    ended_at = coalesce(ended_at, now()),
    latitude = null,
    longitude = null
  where id = p_event_id
  returning ended_at into v_ended_at;

  if v_ended_at is null then
    raise exception 'event not found';
  end if;

  -- Revoke any still-live command authority. Historical admission rows remain
  -- inspectable, but none should survive event closure as executable evidence.
  update public.venue_admitted_commands
  set revoked_at = coalesce(revoked_at, v_ended_at)
  where event_id = p_event_id
    and revoked_at is null;

  return v_ended_at;
end;
$$;

revoke all on function public.is_event_operational(uuid) from public;
revoke all on function public.end_event(uuid) from public;
grant execute on function public.is_event_operational(uuid) to authenticated;
grant execute on function public.end_event(uuid) to authenticated;

comment on column public.events.ended_at is
  'Explicit event close timestamp. Ended events remain available for authorized recap and aggregate operational learning instead of being hard-deleted.';
