-- =============================================================================
-- 042_escort_notification_idempotency.sql
-- Idempotency ledger for privileged escort push side effects.
--
-- One notification delivery may be claimed per (request, assigned room). A room
-- reassignment may notify once for the new room, while repeated calls for the same
-- authoritative assignment cannot spam attendees.
-- =============================================================================

create table if not exists public.escort_notification_deliveries (
  request_id uuid not null references public.office_hours_requests(id) on delete cascade,
  room_id uuid not null references public.venue_rooms(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  delivered_at timestamptz,
  expo_status integer,
  primary key (request_id, room_id)
);

alter table public.escort_notification_deliveries enable row level security;
-- No client policies. The escort-notify Edge Function uses service-role access
-- only after independently verifying that the authenticated caller hosts the
-- request's event and that the database assignment matches the notification.

comment on table public.escort_notification_deliveries is
  'Service-only idempotency ledger preventing duplicate escort push notifications for the same authoritative room assignment.';
