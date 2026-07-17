-- =============================================================================
-- 022_security_control_plane.sql
-- Security control plane for high-impact Beacon actions.
--
-- Goals:
--   * Fail closed when an event enters a degraded or locked state.
--   * Provide database-enforced kill switches for signals, Office Hours,
--     Access Drops, proximity reveal, and organizer exports.
--   * Record privacy-safe security events without exposing private content.
--   * Add replay protection for sensitive client mutations.
--   * Disable the development-only self-premium escalation path.
-- =============================================================================

create type public.event_security_mode as enum (
  'normal',
  'restricted',
  'locked'
);

create type public.security_action_kind as enum (
  'signal',
  'office_hours',
  'access_drop',
  'proximity_reveal',
  'organizer_export',
  'role_attestation',
  'vip_policy_change'
);

create type public.security_event_outcome as enum (
  'allowed',
  'denied',
  'throttled',
  'replayed',
  'invalid'
);

create table if not exists public.event_security_controls (
  event_id uuid primary key references public.events(id) on delete cascade,
  mode public.event_security_mode not null default 'normal',
  signals_enabled boolean not null default true,
  office_hours_enabled boolean not null default true,
  access_drops_enabled boolean not null default true,
  proximity_reveal_enabled boolean not null default true,
  organizer_exports_enabled boolean not null default true,
  reason text check (reason is null or char_length(reason) <= 500),
  locked_at timestamptz,
  locked_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.event_security_controls enable row level security;

create policy "security_controls_event_members_read"
  on public.event_security_controls
  for select
  using (
    exists (
      select 1
      from public.event_participants ep
      where ep.event_id = event_security_controls.event_id
        and ep.user_id = auth.uid()
        and ep.status = 'approved'
    )
  );

create policy "security_controls_host_insert"
  on public.event_security_controls
  for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_security_controls.event_id
        and e.host_id = auth.uid()
    )
  );

create policy "security_controls_host_update"
  on public.event_security_controls
  for update
  using (
    exists (
      select 1 from public.events e
      where e.id = event_security_controls.event_id
        and e.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_security_controls.event_id
        and e.host_id = auth.uid()
    )
  );

create table if not exists public.security_action_nonces (
  actor_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  action public.security_action_kind not null,
  nonce text not null check (char_length(nonce) between 16 and 160),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  primary key (actor_id, event_id, action, nonce),
  check (expires_at > consumed_at - interval '10 minutes')
);

create index if not exists security_action_nonces_expiry_idx
  on public.security_action_nonces (expires_at);

alter table public.security_action_nonces enable row level security;
-- Intentionally no direct client policies. Nonces are consumed only by RPC.

