-- =============================================================================
-- 059_internal_graph_entity_resolution.sql
-- Operator-approved canonicalization for NON-PERSON graph entities only.
--
-- The goal is graph quality, not identity resolution. Person nodes are rejected
-- unconditionally. No email/phone/device/location/contact matching is performed.
-- =============================================================================

create table if not exists public.internal_graph_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  alias_node_key text not null unique,
  canonical_node_key text not null,
  entity_kind text not null check (entity_kind in (
    'organization', 'domain', 'project', 'topic', 'venue', 'role'
  )),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '730 days'),
  check (alias_node_key <> canonical_node_key),
  check (char_length(alias_node_key) between 3 and 220),
  check (char_length(canonical_node_key) between 3 and 220)
);

create index if not exists internal_graph_entity_aliases_canonical_idx
  on public.internal_graph_entity_aliases (canonical_node_key, updated_at desc);

alter table public.internal_graph_entity_aliases enable row level security;
revoke all on table public.internal_graph_entity_aliases from anon, authenticated;

create or replace function public.approve_internal_graph_entity_alias(
  p_event_id uuid,
  p_alias_node_key text,
  p_canonical_node_key text,
  p_confidence numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_graph jsonb;
  v_alias_kind text;
  v_canonical_kind text;
  v_row public.internal_graph_entity_aliases;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if nullif(trim(p_alias_node_key), '') is null
     or nullif(trim(p_canonical_node_key), '') is null
     or p_alias_node_key = p_canonical_node_key then
    raise exception 'Invalid entity alias pair';
  end if;
  if p_confidence is null or p_confidence < 0.70 or p_confidence > 1 then
    raise exception 'Entity canonicalization requires confidence between 0.70 and 1.00';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'Entity canonicalization reason exceeds 500 characters';
  end if;

  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);

  select node->>'kind' into v_alias_kind
  from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
  where node->>'id' = p_alias_node_key
  limit 1;

  select node->>'kind' into v_canonical_kind
  from jsonb_array_elements(coalesce(v_graph->'nodes', '[]'::jsonb)) node
  where node->>'id' = p_canonical_node_key
  limit 1;

  if v_alias_kind is null or v_canonical_kind is null then
    raise exception 'Entity canonicalization nodes must exist in the authorized graph';
  end if;
  if v_alias_kind = 'person' or v_canonical_kind = 'person' then
    raise exception 'Person identity resolution is prohibited';
  end if;
  if v_alias_kind <> v_canonical_kind then
    raise exception 'Entity canonicalization requires matching node kinds';
  end if;
  if v_alias_kind not in ('organization', 'domain', 'project', 'topic', 'venue', 'role') then
    raise exception 'Entity kind is not eligible for canonicalization';
  end if;

  -- Keep the mapping one-hop and acyclic. A canonical target cannot itself be an
  -- alias, and the new alias cannot already be a canonical target for another row.
  if exists (
    select 1 from public.internal_graph_entity_aliases
    where alias_node_key = p_canonical_node_key and expires_at > now()
  ) then
    raise exception 'Canonical target is itself an alias; flatten the mapping first';
  end if;
  if exists (
    select 1 from public.internal_graph_entity_aliases
    where canonical_node_key = p_alias_node_key and expires_at > now()
  ) then
    raise exception 'Alias node is already a canonical target; chained canonicalization is prohibited';
  end if;

  insert into public.internal_graph_entity_aliases (
    created_by, alias_node_key, canonical_node_key, entity_kind,
    confidence, reason, expires_at
  ) values (
    auth.uid(), trim(p_alias_node_key), trim(p_canonical_node_key), v_alias_kind,
    p_confidence, nullif(trim(p_reason), ''), now() + interval '730 days'
  )
  on conflict (alias_node_key) do update set
    canonical_node_key = excluded.canonical_node_key,
    entity_kind = excluded.entity_kind,
    confidence = excluded.confidence,
    reason = excluded.reason,
    created_by = auth.uid(),
    updated_at = now(),
    expires_at = greatest(public.internal_graph_entity_aliases.expires_at, excluded.expires_at)
  returning * into v_row;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'entity_alias_approved', p_event_id,
    jsonb_build_object(
      'aliasNodeKey', v_row.alias_node_key,
      'canonicalNodeKey', v_row.canonical_node_key,
      'entityKind', v_row.entity_kind,
      'confidence', v_row.confidence
    )
  );

  return jsonb_build_object(
    'id', v_row.id,
    'aliasNodeId', v_row.alias_node_key,
    'canonicalNodeId', v_row.canonical_node_key,
    'kind', v_row.entity_kind,
    'confidence', v_row.confidence,
    'reason', v_row.reason,
    'updatedAt', v_row.updated_at,
    'expiresAt', v_row.expires_at
  );
end;
$$;
revoke all on function public.approve_internal_graph_entity_alias(uuid, text, text, numeric, text) from public;
grant execute on function public.approve_internal_graph_entity_alias(uuid, text, text, numeric, text) to authenticated;

create or replace function public.get_internal_graph_entity_aliases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph read capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', alias.id,
    'aliasNodeId', alias.alias_node_key,
    'canonicalNodeId', alias.canonical_node_key,
    'kind', alias.entity_kind,
    'confidence', alias.confidence,
    'reason', alias.reason,
    'updatedAt', alias.updated_at,
    'expiresAt', alias.expires_at
  ) order by alias.updated_at desc), '[]'::jsonb)
  into v_rows
  from public.internal_graph_entity_aliases alias
  where alias.expires_at > now();

  return jsonb_build_object('generatedAt', now(), 'aliases', v_rows);
end;
$$;
revoke all on function public.get_internal_graph_entity_aliases() from public;
grant execute on function public.get_internal_graph_entity_aliases() to authenticated;

create or replace function public.revoke_internal_graph_entity_alias(p_alias_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  delete from public.internal_graph_entity_aliases
  where id = p_alias_id;
  if not found then raise exception 'Entity alias not found'; end if;
  return true;
end;
$$;
revoke all on function public.revoke_internal_graph_entity_alias(uuid) from public;
grant execute on function public.revoke_internal_graph_entity_alias(uuid) to authenticated;

create or replace function public.prune_internal_graph_entity_aliases()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_entity_aliases where expires_at <= now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('prunedAliases', v_count, 'prunedAt', now());
end;
$$;
revoke all on function public.prune_internal_graph_entity_aliases() from public;
grant execute on function public.prune_internal_graph_entity_aliases() to service_role;

comment on table public.internal_graph_entity_aliases is
  'Operator-approved canonicalization of non-person business/context entities. Person identity resolution is explicitly prohibited.';
