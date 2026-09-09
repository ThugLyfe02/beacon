-- =============================================================================
-- 067_internal_operator_capability_leases.sql
-- Just-in-time leases for the most portable/sensitive Constellation capabilities.
--
-- Standing graph_manage never implies restricted/export access. Short-lived
-- graph_restricted / graph_export elevation can be issued only by service_role to
-- an already-active standing graph manager. Operators may inspect and revoke only
-- their own leases. Client code cannot self-grant or extend a lease.
-- =============================================================================

create table if not exists public.internal_operator_capability_leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  capability text not null check (capability in ('graph_restricted', 'graph_export')),
  reason text not null check (char_length(trim(reason)) between 12 and 240),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > granted_at),
  check (expires_at <= granted_at + interval '2 hours')
);
create index if not exists internal_operator_capability_leases_active_idx
  on public.internal_operator_capability_leases(user_id, capability, expires_at desc)
  where revoked_at is null;

create table if not exists public.internal_operator_capability_lease_audit (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid,
  operator_id uuid not null,
  capability text not null check (capability in ('graph_restricted', 'graph_export')),
  action text not null check (action in ('granted', 'revoked', 'superseded', 'pruned')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists internal_operator_capability_lease_audit_operator_idx
  on public.internal_operator_capability_lease_audit(operator_id, created_at desc);

alter table public.internal_operator_capability_leases enable row level security;
alter table public.internal_operator_capability_lease_audit enable row level security;
revoke all on table public.internal_operator_capability_leases from anon, authenticated;
revoke all on table public.internal_operator_capability_lease_audit from anon, authenticated;

create or replace function public.grant_internal_operator_capability_lease(
  p_user_id uuid,
  p_capability text,
  p_reason text,
  p_ttl_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.internal_operator_capability_leases;
  v_ttl integer := coalesce(p_ttl_minutes, 30);
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Unknown operator user';
  end if;
  if p_capability not in ('graph_restricted', 'graph_export') then
    raise exception 'Only graph_restricted or graph_export may be leased';
  end if;
  if nullif(trim(p_reason), '') is null or char_length(trim(p_reason)) not between 12 and 240 then
    raise exception 'Lease reason must be between 12 and 240 characters';
  end if;
  if v_ttl < 5 or v_ttl > 120 then
    raise exception 'Capability lease TTL must be between 5 and 120 minutes';
  end if;
  if not exists (
    select 1 from public.internal_operator_access access
    where access.user_id = p_user_id
      and (access.expires_at is null or access.expires_at > now())
      and 'graph_manage' = any(access.capabilities)
  ) then
    raise exception 'Capability leases require an active standing graph_manage grant';
  end if;

  with superseded as (
    update public.internal_operator_capability_leases lease
    set revoked_at = now()
    where lease.user_id = p_user_id
      and lease.capability = p_capability
      and lease.revoked_at is null
      and lease.expires_at > now()
    returning lease.id, lease.user_id, lease.capability
  )
  insert into public.internal_operator_capability_lease_audit(
    lease_id, operator_id, capability, action, metadata
  )
  select id, user_id, capability, 'superseded', jsonb_build_object('reason', 'replaced_by_new_lease')
  from superseded;

  insert into public.internal_operator_capability_leases(
    user_id, capability, reason, granted_at, expires_at
  ) values (
    p_user_id, p_capability, trim(p_reason), now(), now() + make_interval(mins => v_ttl)
  ) returning * into v_lease;

  insert into public.internal_operator_capability_lease_audit(
    lease_id, operator_id, capability, action, metadata
  ) values (
    v_lease.id,
    p_user_id,
    p_capability,
    'granted',
    jsonb_build_object('ttlMinutes', v_ttl, 'reason', trim(p_reason), 'grantedBy', 'service_role')
  );

  return jsonb_build_object(
    'id', v_lease.id,
    'capability', v_lease.capability,
    'reason', v_lease.reason,
    'grantedAt', v_lease.granted_at,
    'expiresAt', v_lease.expires_at
  );
end;
$$;
revoke all on function public.grant_internal_operator_capability_lease(uuid, text, text, integer) from public;
grant execute on function public.grant_internal_operator_capability_lease(uuid, text, text, integer) to service_role;

create or replace function public.revoke_my_internal_operator_capability_lease(p_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease public.internal_operator_capability_leases;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.internal_operator_capability_leases lease
  set revoked_at = now()
  where lease.id = p_lease_id
    and lease.user_id = auth.uid()
    and lease.revoked_at is null
    and lease.expires_at > now()
  returning * into v_lease;

  if v_lease.id is null then raise exception 'Active capability lease not found'; end if;

  insert into public.internal_operator_capability_lease_audit(
    lease_id, operator_id, capability, action, metadata
  ) values (
    v_lease.id,
    v_lease.user_id,
    v_lease.capability,
    'revoked',
    jsonb_build_object('revokedBy', 'operator_self')
  );
  return true;
end;
$$;
revoke all on function public.revoke_my_internal_operator_capability_lease(uuid) from public;
grant execute on function public.revoke_my_internal_operator_capability_lease(uuid) to authenticated;

-- Lease-aware exact capability semantics. graph_manage remains standing-only.
create or replace function public.has_internal_operator_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_capability in ('graph_read', 'graph_manage', 'graph_restricted', 'graph_export')
    and (
      exists (
        select 1
        from public.internal_operator_access access
        where access.user_id = auth.uid()
          and (access.expires_at is null or access.expires_at > now())
          and (
            p_capability = any(access.capabilities)
            or (
              p_capability = 'graph_read'
              and access.capabilities && array[
                'graph_manage', 'graph_restricted', 'graph_export'
              ]::text[]
            )
          )
      )
      or (
        p_capability in ('graph_restricted', 'graph_export')
        and exists (
          select 1
          from public.internal_operator_capability_leases lease
          where lease.user_id = auth.uid()
            and lease.capability = p_capability
            and lease.revoked_at is null
            and lease.expires_at > now()
        )
      )
    );
$$;
revoke all on function public.has_internal_operator_capability(text) from public;
grant execute on function public.has_internal_operator_capability(text) to authenticated;

create or replace function public.get_internal_operator_security_envelope()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_access public.internal_operator_access;
  v_active_leases jsonb := '[]'::jsonb;
  v_standing text[] := array[]::text[];
  v_leased text[] := array[]::text[];
  v_effective text[] := array[]::text[];
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'allowed', false,
      'capabilities', '[]'::jsonb,
      'standingCapabilities', '[]'::jsonb,
      'leasedCapabilities', '[]'::jsonb,
      'activeLeases', '[]'::jsonb,
      'read', false, 'manage', false, 'restricted', false, 'export', false,
      'expiresAt', null
    );
  end if;

  select * into v_access
  from public.internal_operator_access access
  where access.user_id = auth.uid()
    and (access.expires_at is null or access.expires_at > now());

  if v_access.user_id is not null then
    v_standing := coalesce(v_access.capabilities, array[]::text[]);
  end if;

  select coalesce(array_agg(distinct lease.capability order by lease.capability), array[]::text[]),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', lease.id,
           'capability', lease.capability,
           'reason', lease.reason,
           'grantedAt', lease.granted_at,
           'expiresAt', lease.expires_at
         ) order by lease.expires_at), '[]'::jsonb)
  into v_leased, v_active_leases
  from public.internal_operator_capability_leases lease
  where lease.user_id = auth.uid()
    and lease.revoked_at is null
    and lease.expires_at > now();

  select coalesce(array_agg(distinct capability order by capability), array[]::text[])
  into v_effective
  from unnest(v_standing || v_leased || case
    when cardinality(v_standing || v_leased) > 0 then array['graph_read']::text[]
    else array[]::text[] end) capability;

  if cardinality(v_effective) = 0 then
    return jsonb_build_object(
      'allowed', false,
      'capabilities', '[]'::jsonb,
      'standingCapabilities', '[]'::jsonb,
      'leasedCapabilities', '[]'::jsonb,
      'activeLeases', '[]'::jsonb,
      'read', false, 'manage', false, 'restricted', false, 'export', false,
      'expiresAt', null
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'capabilities', to_jsonb(v_effective),
    'standingCapabilities', to_jsonb(v_standing),
    'leasedCapabilities', to_jsonb(v_leased),
    'activeLeases', v_active_leases,
    'read', public.has_internal_operator_capability('graph_read'),
    'manage', public.has_internal_operator_capability('graph_manage'),
    'restricted', public.has_internal_operator_capability('graph_restricted'),
    'export', public.has_internal_operator_capability('graph_export'),
    'grantedAt', case when v_access.user_id is null then null else v_access.granted_at end,
    'expiresAt', case when v_access.user_id is null then null else v_access.expires_at end,
    'leastPrivilegeRule', 'graph_manage is standing-only; graph_restricted and graph_export may be standing or service-issued time-bounded leases and never imply one another'
  );
