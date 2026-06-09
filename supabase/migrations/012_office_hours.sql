-- =============================================================================
-- 012_office_hours.sql
-- Office Hours: 1-on-1 scheduled requests between approved event attendees.
-- Phase 2 of presence engine. Premium-only (enforced client-side and via
-- requester premium check in the RPC).
-- =============================================================================

create type public.office_hours_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'awaiting_escort',
  'completed'
);

create table if not exists public.office_hours_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  proposed_start timestamptz not null,
  proposed_end timestamptz not null,
  status public.office_hours_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (proposed_end > proposed_start),
  check (requester_id <> recipient_id)
);

create index if not exists office_hours_requests_event_idx
  on public.office_hours_requests (event_id);
create index if not exists office_hours_requests_requester_idx
  on public.office_hours_requests (requester_id);
create index if not exists office_hours_requests_recipient_idx
  on public.office_hours_requests (recipient_id);

alter table public.office_hours_requests enable row level security;

-- Read: requester or recipient.
create policy "oh_requests_select_party"
  on public.office_hours_requests
  for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

-- Insert: only the requester. Requester and recipient must both be approved
-- participants of the event, and requester must be premium.
create policy "oh_requests_insert_requester"
  on public.office_hours_requests
  for insert
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from public.event_participants
      where event_id = office_hours_requests.event_id
        and user_id = office_hours_requests.requester_id
        and status = 'approved'
    )
    and exists (
      select 1 from public.event_participants
      where event_id = office_hours_requests.event_id
        and user_id = office_hours_requests.recipient_id
        and status = 'approved'
    )
    and exists (
      select 1 from public.users
      where id = auth.uid() and is_premium = true
    )
  );

-- Update: recipient can accept/decline, either party can cancel.
create policy "oh_requests_update_party"
  on public.office_hours_requests
  for update
  using (auth.uid() = requester_id or auth.uid() = recipient_id)
  with check (auth.uid() = requester_id or auth.uid() = recipient_id);
