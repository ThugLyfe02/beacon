-- Trusted venue command admission
-- Separates an operator's authority to act from the trusted decision record that
-- proves a recommendation actually cleared Beacon's operational policy.

create table if not exists public.venue_admitted_commands (
  event_id uuid not null references public.events(id) on delete cascade,
  command_id text not null,
  command_kind text not null check (command_kind in ('flow','capacity','programming','sponsor','safety','follow-up')),
  venue_key text not null,
  target_zone_ids text[] not null default '{}',
  layout_version text not null,
  geometry_hash text not null,
  policy_version text not null,
  model_version text not null,
  admission_decision text not null check (admission_decision in ('allow','review','block')),
  admission_score numeric not null check (admission_score between 0 and 1),
  telemetry_score numeric not null check (telemetry_score between 0 and 1),
  provenance_key text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, command_id),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '5 minutes')
);

alter table public.venue_admitted_commands enable row level security;

create policy "event operators can read admitted venue commands"
on public.venue_admitted_commands for select
to authenticated
using (
  public.is_event_host(event_id, auth.uid())
  or public.venue_operator_role(event_id, auth.uid()) is not null
);

-- Authenticated application clients can inspect commands within their event
-- scope but cannot manufacture, mutate, extend, or revoke admission records.
-- Trusted backend/service-role code is responsible for recording the result of
-- the full admission pipeline.
revoke insert, update, delete on public.venue_admitted_commands from authenticated;

create or replace function public.validate_venue_admitted_command(
  p_event_id uuid,
  p_command_id text,
  p_command_kind text,
  p_layout_version text,
  p_geometry_hash text,
  p_require_allow boolean default true,
  p_require_current boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.venue_admitted_commands c
    where c.event_id = p_event_id
      and c.command_id = left(p_command_id, 200)
      and c.command_kind = p_command_kind
      and c.layout_version = p_layout_version
      and c.geometry_hash = p_geometry_hash
      and c.revoked_at is null
      and (not p_require_allow or c.admission_decision = 'allow')
      and (not p_require_current or c.expires_at > now())
  );
$$;

-- Replaces the team write path from migration 032 with a stricter version.
-- Client-supplied admission labels and evidence scores are ignored for persisted
-- actions; the immutable audit row derives those fields from the trusted
-- admission record instead.
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
  v_command public.venue_admitted_commands;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_event_type not in ('operator-decision','intervention-applied','intervention-reverted') then
    raise exception 'event type is not writable by an operator client';
  end if;
  if p_command_id is null or length(trim(p_command_id)) < 3 then
    raise exception 'command id is required';
  end if;
  if not public.can_execute_venue_command(p_event_id, auth.uid(), p_command_kind) then
    raise exception 'operator is not authorized for this venue command class';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'idempotency key is required';
  end if;
  if p_event_type in ('intervention-applied','intervention-reverted')
     and (p_intervention_id is null or length(trim(p_intervention_id)) < 3) then
    raise exception 'intervention id is required';
  end if;

  select * into v_command
  from public.venue_admitted_commands c
  where c.event_id = p_event_id
    and c.command_id = left(p_command_id, 200)
  limit 1;

  if v_command.command_id is null then
    raise exception 'trusted venue command admission record required';
  end if;
  if v_command.command_kind <> p_command_kind then
    raise exception 'command kind does not match trusted admission record';
  end if;
  if v_command.layout_version <> p_layout_version
     or v_command.geometry_hash <> p_geometry_hash then
    raise exception 'venue layout changed after command admission';
  end if;
  if v_command.policy_version <> p_policy_version
     or v_command.model_version <> p_model_version then
    raise exception 'policy or model version changed after command admission';
  end if;
  if v_command.revoked_at is not null then
    raise exception 'venue command admission was revoked';
  end if;

  if p_event_type in ('operator-decision','intervention-applied') and v_command.expires_at <= now() then
    raise exception 'venue command admission expired and must be recomputed';
  end if;
  if p_event_type = 'intervention-applied' and v_command.admission_decision <> 'allow' then
    raise exception 'only allow-admitted commands may be applied';
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
    left(v_command.venue_key, 160),
    p_event_type,
    v_command.command_id,
    left(p_intervention_id, 200),
    auth.uid(),
    v_command.target_zone_ids,
    v_command.layout_version,
    v_command.geometry_hash,
    v_command.policy_version,
    v_command.model_version,
    v_command.admission_decision,
    v_command.admission_score,
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

revoke all on function public.validate_venue_admitted_command(uuid,text,text,text,text,boolean,boolean) from public;
grant execute on function public.validate_venue_admitted_command(uuid,text,text,text,text,boolean,boolean) to authenticated;

create index if not exists venue_admitted_commands_expiry_idx
  on public.venue_admitted_commands (event_id, expires_at)
  where revoked_at is null;
create index if not exists venue_admitted_commands_provenance_idx
  on public.venue_admitted_commands (event_id, provenance_key);
