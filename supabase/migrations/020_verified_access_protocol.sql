-- =============================================================================
-- 020_verified_access_protocol.sql
-- Verified event roles, Invisible VIP controls, Office Hours queue quality,
-- and atomic limited-access drops. All records remain event-scoped.
-- =============================================================================

create type public.event_role_verification_status as enum (
  'pending',
  'verified',
  'rejected',
  'revoked'
);

create type public.vip_visibility_mode as enum (
  'visible',
  'aggregate_only',
  'eligible_only',
  'invisible'
);

create type public.access_drop_status as enum (
  'draft',
  'scheduled',
  'open',
  'filled',
  'closed',
  'cancelled'
);

create type public.access_claim_status as enum (
  'confirmed',
  'waitlisted',
  'cancelled',
  'completed'
);

create table if not exists public.event_role_attestations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_key text not null check (char_length(role_key) between 2 and 48),
  status public.event_role_verification_status not null default 'pending',
  verified_by uuid references public.users(id) on delete set null,
  evidence_label text check (evidence_label is null or char_length(evidence_label) <= 120),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id, role_key)
);

create index if not exists event_role_attestations_event_status_idx
  on public.event_role_attestations (event_id, status, role_key);

alter table public.event_role_attestations enable row level security;

create policy "role_attestations_read_event_verified"
  on public.event_role_attestations
  for select
  using (
    status = 'verified'
    and public.is_user_in_event(event_id, auth.uid())
    and (expires_at is null or expires_at > now())
  );

create policy "role_attestations_read_own"
  on public.event_role_attestations
  for select
  using (auth.uid() = user_id);

create policy "role_attestations_manage_host"
  on public.event_role_attestations
  for all
  using (
    exists (
      select 1 from public.events e
      where e.id = event_role_attestations.event_id
        and e.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_role_attestations.event_id
        and e.host_id = auth.uid()
    )
  );

create table if not exists public.vip_visibility_settings (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  visibility_mode public.vip_visibility_mode not null default 'visible',
  inbound_limit smallint not null default 5 check (inbound_limit between 0 and 100),
  accepted_inbound_count smallint not null default 0 check (accepted_inbound_count >= 0),
  office_hours_visible boolean not null default false,
  allow_mutual_reveal boolean not null default true,
  aggregate_role_hint boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  check (accepted_inbound_count <= inbound_limit)
);

alter table public.vip_visibility_settings enable row level security;

create policy "vip_settings_select_own"
  on public.vip_visibility_settings
  for select
  using (auth.uid() = user_id);

create policy "vip_settings_insert_own"
  on public.vip_visibility_settings
  for insert
  with check (
    auth.uid() = user_id
    and public.is_user_in_event(event_id, auth.uid())
  );

create policy "vip_settings_update_own"
  on public.vip_visibility_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.office_hours_host_controls (
  event_id uuid not null references public.events(id) on delete cascade,
  host_id uuid not null references public.users(id) on delete cascade,
  inbound_cap smallint not null default 5 check (inbound_cap between 0 and 100),
  accepted_roles text[] not null default '{}',
  accepted_intents text[] not null default '{}',
  minimum_fit_score smallint not null default 0 check (minimum_fit_score between 0 and 100),
  auto_close_when_full boolean not null default true,
  requires_verified_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, host_id)
);

alter table public.office_hours_host_controls enable row level security;

create policy "office_hours_controls_select_event"
  on public.office_hours_host_controls
  for select
  using (public.is_user_in_event(event_id, auth.uid()));

create policy "office_hours_controls_manage_own"
  on public.office_hours_host_controls
  for all
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