end;
$$;
revoke all on function public.get_internal_operator_security_envelope() from public;
grant execute on function public.get_internal_operator_security_envelope() to authenticated;

create or replace function public.prune_internal_operator_capability_leases()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leases integer := 0;
  v_audit integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  with removed as (
    delete from public.internal_operator_capability_leases lease
    where lease.expires_at < now() - interval '180 days'
    returning lease.id, lease.user_id, lease.capability
  )
  insert into public.internal_operator_capability_lease_audit(
    lease_id, operator_id, capability, action, metadata
  )
  select id, user_id, capability, 'pruned', jsonb_build_object('retentionDays', 180)
  from removed;
  get diagnostics v_leases = row_count;

  delete from public.internal_operator_capability_lease_audit
  where created_at < now() - interval '365 days';
  get diagnostics v_audit = row_count;

  return jsonb_build_object('prunedLeases', v_leases, 'prunedAuditRows', v_audit, 'prunedAt', now());
end;
$$;
revoke all on function public.prune_internal_operator_capability_leases() from public;
grant execute on function public.prune_internal_operator_capability_leases() to service_role;

comment on table public.internal_operator_capability_leases is
  'Service-issued, self-revocable, maximum-two-hour leases for graph_restricted or graph_export. No client self-grant path exists.';
comment on function public.grant_internal_operator_capability_lease(uuid, text, text, integer) is
  'Service-role-only JIT elevation for an already-active standing graph manager; TTL 5-120 minutes.';
comment on function public.revoke_my_internal_operator_capability_lease(uuid) is
  'Self-scoped early revocation of an active JIT capability lease.';
