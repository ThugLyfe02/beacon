-- Participant-facing venue service guidance
-- Extends the existing coarse wait-status surface with a short-horizon direction
-- of change without exposing queue counts, arrival counts, or raw history.

create or replace function public.get_live_venue_service_guidance(p_event_id uuid)
returns table (
  service_point_id text,
  zone_id text,
  kind text,
  status text,
  wait_band text,
  trend text,
  confidence numeric,
  observed_at timestamptz
)
language plpgsql
stable
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

  -- Closed events retain host-private operational evidence, but participant live
  -- guidance disappears immediately when the event is no longer operational.
  if not public.is_event_operational(p_event_id) then
    return;
  end if;

  return query
  with ranked as (
    select
      s.*,
      row_number() over (
        partition by s.service_point_id
        order by s.observed_at desc, s.id desc
      ) as rn
    from public.venue_service_point_samples s
    where s.event_id = p_event_id
      and s.observed_at >= now() - interval '8 minutes'
      and s.sample_support >= 6
      and s.confidence >= 0.60
  ), paired as (
    select
      current_row.service_point_id,
      current_row.zone_id,
      current_row.kind,
      current_row.queue_length,
      current_row.arrivals,
      current_row.completions,
      current_row.window_minutes,
      current_row.sample_support,
      current_row.confidence,
      current_row.observed_at,
      previous_row.queue_length as previous_queue_length,
      previous_row.arrivals as previous_arrivals,
      previous_row.completions as previous_completions
    from ranked current_row
    left join ranked previous_row
      on previous_row.service_point_id = current_row.service_point_id
     and previous_row.rn = 2
    where current_row.rn = 1
      and current_row.observed_at >= now() - interval '2 minutes'
      and current_row.sample_support >= 8
      and current_row.confidence >= 0.72
  ), evaluated as (
    select
      p.*,
      case
        when p.completions <= 0 or p.window_minutes <= 0 then null
        else p.queue_length / greatest(0.01, p.completions / p.window_minutes)
      end as wait_minutes,
      case
        when p.window_minutes <= 0 then null
        else p.arrivals / p.window_minutes
      end as arrival_rate,
      case
        when p.window_minutes <= 0 then null
        else p.completions / p.window_minutes
      end as completion_rate
    from paired p
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
    case
      when e.previous_queue_length is null then 'unknown'
      when e.queue_length <= greatest(0, e.previous_queue_length - 3)
        and e.completions >= e.arrivals * 0.80 then 'easing'
      when e.queue_length >= e.previous_queue_length + 3
        or e.arrivals > e.completions * 1.15 then 'building'
      else 'stable'
    end::text as trend,
    e.confidence,
    e.observed_at
  from evaluated e
  order by
    case
      when e.queue_length = 0 and coalesce(e.arrival_rate, 0) <= coalesce(e.completion_rate, 0) then 0
      when e.wait_minutes is not null and e.wait_minutes < 5 then 1
      when e.wait_minutes is not null and e.wait_minutes < 10 then 2
      when e.wait_minutes is not null and e.wait_minutes < 20 then 3
      else 4
    end,
    e.service_point_id;
end;
$$;

revoke all on function public.get_live_venue_service_guidance(uuid) from public;
grant execute on function public.get_live_venue_service_guidance(uuid) to authenticated;

comment on function public.get_live_venue_service_guidance(uuid) is
  'Returns recent participant-safe service condition, coarse wait band, and coarse trend for approved event members. No raw queue counts or service history are released.';
