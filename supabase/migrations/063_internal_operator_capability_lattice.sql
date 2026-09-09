-- =============================================================================
-- 063_internal_operator_capability_lattice.sql
-- Exact least-privilege capability semantics for Constellation operators.
--
-- `graph_read` is the only implied baseline: a holder of a specialized graph
-- capability must be able to read ordinary graph state for that capability to be
-- useful. `graph_manage`, `graph_restricted`, and `graph_export` NEVER imply one
-- another. This keeps server truth aligned with the client capability lattice.
-- =============================================================================

create or replace function public.has_internal_operator_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and p_capability in ('graph_read', 'graph_manage', 'graph_restricted', 'graph_export')
    and exists (
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
    );
$$;
revoke all on function public.has_internal_operator_capability(text) from public;
grant execute on function public.has_internal_operator_capability(text) to authenticated;

comment on function public.has_internal_operator_capability(text) is
  'Self-scoped exact capability check. graph_read may be implied by a specialized grant; manage/restricted/export remain mutually independent.';

-- Reassert the provisioning allowlist so a later migration cannot accidentally
-- introduce an undeclared privilege simply by inserting arbitrary capability text.
create or replace function public.provision_internal_operator(
  p_user_id uuid,
  p_capabilities text[],
  p_note text default null,
  p_expires_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'graph_read', 'graph_restricted', 'graph_manage', 'graph_export'
  ]::text[];
  v_distinct_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Unknown operator user';
  end if;
  if p_capabilities is null or cardinality(p_capabilities) = 0 then
    raise exception 'At least one internal graph capability is required';
  end if;
  if exists (
    select 1 from unnest(p_capabilities) capability
    where capability is null or not capability = any(v_allowed)
  ) then
    raise exception 'Invalid internal graph capability set';
  end if;
  select count(distinct capability)::integer into v_distinct_count
  from unnest(p_capabilities) capability;
  if v_distinct_count <> cardinality(p_capabilities) then
    raise exception 'Duplicate internal graph capabilities are not allowed';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Operator access expiry must be in the future';
  end if;
  if p_note is not null and char_length(trim(p_note)) > 240 then
    raise exception 'Operator access note exceeds 240 characters';
  end if;

  insert into public.internal_operator_access (user_id, capabilities, note, expires_at)
  values (p_user_id, p_capabilities, nullif(trim(p_note), ''), p_expires_at)
  on conflict (user_id) do update
    set capabilities = excluded.capabilities,
        note = excluded.note,
        expires_at = excluded.expires_at,
        granted_at = now();

  return true;
end;
$$;
revoke all on function public.provision_internal_operator(uuid, text[], text, timestamptz) from public;
grant execute on function public.provision_internal_operator(uuid, text[], text, timestamptz) to service_role;

-- Read-only security envelope for the current operator. This deliberately exposes
-- only the caller's own grant and exact capability semantics; it is not an operator
-- directory and cannot enumerate privileged accounts.
create or replace function public.get_internal_operator_security_envelope()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_access public.internal_operator_access;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'allowed', false,
      'capabilities', '[]'::jsonb,
      'read', false,
      'manage', false,
      'restricted', false,
      'export', false,
      'expiresAt', null
    );
  end if;

  select * into v_access
  from public.internal_operator_access access
  where access.user_id = auth.uid()
    and (access.expires_at is null or access.expires_at > now());

  if v_access.user_id is null then
    return jsonb_build_object(
      'allowed', false,
      'capabilities', '[]'::jsonb,
      'read', false,
      'manage', false,
      'restricted', false,
      'export', false,
      'expiresAt', null
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'capabilities', to_jsonb(v_access.capabilities),
    'read', public.has_internal_operator_capability('graph_read'),
    'manage', public.has_internal_operator_capability('graph_manage'),
    'restricted', public.has_internal_operator_capability('graph_restricted'),
    'export', public.has_internal_operator_capability('graph_export'),
    'grantedAt', v_access.granted_at,
    'expiresAt', v_access.expires_at,
    'leastPrivilegeRule', 'graph_read may be implied by a specialized grant; manage, restricted, and export never imply one another'
  );
end;
$$;
revoke all on function public.get_internal_operator_security_envelope() from public;
grant execute on function public.get_internal_operator_security_envelope() to authenticated;
