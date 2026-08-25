-- Live aggregate sensor feed
-- Provides the app-side consensus pipeline with only recent observations from
-- active sources bound to the current release. This is an operator surface, not
-- a generic raw-history API.

create or replace function public.get_recent_venue_sensor_observations(
  p_event_id uuid,
  p_since timestamptz default null,
  p_limit integer default 500
)
returns table (
  observation_id bigint,
  venue_id text,
  layout_version text,
  source_id uuid,
  source_kind text,
  kind text,
  sequence bigint,
  observed_at timestamptz,
  received_at timestamptz,
  confidence numeric,
  payload jsonb,
  record_hash text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_limit integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not (
    public.is_event_host(p_event_id, auth.uid())
    or public.venue_operator_role(p_event_id, auth.uid()) is not null
  ) then
    raise exception 'venue operator scope required';
  end if;
  if not public.is_event_operational(p_event_id) then
    return;
  end if;

  v_since := greatest(coalesce(p_since, now() - interval '2 minutes'), now() - interval '10 minutes');
  v_limit := greatest(1, least(coalesce(p_limit, 500), 1500));

  return query
  with active_release as (
    select r.venue_id, r.layout_version, r.observation_schema_version
    from public.venue_operation_releases r
    where r.event_id = p_event_id
      and r.retired_at is null
      and r.activated_at <= now()
      and (r.expires_at is null or r.expires_at > now())
    order by r.activated_at desc
    limit 1
  )
  select
    o.id,
    ar.venue_id,
    o.layout_version,
    o.source_id,
    s.source_kind,
    o.kind,
    o.sequence,
    o.observed_at,
    o.received_at,
    o.confidence,
    o.payload,
    o.record_hash
  from public.venue_sensor_observations o
  join public.venue_sensor_sources s
    on s.id = o.source_id
   and s.event_id = o.event_id
   and s.active = true
   and s.revoked_at is null
  cross join active_release ar
  where o.event_id = p_event_id
    and o.observed_at >= v_since
    and o.retention_until > now()
    and o.layout_version = ar.layout_version
    and o.schema_version = ar.observation_schema_version
  order by o.observed_at asc, o.source_id, o.sequence
  limit v_limit;
end;
$$;

revoke all on function public.get_recent_venue_sensor_observations(uuid,timestamptz,integer) from public;
grant execute on function public.get_recent_venue_sensor_observations(uuid,timestamptz,integer) to authenticated;

comment on function public.get_recent_venue_sensor_observations(uuid,timestamptz,integer) is
  'Returns a bounded live aggregate sensor stream to event hosts/operators. Closed events, revoked sources, stale release versions, and expired raw ingress are excluded.';
