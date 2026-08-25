-- Host-private venue portfolio
-- Keeps post-event value accessible after the live event closes. Portfolio
-- metrics are computed only from events owned by auth.uid(); this is not a
-- cross-customer benchmark and does not expose attendee-level history.

create or replace function public.get_host_venue_portfolio()
returns table (
  venue_key text,
  latest_event_id uuid,
  ended_event_count integer,
  measured_event_count integer,
  total_measured_interventions integer,
  total_positive_interventions integer,
  weighted_mean_effect numeric,
  weighted_positive_rate numeric,
  mean_measurement_confidence numeric,
  mean_evidence_coverage numeric,
  recent_mean_effect numeric,
  prior_mean_effect numeric,
  trend_delta numeric,
  last_closed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with owned as (
    select
      co.*,
      row_number() over (
        partition by co.venue_key
        order by co.closed_at desc, co.event_id
      ) as recency_rank
    from public.venue_event_closeouts co
    join public.events e on e.id = co.event_id
    where e.host_id = auth.uid()
      and e.ended_at is not null
  ), grouped as (
    select
      o.venue_key,
      (array_agg(o.event_id order by o.closed_at desc, o.event_id))[1] as latest_event_id,
      count(*)::integer as ended_event_count,
      count(*) filter (where o.measured_intervention_count > 0)::integer as measured_event_count,
      coalesce(sum(o.measured_intervention_count), 0)::integer as total_measured_interventions,
      coalesce(sum(o.positive_intervention_count), 0)::integer as total_positive_interventions,
      case
        when coalesce(sum(o.measured_intervention_count), 0) > 0 then
          sum(coalesce(o.mean_measured_effect, 0) * o.measured_intervention_count)
          / sum(o.measured_intervention_count)
        else null
      end as weighted_mean_effect,
      case
        when coalesce(sum(o.measured_intervention_count), 0) > 0 then
          sum(o.positive_intervention_count)::numeric / sum(o.measured_intervention_count)
        else null
      end as weighted_positive_rate,
      case
        when coalesce(sum(o.measured_intervention_count), 0) > 0 then
          sum(coalesce(o.mean_measurement_confidence, 0) * o.measured_intervention_count)
          / sum(o.measured_intervention_count)
        else null
      end as mean_measurement_confidence,
      avg(o.evidence_coverage) as mean_evidence_coverage,
      avg(o.mean_measured_effect) filter (
        where o.recency_rank <= 3 and o.mean_measured_effect is not null
      ) as recent_mean_effect,
      avg(o.mean_measured_effect) filter (
        where o.recency_rank between 4 and 6 and o.mean_measured_effect is not null
      ) as prior_mean_effect,
      max(o.closed_at) as last_closed_at
    from owned o
    group by o.venue_key
  )
  select
    g.venue_key,
    g.latest_event_id,
    g.ended_event_count,
    g.measured_event_count,
    g.total_measured_interventions,
    g.total_positive_interventions,
    g.weighted_mean_effect,
    g.weighted_positive_rate,
    g.mean_measurement_confidence,
    g.mean_evidence_coverage,
    g.recent_mean_effect,
    g.prior_mean_effect,
    case
      when g.recent_mean_effect is not null and g.prior_mean_effect is not null
        then g.recent_mean_effect - g.prior_mean_effect
      else null
    end as trend_delta,
    g.last_closed_at
  from grouped g
  order by g.last_closed_at desc, g.venue_key;
$$;

create or replace function public.has_hosted_event_history()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.host_id = auth.uid()
  );
$$;

revoke all on function public.get_host_venue_portfolio() from public;
revoke all on function public.has_hosted_event_history() from public;
grant execute on function public.get_host_venue_portfolio() to authenticated;
grant execute on function public.has_hosted_event_history() to authenticated;

comment on function public.get_host_venue_portfolio() is
  'Returns aggregate closeout performance for the authenticated host own venues. No cross-customer benchmark or attendee trajectory data is released.';
comment on function public.has_hosted_event_history() is
  'Returns whether the authenticated user owns any event history, allowing the host workspace to remain available after live closure.';
