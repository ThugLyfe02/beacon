-- Participant-safe venue service status
-- Exposes only coarse, confidence-gated service conditions to approved event
-- participants and hosts. Raw queue samples remain host-only.

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
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not (
    public.is_event_host(p_event_id, auth.uid())
    or public.is_approved_participant(p_event_id, auth.uid())
  ) then
    raise exception 'approved event participation required';
  end if;

  return query
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
    order by s.service_point_id, s.observed_at desc, s.id desc
  ), evaluated as (
    select
      l.*,
      case
        when l.completions <= 0 or l.window_minutes <= 0 then null
        else l.queue_length / greatest(0.01, l.completions / l.window_minutes)
      end as wait_minutes,
      case
        when l.window_minutes <= 0 then null
        else l.arrivals / l.window_minutes
      end as arrival_rate,
      case
        when l.window_minutes <= 0 then null
        else l.completions / l.window_minutes
      end as completion_rate
    from latest l
  )
  select
    e.service_point_id,
    e.zone_id,
    e.kind,
    case
      when e.completion_rate is null then 'unknown'
      when e.queue_length = 0 and coalesce(e.arrival_rate, 0) <= coalesce(e.completion_rate, 0) then 'clear'
      when coalesce(e.arrival_rate, 0) > coalesce(e.completion_rate, 0) * 1.15 then 'busy'
      when e.wait_minutes is not null and e.wait_minutes >= 15 then 'busy'
      else 'steady'
    end::text as status,
    case
      when e.wait_minutes is null then 'unknown'
      when e.wait_minutes < 5 then '<5 min'
      when e.wait_minutes < 10 then '5-10 min'
      when e.wait_minutes < 20 then '10-20 min'
      else '20+ min'
    end::text as wait_band,
    e.confidence,
    e.observed_at
  from evaluated e
  order by
    case
      when coalesce(e.arrival_rate, 0) > coalesce(e.completion_rate, 0) * 1.15 then 0
      when e.wait_minutes is not null and e.wait_minutes >= 15 then 0
      when e.wait_minutes is not null and e.wait_minutes >= 5 then 1
      else 2
    end,
    e.service_point_id;
end;
$$;

revoke all on function public.get_venue_service_status(uuid) from public;
grant execute on function public.get_venue_service_status(uuid) to authenticated;

comment on function public.get_venue_service_status(uuid) is
  'Returns coarse, support-gated venue service conditions for approved event participants. Does not expose raw queue history or attendee movement data.';
