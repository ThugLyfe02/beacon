-- Spatial World Memory
-- Stores venue-level aggregate learning only. No attendee movement trails or
-- person-level behavioral dossiers are persisted by this system.

create table if not exists public.venue_world_memory (
  venue_key text primary key,
  sample_size integer not null default 0 check (sample_size >= 0),
  median_first_mutual_minute numeric,
  office_hours_conversion_rate numeric check (office_hours_conversion_rate between 0 and 1),
  cold_signal_conversion_rate numeric check (cold_signal_conversion_rate between 0 and 1),
  peak_sector text not null default 'unknown' check (peak_sector in ('north','east','south','west','unknown')),
  peak_minute_of_day integer check (peak_minute_of_day between 0 and 1439),
  confidence numeric not null default 0 check (confidence between 0 and 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_world_observations (
  event_id uuid primary key references public.events(id) on delete cascade,
  venue_key text not null,
  first_mutual_minute numeric,
  signals_sent integer not null default 0 check (signals_sent >= 0),
  mutuals_created integer not null default 0 check (mutuals_created >= 0),
  office_hours_requests integer not null default 0 check (office_hours_requests >= 0),
  office_hours_outcomes integer not null default 0 check (office_hours_outcomes >= 0),
  cold_signal_outcomes integer not null default 0 check (cold_signal_outcomes >= 0),
  peak_sector text not null default 'unknown' check (peak_sector in ('north','east','south','west','unknown')),
  peak_minute_of_day integer check (peak_minute_of_day between 0 and 1439),
  participant_count integer not null default 0 check (participant_count >= 0),
  finalized_at timestamptz not null default now()
);

alter table public.venue_world_memory enable row level security;
alter table public.event_world_observations enable row level security;

-- Memory becomes visible only after enough independent events exist. This avoids
-- presenting fragile single-event behavior as learned truth.
create policy "approved participants can read mature venue memory"
on public.venue_world_memory for select
to authenticated
using (sample_size >= 3 and confidence >= 0.45);

-- Event observations are host-readable only. Client inserts are intentionally
-- absent; trusted server-side aggregation should write these records.
create policy "event hosts can read their aggregate world observations"
on public.event_world_observations for select
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_world_observations.event_id
      and e.host_id = auth.uid()
  )
);

create index if not exists event_world_observations_venue_key_idx
  on public.event_world_observations (venue_key, finalized_at desc);

create or replace function public.refresh_venue_world_memory(p_venue_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sample_size integer;
  v_median numeric;
  v_office_rate numeric;
  v_cold_rate numeric;
  v_peak_sector text;
  v_peak_minute integer;
  v_confidence numeric;
begin
  select count(*)::integer,
         percentile_cont(0.5) within group (order by first_mutual_minute)
    into v_sample_size, v_median
  from public.event_world_observations
  where venue_key = p_venue_key;

  if v_sample_size = 0 then return; end if;

  select
    case when sum(office_hours_requests) > 0
      then sum(office_hours_outcomes)::numeric / sum(office_hours_requests)
      else null end,
    case when sum(signals_sent) > 0
      then sum(cold_signal_outcomes)::numeric / sum(signals_sent)
      else null end
    into v_office_rate, v_cold_rate
  from public.event_world_observations
  where venue_key = p_venue_key;

  select peak_sector
    into v_peak_sector
  from public.event_world_observations
  where venue_key = p_venue_key and peak_sector <> 'unknown'
  group by peak_sector
  order by count(*) desc, peak_sector asc
  limit 1;

  select round(avg(peak_minute_of_day))::integer
    into v_peak_minute
  from public.event_world_observations
  where venue_key = p_venue_key and peak_minute_of_day is not null;

  -- Confidence rises gradually with independent events and remains capped.
  v_confidence := least(0.96, greatest(0, 1 - exp(-v_sample_size::numeric / 6)));

  insert into public.venue_world_memory (
    venue_key,
    sample_size,
    median_first_mutual_minute,
    office_hours_conversion_rate,
    cold_signal_conversion_rate,
    peak_sector,
    peak_minute_of_day,
    confidence,
    updated_at
  ) values (
    p_venue_key,
    v_sample_size,
    v_median,
    v_office_rate,
    v_cold_rate,
    coalesce(v_peak_sector, 'unknown'),
    v_peak_minute,
    v_confidence,
    now()
  )
  on conflict (venue_key) do update set
    sample_size = excluded.sample_size,
    median_first_mutual_minute = excluded.median_first_mutual_minute,
    office_hours_conversion_rate = excluded.office_hours_conversion_rate,
    cold_signal_conversion_rate = excluded.cold_signal_conversion_rate,
    peak_sector = excluded.peak_sector,
    peak_minute_of_day = excluded.peak_minute_of_day,
    confidence = excluded.confidence,
    updated_at = now();
end;
$$;

revoke all on function public.refresh_venue_world_memory(text) from public;
grant execute on function public.refresh_venue_world_memory(text) to service_role;