create table if not exists public.security_event_log (
  id bigint generated always as identity primary key,
  event_id uuid references public.events(id) on delete set null,
  actor_id uuid references public.users(id) on delete set null,
  target_id uuid references public.users(id) on delete set null,
  action public.security_action_kind not null,
  outcome public.security_event_outcome not null,
  reason_code text not null check (char_length(reason_code) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists security_event_log_event_time_idx
  on public.security_event_log (event_id, occurred_at desc);
create index if not exists security_event_log_actor_time_idx
  on public.security_event_log (actor_id, occurred_at desc);

alter table public.security_event_log enable row level security;
-- No client read/write policy. Security events are written through controlled RPCs
-- and reviewed through service-role or future moderator tooling only.

create or replace function public.ensure_event_security_controls(p_event_id uuid)
returns public.event_security_controls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_controls public.event_security_controls;
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

  insert into public.event_security_controls (event_id)
  values (p_event_id)
  on conflict (event_id) do nothing;

  select * into v_controls
  from public.event_security_controls
  where event_id = p_event_id;

  return v_controls;
end;
$$;

grant execute on function public.ensure_event_security_controls(uuid) to authenticated;

create or replace function public.authorize_sensitive_action(
  p_event_id uuid,
  p_action public.security_action_kind,
  p_nonce text,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  allowed boolean,
  reason_code text,
  security_mode public.event_security_mode,
  evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_controls public.event_security_controls;
  v_enabled boolean := false;
  v_reason text := 'allowed';
  v_outcome public.security_event_outcome := 'allowed';
  v_recent_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_nonce is null or char_length(p_nonce) < 16 then
    raise exception 'A strong idempotency nonce is required';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Security metadata must be a JSON object';
  end if;

  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    insert into public.security_event_log (
      event_id, actor_id, target_id, action, outcome, reason_code
    ) values (
      p_event_id, auth.uid(), p_target_id, p_action, 'denied', 'not_event_member'
    );

    return query select false, 'not_event_member', 'locked'::public.event_security_mode, now();
    return;
  end if;

  if p_target_id is not null and exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = auth.uid() and ub.blocked_id = p_target_id)
       or (ub.blocker_id = p_target_id and ub.blocked_id = auth.uid())
  ) then
    insert into public.security_event_log (
      event_id, actor_id, target_id, action, outcome, reason_code
    ) values (
      p_event_id, auth.uid(), p_target_id, p_action, 'denied', 'blocked_relationship'
    );

    return query select false, 'blocked_relationship', 'restricted'::public.event_security_mode, now();
    return;
  end if;

  begin
    insert into public.security_action_nonces (
      actor_id, event_id, action, nonce, expires_at
    ) values (
      auth.uid(), p_event_id, p_action, p_nonce, now() + interval '15 minutes'
    );
  exception when unique_violation then
    insert into public.security_event_log (
      event_id, actor_id, target_id, action, outcome, reason_code
    ) values (
      p_event_id, auth.uid(), p_target_id, p_action, 'replayed', 'nonce_reuse'
    );

    return query select false, 'nonce_reuse', 'restricted'::public.event_security_mode, now();
    return;
  end;

  select * into v_controls
  from public.ensure_event_security_controls(p_event_id);

  if v_controls.mode = 'locked' then
    v_enabled := false;
    v_reason := 'event_locked';
  elsif p_action = 'signal' then
    v_enabled := v_controls.signals_enabled;
    v_reason := case when v_enabled then 'allowed' else 'signals_disabled' end;
  elsif p_action = 'office_hours' then
    v_enabled := v_controls.office_hours_enabled;
    v_reason := case when v_enabled then 'allowed' else 'office_hours_disabled' end;
  elsif p_action = 'access_drop' then
    v_enabled := v_controls.access_drops_enabled;
    v_reason := case when v_enabled then 'allowed' else 'access_drops_disabled' end;
  elsif p_action = 'proximity_reveal' then
    v_enabled := v_controls.proximity_reveal_enabled;
    v_reason := case when v_enabled then 'allowed' else 'proximity_reveal_disabled' end;
  elsif p_action = 'organizer_export' then
    v_enabled := v_controls.organizer_exports_enabled;
    v_reason := case when v_enabled then 'allowed' else 'organizer_exports_disabled' end;
  else
    v_enabled := v_controls.mode = 'normal';
    v_reason := case when v_enabled then 'allowed' else 'restricted_mode' end;
  end if;

  select count(*) into v_recent_count
  from public.security_event_log sel
  where sel.actor_id = auth.uid()
    and sel.event_id = p_event_id
    and sel.action = p_action
    and sel.outcome = 'allowed'
    and sel.occurred_at > now() - interval '1 minute';

  if v_enabled and v_recent_count >= 20 then
    v_enabled := false;
    v_reason := 'burst_limit';
    v_outcome := 'throttled';
  elsif not v_enabled then
    v_outcome := 'denied';
  end if;

  insert into public.security_event_log (
    event_id,
    actor_id,
    target_id,
    action,
    outcome,
    reason_code,
    metadata
  ) values (
    p_event_id,
    auth.uid(),
    p_target_id,
    p_action,
    v_outcome,
    v_reason,
    jsonb_strip_nulls(
      jsonb_build_object(
        'client_context', coalesce(p_metadata, '{}'::jsonb),
        'security_mode', v_controls.mode
      )
    )
  );

  return query select v_enabled, v_reason, v_controls.mode, now();
end;
$$;

grant execute on function public.authorize_sensitive_action(
  uuid,
  public.security_action_kind,
  text,
  uuid,
  jsonb
) to authenticated;

create or replace function public.prune_security_control_plane()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.security_action_nonces
  where expires_at < now();
  get diagnostics v_deleted = row_count;

  delete from public.security_event_log
  where occurred_at < now() - interval '90 days';

  return v_deleted;
end;
$$;

-- Disable development-only self-service privilege escalation.
revoke execute on function public.set_premium_dev(boolean) from authenticated;
create or replace function public.set_premium_dev(p_is_premium boolean)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Development premium toggling is disabled. Premium state must be assigned by a trusted server workflow.';
end;
$$;
revoke execute on function public.set_premium_dev(boolean) from public;

create or replace function public.touch_event_security_controls_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.mode = 'locked' and old.mode is distinct from 'locked' then
    new.locked_at = now();
    new.locked_by = auth.uid();
  elsif new.mode <> 'locked' then
    new.locked_at = null;
    new.locked_by = null;
  end if;
  return new;
end;
$$;

drop trigger if exists event_security_controls_touch_updated_at
  on public.event_security_controls;
create trigger event_security_controls_touch_updated_at
before update on public.event_security_controls
for each row execute function public.touch_event_security_controls_updated_at();
