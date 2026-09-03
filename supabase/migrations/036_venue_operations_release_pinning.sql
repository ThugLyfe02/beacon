-- Venue operations release pinning
-- A live event should not silently inherit a new model, policy, observation
-- schema, or floorplan while previously admitted commands are still in flight.

create table if not exists public.venue_operation_releases (
  event_id uuid not null references public.events(id) on delete cascade,
  release_id text not null,
  venue_key text not null,
  venue_id text not null,
  layout_version text not null,
  geometry_hash text not null,
  observation_schema_version text not null,
  policy_version text not null,
  model_version text not null,
  activated_at timestamptz not null default now(),
  expires_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, release_id),
  check (length(trim(release_id)) >= 8),
  check (length(trim(layout_version)) > 0),
  check (length(trim(geometry_hash)) > 0),
  check (length(trim(observation_schema_version)) > 0),
  check (length(trim(policy_version)) > 0),
  check (length(trim(model_version)) > 0),
  check (expires_at is null or expires_at > activated_at),
  check (retired_at is null or retired_at >= activated_at)
);

alter table public.venue_operation_releases enable row level security;

create policy "event operators can read venue operation releases"
on public.venue_operation_releases for select
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  or public.venue_operator_role(event_id, auth.uid()) is not null
);

-- Release creation is a trusted control-plane operation. Application clients can
-- inspect the pinned identity but cannot hot-swap it from the device.
revoke insert, update, delete on public.venue_operation_releases from authenticated;

create unique index if not exists venue_operation_releases_one_active_idx
  on public.venue_operation_releases (event_id)
  where retired_at is null;

create index if not exists venue_operation_releases_lookup_idx
  on public.venue_operation_releases (event_id, activated_at desc);

-- Admitted commands may be bound to a release. The column is nullable during the
-- migration window so older evidence remains readable, while new trusted writers
-- can progressively require explicit release identity.
alter table public.venue_admitted_commands
  add column if not exists release_id text;

create index if not exists venue_admitted_commands_release_idx
  on public.venue_admitted_commands (event_id, release_id)
  where release_id is not null;

create or replace function public.get_active_venue_operations_release(p_event_id uuid)
returns table (
  event_id uuid,
  release_id text,
  venue_key text,
  venue_id text,
  layout_version text,
  geometry_hash text,
  observation_schema_version text,
  policy_version text,
  model_version text,
  activated_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.event_id,
    r.release_id,
    r.venue_key,
    r.venue_id,
    r.layout_version,
    r.geometry_hash,
    r.observation_schema_version,
    r.policy_version,
    r.model_version,
    r.activated_at,
    r.expires_at
  from public.venue_operation_releases r
  where r.event_id = p_event_id
    and r.retired_at is null
    and (r.expires_at is null or r.expires_at > now())
    and (
      public.is_event_host(r.event_id, auth.uid())
      or public.venue_operator_role(r.event_id, auth.uid()) is not null
    )
  order by r.activated_at desc
  limit 1;
$$;

revoke all on function public.get_active_venue_operations_release(uuid) from public;
grant execute on function public.get_active_venue_operations_release(uuid) to authenticated;

-- Event closure retires the pinned operations release automatically. Historical
-- rows remain available for replay, but no release survives as current authority.
create or replace function public.retire_venue_release_on_event_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    update public.venue_operation_releases
    set retired_at = coalesce(retired_at, new.ended_at)
    where event_id = new.id
      and retired_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists retire_venue_release_after_event_end on public.events;
create trigger retire_venue_release_after_event_end
after update of ended_at on public.events
for each row execute function public.retire_venue_release_on_event_end();

comment on table public.venue_operation_releases is
  'Pins one explicit venue/layout/schema/policy/model identity to a live operations window so mid-event hot swaps cannot silently inherit prior decision authority.';
