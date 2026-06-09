-- =============================================================================
-- 013_escort_flow.sql
-- Phase 4: Venue rooms + escort assignment.
-- Adds:
--   * venue_rooms       (per-event physical rooms a host can assign)
--   * users.expo_push_token  (so the server can notify both parties)
--   * office_hours_requests.room_id (the assignment)
-- =============================================================================

create table if not exists public.venue_rooms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null,
  capacity smallint not null default 2,
  is_busy boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists venue_rooms_event_idx
  on public.venue_rooms (event_id);

alter table public.venue_rooms enable row level security;

-- Host (event creator) can fully manage rooms.
create policy "venue_rooms_host_all"
  on public.venue_rooms
  for all
  using (
    exists (
      select 1 from public.events
      where events.id = venue_rooms.event_id and events.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events
      where events.id = venue_rooms.event_id and events.host_id = auth.uid()
    )
  );

-- Approved attendees can see rooms (so they can see which room they're being escorted to).
create policy "venue_rooms_attendee_select"
  on public.venue_rooms
  for select
  using (
    exists (
      select 1 from public.event_participants
      where event_id = venue_rooms.event_id
        and user_id = auth.uid()
        and status = 'approved'
    )
  );

alter table public.users
  add column if not exists expo_push_token text;

alter table public.office_hours_requests
  add column if not exists room_id uuid references public.venue_rooms(id) on delete set null;
