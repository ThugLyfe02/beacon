-- Venue operator roles and high-impact approval policy
-- Extends the host-only venue audit path to explicit event-scoped operator teams.

create table if not exists public.venue_event_operators (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('viewer','organizer','venue-ops','security','admin')),
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.venue_command_approvals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  command_id text not null,
  command_kind text not null check (command_kind in ('flow','capacity','programming','sponsor','safety','follow-up')),
  operator_id uuid not null,
  operator_role text not null check (operator_role in ('organizer','venue-ops','security','admin')),
  approved_at timestamptz not null default now(),
  unique (event_id, command_id, operator_id)
);

alter table public.venue_event_operators enable row level security;
alter table public.venue_command_approvals enable row level security;

create or replace function public.venue_operator_role(p_event_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.events e
      where e.id = p_event_id and e.host_id = p_user_id
    ) then 'admin'::text
    else (
      select veo.role
      from public.venue_event_operators veo
      where veo.event_id = p_event_id
        and veo.user_id = p_user_id
        and veo.active = true
      limit 1
    )
  end;
$$;

create or replace function public.can_execute_venue_command(
  p_event_id uuid,
  p_user_id uuid,
  p_command_kind text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_command_kind not in ('flow','capacity','programming','sponsor','safety','follow-up') then
    return false;
  end if;

  v_role := public.venue_operator_role(p_event_id, p_user_id);
  if v_role is null then
    return false;
  end if;
  if v_role = 'admin' then
    return true;
  end if;

  return case p_command_kind
    when 'flow' then v_role = 'venue-ops'
    when 'capacity' then v_role = 'venue-ops'
    when 'programming' then v_role = 'organizer'
    when 'sponsor' then v_role = 'organizer'
    when 'follow-up' then v_role = 'organizer'
    when 'safety' then v_role = 'security'
    else false
  end;
end;
$$;

-- Hosts can manage the roster. Active operators can read only their own role.
create policy "event hosts manage venue operators"
on public.venue_event_operators for all
to authenticated
using (public.is_event_host(event_id, auth.uid()))
with check (public.is_event_host(event_id, auth.uid()));

create policy "venue operators read own role"
on public.venue_event_operators for select
to authenticated
using (user_id = auth.uid());

create policy "event hosts and assigned operators read command approvals"
on public.venue_command_approvals for select
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  or public.venue_operator_role(event_id, auth.uid()) is not null
);

revoke insert, update, delete on public.venue_command_approvals from authenticated;

