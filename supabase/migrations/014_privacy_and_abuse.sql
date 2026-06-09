-- =============================================================================
-- 014_privacy_and_abuse.sql
-- Phase 7: privacy hardening + abuse controls.
--   * user_blocks (bidirectional filtering)
--   * abuse_reports
--   * SECURITY DEFINER RPC: get_event_proximity_signals
--     - returns peer positions ONLY for approved, discoverable, non-blocked
--       attendees of the requested event
--   * Rate limit on connection_requests (max 60/hour per requester per event)
--   * Rate limit on office_hours_requests (max 20/hour per requester per event)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocker_idx on public.user_blocks (blocker_id);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

create policy "user_blocks_owner_all"
  on public.user_blocks
  for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Abuse reports
-- ---------------------------------------------------------------------------
create table if not exists public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  target_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  reason text not null check (length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);

create index if not exists abuse_reports_target_idx on public.abuse_reports (target_id);

alter table public.abuse_reports enable row level security;

-- Reporters can read their own. Moderators (service role) read all.
create policy "abuse_reports_reporter_select"
  on public.abuse_reports
  for select
  using (auth.uid() = reporter_id);

create policy "abuse_reports_insert_self"
  on public.abuse_reports
  for insert
  with check (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------------
-- Proximity RPC: returns peer signals scoped to approved + discoverable +
-- not-blocked attendees of the given event. SECURITY DEFINER intentionally —
-- the user RLS still only exposes the caller's own row, but presence requires
-- reading other rows in a controlled way.
-- ---------------------------------------------------------------------------
create or replace function public.get_event_proximity_signals(
  p_event_id uuid
)
returns table (
  user_id uuid,
  is_premium boolean,
  last_known_lat double precision,
  last_known_lng double precision,
  last_location_at timestamptz,
  avatar_url_3d text
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.is_premium, u.last_known_lat, u.last_known_lng,
         u.last_location_at, u.avatar_url_3d
  from public.event_participants ep
  join public.users u on u.id = ep.user_id
  where ep.event_id = p_event_id
    and ep.status = 'approved'
    and u.id <> auth.uid()
    and coalesce(u.is_discoverable, false) = true
    and exists (
      select 1 from public.event_participants me
      where me.event_id = p_event_id
        and me.user_id = auth.uid()
        and me.status = 'approved'
    )
    and not exists (
      select 1 from public.user_blocks
      where (blocker_id = auth.uid() and blocked_id = u.id)
         or (blocker_id = u.id and blocked_id = auth.uid())
    );
$$;

grant execute on function public.get_event_proximity_signals(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting via triggers
-- ---------------------------------------------------------------------------
create or replace function public.enforce_connection_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.connection_requests
  where requester_id = new.requester_id
    and event_id = new.event_id
    and created_at > now() - interval '1 hour';
  if recent_count >= 60 then
    raise exception 'Too many connection requests this hour (limit 60).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_connection_rate_limit on public.connection_requests;
create trigger trg_connection_rate_limit
  before insert on public.connection_requests
  for each row execute function public.enforce_connection_rate_limit();

create or replace function public.enforce_oh_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count int;
begin
  select count(*) into recent_count
  from public.office_hours_requests
  where requester_id = new.requester_id
    and event_id = new.event_id
    and created_at > now() - interval '1 hour';
  if recent_count >= 20 then
    raise exception 'Too many office-hours requests this hour (limit 20).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_oh_rate_limit on public.office_hours_requests;
create trigger trg_oh_rate_limit
  before insert on public.office_hours_requests
  for each row execute function public.enforce_oh_rate_limit();
