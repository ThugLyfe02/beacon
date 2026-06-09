-- =============================================================================
-- 010_missed_opportunities.sql
-- Records when a user passed within activation range of another user at an event
-- but did not generate a mutual signal. Powers the Regret/recall surface.
-- =============================================================================

create table if not exists public.missed_opportunities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  target_id uuid not null references public.users(id) on delete cascade,
  closest_bucket smallint not null check (closest_bucket between 0 and 3),
  created_at timestamptz not null default now()
);

create index if not exists missed_opportunities_user_event_idx
  on public.missed_opportunities (user_id, event_id);

create index if not exists missed_opportunities_target_idx
  on public.missed_opportunities (target_id);

alter table public.missed_opportunities enable row level security;

-- Users can read only their own miss records.
create policy "missed_opportunities_select_own"
  on public.missed_opportunities
  for select
  using (auth.uid() = user_id);

-- Users can insert miss records about themselves.
create policy "missed_opportunities_insert_own"
  on public.missed_opportunities
  for insert
  with check (auth.uid() = user_id);
