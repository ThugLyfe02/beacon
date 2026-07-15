-- =============================================================================
-- 019_vault_signal_scarcity.sql
-- Event-scoped opportunity memory and atomic high-intent signal budgets.
-- =============================================================================

create type public.vault_entry_kind as enum (
  'mutual',
  'missed_category',
  'office_hours',
  'next_action',
  'note'
);

create type public.vault_entry_status as enum (
  'open',
  'completed',
  'dismissed',
  'expired'
);

create table if not exists public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.vault_entry_kind not null,
  status public.vault_entry_status not null default 'open',
  source_id uuid,
  subject_user_id uuid references public.users(id) on delete set null,
  identity_revealed boolean not null default false,
  title text not null check (char_length(title) between 1 and 140),
  detail text check (detail is null or char_length(detail) <= 1200),
  next_action text check (next_action is null or char_length(next_action) <= 240),
  metadata jsonb not null default '{}'::jsonb,
  visible_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_id, kind, source_id),
  check (identity_revealed or subject_user_id is null)
);

create index if not exists vault_entries_user_event_idx
  on public.vault_entries (user_id, event_id, created_at desc);
create index if not exists vault_entries_open_action_idx
  on public.vault_entries (user_id, event_id, status)
  where status = 'open';

alter table public.vault_entries enable row level security;

create policy "vault_entries_select_own"
  on public.vault_entries
  for select
  using (auth.uid() = user_id);

create policy "vault_entries_insert_own"
  on public.vault_entries
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.event_participants ep
      where ep.event_id = vault_entries.event_id
        and ep.user_id = auth.uid()
        and ep.status = 'approved'
    )
  );

create policy "vault_entries_update_own"
  on public.vault_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vault_entries_delete_own"
  on public.vault_entries
  for delete
  using (auth.uid() = user_id);

create table if not exists public.event_signal_budgets (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  budget_limit smallint not null default 3 check (budget_limit between 0 and 25),
  used_count smallint not null default 0 check (used_count >= 0),
  resets_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  check (used_count <= budget_limit)
);

alter table public.event_signal_budgets enable row level security;

create policy "signal_budgets_select_own"
  on public.event_signal_budgets
  for select
  using (auth.uid() = user_id);

-- Budget creation and consumption are intentionally RPC-only so the client
-- cannot grant itself additional high-intent signals.

create or replace function public.get_or_create_signal_budget(
  p_event_id uuid,
  p_default_limit smallint default 3
)
returns public.event_signal_budgets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.event_signal_budgets;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'Approved event participation required';
  end if;

  insert into public.event_signal_budgets (event_id, user_id, budget_limit)
  values (p_event_id, auth.uid(), greatest(0, least(p_default_limit, 25)))
  on conflict (event_id, user_id) do nothing;

  select * into v_budget
  from public.event_signal_budgets
  where event_id = p_event_id and user_id = auth.uid();

  return v_budget;
end;
$$;

create or replace function public.consume_signal_budget(
  p_event_id uuid,
  p_recipient_id uuid
)
returns public.event_signal_budgets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.event_signal_budgets;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if auth.uid() = p_recipient_id then
    raise exception 'Cannot signal yourself';
  end if;

  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) or not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = p_recipient_id
      and ep.status = 'approved'
  ) then
    raise exception 'Both users must be approved event participants';
  end if;

  perform public.get_or_create_signal_budget(p_event_id, 3);

  update public.event_signal_budgets
  set used_count = used_count + 1,
      updated_at = now()
  where event_id = p_event_id
    and user_id = auth.uid()
    and used_count < budget_limit
  returning * into v_budget;

  if v_budget is null then
    raise exception 'Signal budget exhausted';
  end if;

  return v_budget;
end;
$$;

grant execute on function public.get_or_create_signal_budget(uuid, smallint) to authenticated;
grant execute on function public.consume_signal_budget(uuid, uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vault_entries_touch_updated_at on public.vault_entries;
create trigger vault_entries_touch_updated_at
before update on public.vault_entries
for each row execute function public.touch_updated_at();

drop trigger if exists signal_budgets_touch_updated_at on public.event_signal_budgets;
create trigger signal_budgets_touch_updated_at
before update on public.event_signal_budgets
for each row execute function public.touch_updated_at();
