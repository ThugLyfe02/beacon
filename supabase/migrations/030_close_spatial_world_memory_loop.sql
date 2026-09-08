-- =============================================================================
-- 030_close_spatial_world_memory_loop.sql
-- Closes Beacon's privacy-preserving venue learning loop.
--
-- World memory is derived only from finalized, server-verifiable event outcomes.
-- It deliberately does NOT persist attendee movement trails, person-level paths,
-- raw bearings, or inferred behavior. Sector memory remains unknown until a
-- future trusted aggregate source exists; we do not manufacture it from clients.
-- =============================================================================

create or replace function public.compute_world_memory_venue_key(
  p_address text,
  p_latitude numeric,
  p_longitude numeric,
  p_event_id uuid
)
returns text
language sql
stable
as $$
  select case
    when p_latitude is not null and p_longitude is not null then
      'geo:'
      || to_char(round(p_latitude, 3), 'FM999990.000')
      || ':'
      || to_char(round(p_longitude, 3), 'FM999990.000')
    when nullif(trim(p_address), '') is not null then
      'address:' || left(
        lower(regexp_replace(trim(p_address), '[[:space:]]+', ' ', 'g')),
        120
      )
    else 'event:' || p_event_id::text
  end;
$$;

comment on function public.compute_world_memory_venue_key(text, numeric, numeric, uuid) is
  'Stable privacy-preserving venue key. Coordinate keys are rounded to three decimal places and exact attendee location history is never stored.';

-- The original read policy confidence-gated rows but did not actually verify the
-- caller had access to an event at that venue. Mature aggregate memory should be
-- available to relevant event participants/hosts, not act as a globally
-- queryable authenticated venue-intelligence table.
drop policy if exists "approved participants can read mature venue memory"
  on public.venue_world_memory;

drop policy if exists "relevant participants can read mature venue memory"
  on public.venue_world_memory;

create policy "relevant participants can read mature venue memory"
on public.venue_world_memory for select
to authenticated
using (
  sample_size >= 3
  and confidence >= 0.45
  and exists (
    select 1
    from public.events e
    where public.compute_world_memory_venue_key(
      e.address,
      e.latitude,
      e.longitude,
      e.id
    ) = venue_world_memory.venue_key
      and (
        public.is_event_host(e.id, auth.uid())
        or public.is_approved_participant(e.id, auth.uid())
      )
  )
);

create or replace function public.capture_finalized_world_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_venue_key text;
  v_first_mutual_at timestamptz;
  v_first_mutual_minute numeric;
begin
  select * into v_event
  from public.events e
  where e.id = new.event_id;

  if v_event.id is null then
    return new;
  end if;

  -- Outcome snapshots can be captured during an event for organizer diagnostics.
  -- Those partial snapshots must never train venue memory. Learning begins only
  -- after the declared event end time has passed.
  if v_event.ends_at is null or now() < v_event.ends_at then
    return new;
  end if;

  -- Tiny/private test events should not shape repeated-venue behavior. They can
  -- still use the ordinary live field; they simply do not become learning data.
  if new.approved_participants < 3 then
    return new;
  end if;

  v_venue_key := public.compute_world_memory_venue_key(
    v_event.address,
    v_event.latitude,
    v_event.longitude,
    v_event.id
  );

  if v_event.starts_at is not null then
    select min(m.created_at)
    into v_first_mutual_at
    from public.matches m
    where m.event_id = new.event_id;

    if v_first_mutual_at is not null then
      v_first_mutual_minute := greatest(
        0::numeric,
        extract(epoch from (v_first_mutual_at - v_event.starts_at))::numeric / 60
      );
    end if;
  end if;

  insert into public.event_world_observations (
    event_id,
    venue_key,
    first_mutual_minute,
    signals_sent,
    mutuals_created,
    office_hours_requests,
    office_hours_outcomes,
    cold_signal_outcomes,
    peak_sector,
    peak_minute_of_day,
    participant_count,
    finalized_at
  ) values (
    new.event_id,
    v_venue_key,
    v_first_mutual_minute,
    new.signals_sent,
    new.mutuals_formed,
    new.office_hours_requested,
    new.office_hours_completed,
    -- A cold-signal conversion is grounded in a verified mutual. We intentionally
    -- do not claim that later business outcomes were caused by a specific signal.
    new.mutuals_formed,
    -- No raw bearing/movement history is persisted, so sector learning stays
    -- unknown rather than fabricating spatial certainty.
    'unknown',
    null,
    new.approved_participants,
    now()
  )
  on conflict (event_id) do update set
    venue_key = excluded.venue_key,
    first_mutual_minute = excluded.first_mutual_minute,
    signals_sent = excluded.signals_sent,
    mutuals_created = excluded.mutuals_created,
    office_hours_requests = excluded.office_hours_requests,
    office_hours_outcomes = excluded.office_hours_outcomes,
    cold_signal_outcomes = excluded.cold_signal_outcomes,
    peak_sector = excluded.peak_sector,
    peak_minute_of_day = excluded.peak_minute_of_day,
    participant_count = excluded.participant_count,
    finalized_at = now();

  perform public.refresh_venue_world_memory(v_venue_key);
  return new;
end;
$$;

revoke all on function public.capture_finalized_world_observation() from public;

-- event_outcome_snapshots cannot be inserted by ordinary clients; snapshots are
-- created by the host-authorized SECURITY DEFINER outcome-intelligence RPC. The
-- trigger therefore turns an already trusted aggregate snapshot into one
-- idempotent event observation without creating a second client write surface.
drop trigger if exists finalized_world_observation_from_outcome_snapshot
  on public.event_outcome_snapshots;

create trigger finalized_world_observation_from_outcome_snapshot
after insert or update on public.event_outcome_snapshots
for each row execute function public.capture_finalized_world_observation();

comment on table public.event_world_observations is
  'One finalized aggregate observation per event. Contains verified event-level outcomes only; no attendee movement trails or person-level behavioral history.';
