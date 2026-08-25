-- Event runtime invariants
-- Client convenience code is not a security boundary. These database rules make
-- closed-event state and server-authorized join/signal paths authoritative even
-- when a modified client bypasses the normal React Native services.

-- ended_at is lifecycle state owned by the end_event SECURITY DEFINER function.
-- Hosts retain ordinary edit rights, but an authenticated client cannot directly
-- manufacture or clear the event-close timestamp.
revoke update on public.events from authenticated;
grant update (
  name,
  description,
  location_type,
  latitude,
  longitude,
  address,
  requires_approval,
  access_code,
  show_participant_count,
  starts_at,
  ends_at
) on public.events to authenticated;

create or replace function public.reject_closed_event_updates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.ended_at is not null then
    raise exception 'ended events are immutable through the live event update path';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_closed_event_updates on public.events;
create trigger reject_closed_event_updates
before update on public.events
for each row
when (old.ended_at is not null)
execute function public.reject_closed_event_updates();

-- A direct participant insert previously needed only auth.uid() = user_id. That
-- allowed a modified client to choose status='approved' and bypass host approval.
-- The public client path may now create only its own pending request. The trusted
-- request_to_join_event RPC can still auto-approve events configured not to need
-- approval because SECURITY DEFINER owns that server-side decision.
drop policy if exists "event_participants: request join" on public.event_participants;
create policy "event_participants: request join"
on public.event_participants for insert
to authenticated
with check (
  auth.uid() = user_id
  and status = 'pending'::public.participant_status
  and public.is_event_operational(event_id)
);

create or replace function public.reject_closed_event_participant_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := coalesce(new.event_id, old.event_id);
  if not public.is_event_operational(v_event_id) then
    raise exception 'participant membership is closed for this event';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_closed_event_participant_insert_update on public.event_participants;
create trigger reject_closed_event_participant_insert_update
before insert or update on public.event_participants
for each row execute function public.reject_closed_event_participant_write();

-- Connection requests are scarce, security-authorized event actions. Application
-- clients no longer receive direct INSERT/UPDATE authority; the atomic
-- secure_send_connection_request RPC is the only authenticated activation path.
revoke insert, update on public.connection_requests from authenticated;

create or replace function public.reject_closed_event_connection_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := coalesce(new.event_id, old.event_id);
  if not public.is_event_operational(v_event_id) then
    raise exception 'connection actions are closed for this event';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_closed_event_connection_insert_update on public.connection_requests;
create trigger reject_closed_event_connection_insert_update
before insert or update on public.connection_requests
for each row execute function public.reject_closed_event_connection_write();

-- Participant-safe queue/service status must disappear when the event closes even
-- if recent service samples still exist for post-event host analysis.
create or replace function public.get_venue_service_status(p_event_id uuid)
returns table (
  service_point_id text,
  zone_id text,
  kind text,
  status text,
  wait_band text,
  confidence numeric,
  observed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (s.service_point_id)
      s.service_point_id,
      s.zone_id,
      s.kind,
      s.queue_length,
      s.arrivals,
      s.completions,
      s.window_minutes,
      s.sample_support,
      s.confidence,
      s.observed_at
    from public.venue_service_point_samples s
    where s.event_id = p_event_id
      and s.observed_at >= now() - interval '2 minutes'
      and s.sample_support >= 8
      and s.confidence >= 0.72
    order by s.service_point_id, s.observed_at desc
  )
  select
    l.service_point_id,
    l.zone_id,
    l.kind,
    case
      when l.queue_length = 0 then 'clear'
      when l.completions > 0 and l.arrivals <= l.completions then 'steady'
      else 'busy'
    end as status,
    case
      when l.completions <= 0 then 'unknown'
      when (l.queue_length / greatest(l.completions / l.window_minutes, 0.01)) < 5 then '<5 min'
      when (l.queue_length / greatest(l.completions / l.window_minutes, 0.01)) < 10 then '5-10 min'
      when (l.queue_length / greatest(l.completions / l.window_minutes, 0.01)) < 20 then '10-20 min'
      else '20+ min'
    end as wait_band,
    l.confidence,
    l.observed_at
  from latest l
  where public.is_event_operational(p_event_id)
    and public.is_approved_participant(p_event_id, auth.uid())
  order by l.service_point_id;
$$;

revoke all on function public.get_venue_service_status(uuid) from public;
grant execute on function public.get_venue_service_status(uuid) to authenticated;

comment on function public.reject_closed_event_participant_write() is
  'Database-level invariant preventing insert/update membership changes after event closure.';
comment on function public.reject_closed_event_connection_write() is
  'Database-level invariant preventing connection mutation after event closure.';