create table if not exists public.office_hours_request_context (
  request_id uuid primary key references public.office_hours_requests(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  intent_key text not null check (char_length(intent_key) between 2 and 48),
  relevance_reason text not null check (char_length(relevance_reason) between 10 and 500),
  requester_role_snapshot text,
  requester_role_verified boolean not null default false,
  private_fit_score smallint check (private_fit_score between 0 and 100),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

create index if not exists office_hours_request_context_recipient_idx
  on public.office_hours_request_context (event_id, recipient_id, created_at desc);

alter table public.office_hours_request_context enable row level security;

create policy "office_hours_context_select_party"
  on public.office_hours_request_context
  for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

create policy "office_hours_context_insert_requester"
  on public.office_hours_request_context
  for insert
  with check (
    auth.uid() = requester_id
    and public.is_user_in_event(event_id, requester_id)
    and public.is_user_in_event(event_id, recipient_id)
  );

create table if not exists public.access_drop_windows (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text check (description is null or char_length(description) <= 800),
  access_type text not null check (char_length(access_type) between 2 and 48),
  status public.access_drop_status not null default 'draft',
  capacity smallint not null check (capacity between 1 and 500),
  confirmed_count smallint not null default 0 check (confirmed_count >= 0),
  waitlist_enabled boolean not null default true,
  eligible_role_keys text[] not null default '{}',
  requires_verified_role boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (confirmed_count <= capacity)
);

create index if not exists access_drop_windows_event_time_idx
  on public.access_drop_windows (event_id, starts_at, ends_at);

alter table public.access_drop_windows enable row level security;

create policy "drops_read_event"
  on public.access_drop_windows
  for select
  using (public.is_user_in_event(event_id, auth.uid()));

create policy "drops_manage_event_host"
  on public.access_drop_windows
  for all
  using (
    exists (
      select 1 from public.events e
      where e.id = access_drop_windows.event_id
        and e.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = access_drop_windows.event_id
        and e.host_id = auth.uid()
    )
  );

create table if not exists public.access_drop_claims (
  drop_id uuid not null references public.access_drop_windows(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status public.access_claim_status not null,
  queue_position integer,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (drop_id, user_id)
);

alter table public.access_drop_claims enable row level security;

create policy "drop_claims_select_own"
  on public.access_drop_claims
  for select
  using (auth.uid() = user_id);

create policy "drop_claims_select_event_host"
  on public.access_drop_claims
  for select
  using (
    exists (
      select 1
      from public.access_drop_windows d
      join public.events e on e.id = d.event_id
      where d.id = access_drop_claims.drop_id
        and e.host_id = auth.uid()
    )
  );

create or replace function public.claim_access_drop(p_drop_id uuid)
returns public.access_drop_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_drop public.access_drop_windows;
  v_claim public.access_drop_claims;
  v_role text;
  v_verified boolean := false;
  v_queue_position integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_drop
  from public.access_drop_windows
  where id = p_drop_id
  for update;

  if v_drop.id is null then
    raise exception 'Drop not found';
  end if;

  if not public.is_user_in_event(v_drop.event_id, auth.uid()) then
    raise exception 'Event participation required';
  end if;

  if now() < v_drop.starts_at or now() >= v_drop.ends_at
     or v_drop.status not in ('scheduled', 'open') then
    raise exception 'Drop is not currently claimable';
  end if;

  select u.role into v_role from public.users u where u.id = auth.uid();

  select exists (
    select 1 from public.event_role_attestations a
    where a.event_id = v_drop.event_id
      and a.user_id = auth.uid()
      and a.status = 'verified'
      and (a.expires_at is null or a.expires_at > now())
      and (
        cardinality(v_drop.eligible_role_keys) = 0
        or a.role_key = any(v_drop.eligible_role_keys)
      )
  ) into v_verified;

  if cardinality(v_drop.eligible_role_keys) > 0
     and not (coalesce(v_role, '') = any(v_drop.eligible_role_keys) or v_verified) then
    raise exception 'This access window is not available for your role';
  end if;

  if v_drop.requires_verified_role and not v_verified then
    raise exception 'Verified event role required';
  end if;

  if exists (
    select 1 from public.access_drop_claims c
    where c.drop_id = p_drop_id and c.user_id = auth.uid()
  ) then
    select * into v_claim from public.access_drop_claims
    where drop_id = p_drop_id and user_id = auth.uid();
    return v_claim;
  end if;

  if v_drop.confirmed_count < v_drop.capacity then
    update public.access_drop_windows
      set confirmed_count = confirmed_count + 1,
          status = case when confirmed_count + 1 >= capacity then 'filled' else 'open' end,
          updated_at = now()
      where id = p_drop_id;

    insert into public.access_drop_claims (drop_id, user_id, status)
    values (p_drop_id, auth.uid(), 'confirmed')
    returning * into v_claim;
  elsif v_drop.waitlist_enabled then
    select coalesce(max(queue_position), 0) + 1 into v_queue_position
    from public.access_drop_claims
    where drop_id = p_drop_id and status = 'waitlisted';

    insert into public.access_drop_claims (drop_id, user_id, status, queue_position)
    values (p_drop_id, auth.uid(), 'waitlisted', v_queue_position)
    returning * into v_claim;
  else
    raise exception 'Drop capacity reached';
  end if;

  return v_claim;
end;
$$;

grant execute on function public.claim_access_drop(uuid) to authenticated;

drop trigger if exists role_attestations_touch_updated_at on public.event_role_attestations;
create trigger role_attestations_touch_updated_at
before update on public.event_role_attestations
for each row execute function public.touch_updated_at();

drop trigger if exists vip_settings_touch_updated_at on public.vip_visibility_settings;
create trigger vip_settings_touch_updated_at
before update on public.vip_visibility_settings
for each row execute function public.touch_updated_at();

drop trigger if exists office_hours_controls_touch_updated_at on public.office_hours_host_controls;
create trigger office_hours_controls_touch_updated_at
before update on public.office_hours_host_controls
for each row execute function public.touch_updated_at();

drop trigger if exists access_drops_touch_updated_at on public.access_drop_windows;
create trigger access_drops_touch_updated_at
before update on public.access_drop_windows
for each row execute function public.touch_updated_at();

drop trigger if exists access_claims_touch_updated_at on public.access_drop_claims;
create trigger access_claims_touch_updated_at
before update on public.access_drop_claims
for each row execute function public.touch_updated_at();