create or replace function public.set_venue_event_operator(
  p_event_id uuid,
  p_user_id uuid,
  p_role text,
  p_active boolean default true
)
returns public.venue_event_operators
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.venue_event_operators;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'host already has venue admin authority';
  end if;
  if p_role not in ('viewer','organizer','venue-ops','security','admin') then
    raise exception 'invalid venue operator role';
  end if;

  insert into public.venue_event_operators (
    event_id, user_id, role, active, created_by, created_at, updated_at
  ) values (
    p_event_id, p_user_id, p_role, coalesce(p_active, true), auth.uid(), now(), now()
  )
  on conflict (event_id, user_id) do update set
    role = excluded.role,
    active = excluded.active,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.approve_venue_command(
  p_event_id uuid,
  p_command_id text,
  p_command_kind text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_command_id is null or length(trim(p_command_id)) < 3 then
    raise exception 'command id is required';
  end if;
  if not public.can_execute_venue_command(p_event_id, auth.uid(), p_command_kind) then
    raise exception 'operator is not authorized for this venue command class';
  end if;

  v_role := public.venue_operator_role(p_event_id, auth.uid());
  insert into public.venue_command_approvals (
    event_id, command_id, command_kind, operator_id, operator_role, approved_at
  ) values (
    p_event_id, left(p_command_id, 200), p_command_kind, auth.uid(), v_role, now()
  )
  on conflict (event_id, command_id, operator_id) do update set
    command_kind = excluded.command_kind,
    operator_role = excluded.operator_role,
    approved_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Server-enforced team write path. This is intentionally a new RPC rather than
-- weakening the earlier host-only function. High-impact safety application
-- requires two distinct recent qualified approvals.
create or replace function public.append_venue_operator_action(
  p_event_id uuid,
  p_venue_key text,
  p_event_type text,
  p_command_id text,
  p_command_kind text,
  p_intervention_id text,
  p_target_zone_ids text[],
  p_layout_version text,
  p_geometry_hash text,
  p_policy_version text,
  p_model_version text,
  p_admission_decision text,
  p_evidence_score numeric,
  p_reason_code text,
  p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_event_type not in ('operator-decision','intervention-applied','intervention-reverted') then
    raise exception 'event type is not writable by an operator client';
  end if;
  if not public.can_execute_venue_command(p_event_id, auth.uid(), p_command_kind) then
    raise exception 'operator is not authorized for this venue command class';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'idempotency key is required';
  end if;
  if p_evidence_score is not null and (p_evidence_score < 0 or p_evidence_score > 1) then
    raise exception 'evidence score outside [0,1]';
  end if;

  if p_event_type = 'intervention-applied' and p_command_kind = 'safety' then
    select count(distinct a.operator_id)
      into v_approval_count
    from public.venue_command_approvals a
    where a.event_id = p_event_id
      and a.command_id = left(p_command_id, 200)
      and a.command_kind = 'safety'
      and a.approved_at >= now() - interval '5 minutes'
      and a.operator_role in ('security','admin');

    if coalesce(v_approval_count, 0) < 2 then
      raise exception 'safety intervention requires two distinct recent qualified approvals';
    end if;
  end if;

  insert into public.venue_operation_audit_events (
    event_id,
    venue_key,
    event_type,
    command_id,
    intervention_id,
    operator_id,
    target_zone_ids,
    layout_version,
    geometry_hash,
    policy_version,
    model_version,
    admission_decision,
    evidence_score,
    reason_code,
    note,
    idempotency_key
  ) values (
    p_event_id,
    left(p_venue_key, 160),
    p_event_type,
    left(p_command_id, 200),
    left(p_intervention_id, 200),
    auth.uid(),
    coalesce(p_target_zone_ids, '{}'),
    left(p_layout_version, 120),
    left(p_geometry_hash, 200),
    left(p_policy_version, 120),
    left(p_model_version, 120),
    p_admission_decision,
    p_evidence_score,
    left(p_reason_code, 120),
    left(p_note, 1000),
    left(p_idempotency_key, 200)
  )
  on conflict (event_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.venue_operation_audit_events
    where event_id = p_event_id
      and idempotency_key = left(p_idempotency_key, 200);
  end if;

  return v_id;
end;
$$;

revoke all on function public.venue_operator_role(uuid,uuid) from public;
revoke all on function public.can_execute_venue_command(uuid,uuid,text) from public;
revoke all on function public.set_venue_event_operator(uuid,uuid,text,boolean) from public;
revoke all on function public.approve_venue_command(uuid,text,text) from public;
revoke all on function public.append_venue_operator_action(uuid,text,text,text,text,text,text[],text,text,text,text,text,numeric,text,text,text) from public;

grant execute on function public.venue_operator_role(uuid,uuid) to authenticated;
grant execute on function public.can_execute_venue_command(uuid,uuid,text) to authenticated;
grant execute on function public.set_venue_event_operator(uuid,uuid,text,boolean) to authenticated;
grant execute on function public.approve_venue_command(uuid,text,text) to authenticated;
grant execute on function public.append_venue_operator_action(uuid,text,text,text,text,text,text[],text,text,text,text,text,numeric,text,text,text) to authenticated;

create index if not exists venue_event_operators_user_idx
  on public.venue_event_operators (user_id, event_id)
  where active = true;
create index if not exists venue_command_approvals_recent_idx
  on public.venue_command_approvals (event_id, command_id, approved_at desc);
