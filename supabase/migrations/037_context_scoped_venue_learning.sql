-- Context-scoped venue learning
-- Measured outcomes are useful only when Beacon can tell which physical/event
-- regime produced them. This prevents a command that worked under one floorplan
-- or event scale from inheriting the same authority elsewhere by accident.

create table if not exists public.venue_learning_contexts (
  event_id uuid primary key references public.events(id) on delete cascade,
  venue_key text not null,
  context_key text not null,
  context_version text not null,
  layout_version text not null,
  geometry_hash text not null,
  total_capacity integer not null check (total_capacity >= 0),
  topology_redundancy numeric not null check (topology_redundancy between 0 and 1),
  accessible_coverage numeric not null check (accessible_coverage between 0 and 1),
  attendance_band text not null check (attendance_band in ('small','medium','large','very-large')),
  duration_band text not null check (duration_band in ('short','standard','long')),
  zone_kinds text[] not null default '{}',
  service_point_kinds text[] not null default '{}',
  program_fingerprint text,
  created_at timestamptz not null default now(),
  unique (event_id, context_key),
  check (length(trim(context_key)) >= 8),
  check (length(trim(context_version)) > 0),
  check (length(trim(layout_version)) > 0),
  check (length(trim(geometry_hash)) > 0)
);

alter table public.venue_learning_contexts enable row level security;

create policy "event operators can read venue learning context"
on public.venue_learning_contexts for select
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  or public.venue_operator_role(event_id, auth.uid()) is not null
);

-- Context manifests are trusted aggregation metadata. Clients can inspect the
-- context but cannot rewrite history to make an old intervention look compatible
-- with a new venue configuration.
revoke insert, update, delete on public.venue_learning_contexts from authenticated;

alter table public.venue_intervention_measurements
  add column if not exists learning_context_key text;

create index if not exists venue_intervention_measurements_context_idx
  on public.venue_intervention_measurements (learning_context_key, measured_at desc)
  where learning_context_key is not null;

create index if not exists venue_learning_contexts_venue_idx
  on public.venue_learning_contexts (venue_key, created_at desc);

create or replace function public.get_venue_learning_context(p_event_id uuid)
returns table (
  event_id uuid,
  venue_key text,
  context_key text,
  context_version text,
  layout_version text,
  geometry_hash text,
  total_capacity integer,
  topology_redundancy numeric,
  accessible_coverage numeric,
  attendance_band text,
  duration_band text,
  zone_kinds text[],
  service_point_kinds text[],
  program_fingerprint text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.event_id,
    c.venue_key,
    c.context_key,
    c.context_version,
    c.layout_version,
    c.geometry_hash,
    c.total_capacity,
    c.topology_redundancy,
    c.accessible_coverage,
    c.attendance_band,
    c.duration_band,
    c.zone_kinds,
    c.service_point_kinds,
    c.program_fingerprint,
    c.created_at
  from public.venue_learning_contexts c
  where c.event_id = p_event_id
    and (
      public.is_event_host(c.event_id, auth.uid())
      or public.venue_operator_role(c.event_id, auth.uid()) is not null
    );
$$;

revoke all on function public.get_venue_learning_context(uuid) from public;
grant execute on function public.get_venue_learning_context(uuid) to authenticated;

comment on table public.venue_learning_contexts is
  'Aggregate event operating context used to prevent learned venue outcomes from being transferred across incompatible physical or event regimes.';
