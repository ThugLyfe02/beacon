-- =============================================================================
-- 045_internal_intelligence_graph_core.sql
-- Beacon Internal Intelligence Graph (operator-only).
--
-- Graphify-inspired principles, reimplemented for Beacon's event domain:
--   * deterministic node/edge identity
--   * every edge carries provenance + confidence
--   * historical edge memory without a parallel source-of-truth database
--   * identity erasure destroys person-linked graph state
--   * zero default operators; access is provisioned only through service role
--
-- This is NOT a general people-scraping surface. Operator assertions are limited
-- to business/event context entity kinds and must carry explicit provenance.
-- =============================================================================

create type public.internal_graph_confidence as enum (
  'VERIFIED',
  'DERIVED',
  'AMBIGUOUS'
);

create type public.internal_graph_sensitivity as enum (
  'standard',
  'restricted'
);

create table if not exists public.internal_operator_access (
  user_id uuid primary key references public.users(id) on delete cascade,
  capabilities text[] not null default array['graph_read']::text[],
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 240),
  check (cardinality(capabilities) > 0)
);

alter table public.internal_operator_access enable row level security;
revoke all on table public.internal_operator_access from anon, authenticated;

create table if not exists public.internal_graph_subject_aliases (
  user_id uuid primary key references public.users(id) on delete cascade,
  alias uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.internal_graph_subject_aliases enable row level security;
revoke all on table public.internal_graph_subject_aliases from anon, authenticated;

create table if not exists public.internal_graph_node_memory (
  node_key text primary key,
  kind text not null check (char_length(kind) between 1 and 40),
  sensitivity public.internal_graph_sensitivity not null default 'standard',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '730 days'),
  check (char_length(node_key) between 3 and 220)
);

alter table public.internal_graph_node_memory enable row level security;
revoke all on table public.internal_graph_node_memory from anon, authenticated;

create table if not exists public.internal_graph_edge_memory (
  scope_key text not null,
  source_key text not null,
  target_key text not null,
  relation text not null,
  directed boolean not null default false,
  confidence public.internal_graph_confidence not null default 'VERIFIED',
  sensitivity public.internal_graph_sensitivity not null default 'standard',
  strength numeric(7,4) not null default 1 check (strength > 0 and strength <= 100),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  evidence_count integer not null default 1 check (evidence_count >= 1),
  latest_evidence jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  primary key (scope_key, source_key, target_key, relation, sensitivity),
  check (source_key <> target_key),
  check (char_length(scope_key) between 1 and 120),
  check (char_length(relation) between 1 and 80)
);

create index if not exists internal_graph_edge_last_seen_idx
  on public.internal_graph_edge_memory (last_seen_at desc);
create index if not exists internal_graph_edge_source_idx
  on public.internal_graph_edge_memory (source_key, last_seen_at desc);
create index if not exists internal_graph_edge_target_idx
  on public.internal_graph_edge_memory (target_key, last_seen_at desc);

alter table public.internal_graph_edge_memory enable row level security;
revoke all on table public.internal_graph_edge_memory from anon, authenticated;

create table if not exists public.internal_graph_assertions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.users(id) on delete set null,
  subject_alias uuid not null references public.internal_graph_subject_aliases(alias) on delete cascade,
  entity_kind text not null check (entity_kind in (
    'organization', 'domain', 'project', 'topic', 'venue', 'event', 'role'
  )),
  entity_label text not null check (char_length(entity_label) between 1 and 160),
  relation text not null check (char_length(relation) between 1 and 80),
  confidence public.internal_graph_confidence not null default 'VERIFIED',
  source_uri text check (source_uri is null or char_length(source_uri) <= 500),
  note text check (note is null or char_length(note) <= 500),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now()
);

create index if not exists internal_graph_assertions_subject_idx
  on public.internal_graph_assertions (subject_alias, observed_at desc);

alter table public.internal_graph_assertions enable row level security;
revoke all on table public.internal_graph_assertions from anon, authenticated;

create table if not exists public.internal_graph_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  event_id uuid references public.events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists internal_graph_audit_actor_idx
  on public.internal_graph_audit_log (actor_id, created_at desc);

alter table public.internal_graph_audit_log enable row level security;
revoke all on table public.internal_graph_audit_log from anon, authenticated;

-- Self-scoped capability check. It never accepts another user id, so it cannot
-- be used to enumerate who has internal access.
create or replace function public.has_internal_operator_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.internal_operator_access access
    where access.user_id = auth.uid()
      and (access.expires_at is null or access.expires_at > now())
      and (
        p_capability = any(access.capabilities)
        or 'graph_manage' = any(access.capabilities)
      )
  );
$$;
revoke all on function public.has_internal_operator_capability(text) from public;
grant execute on function public.has_internal_operator_capability(text) to authenticated;

create or replace function public.get_internal_operator_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capabilities text[];
  v_expires_at timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('allowed', false, 'capabilities', '[]'::jsonb);
  end if;

  select access.capabilities, access.expires_at
  into v_capabilities, v_expires_at
  from public.internal_operator_access access
  where access.user_id = auth.uid()
    and (access.expires_at is null or access.expires_at > now());

  if v_capabilities is null then
    return jsonb_build_object('allowed', false, 'capabilities', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'capabilities', to_jsonb(v_capabilities),
    'expiresAt', v_expires_at
  );
end;
$$;
revoke all on function public.get_internal_operator_context() from public;
grant execute on function public.get_internal_operator_context() to authenticated;

-- Zero operators are provisioned by migration. Bootstrap the intended operators
-- only from a trusted service-role environment after deployment.
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Unknown operator user';
  end if;
  if p_capabilities is null or cardinality(p_capabilities) = 0
     or exists (
       select 1 from unnest(p_capabilities) capability
       where not capability = any(v_allowed)
     ) then
    raise exception 'Invalid internal graph capability set';
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

create or replace function public.ensure_internal_graph_alias(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias uuid;
begin
  if p_user_id is null then return null; end if;

  insert into public.internal_graph_subject_aliases (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select alias into v_alias
  from public.internal_graph_subject_aliases
  where user_id = p_user_id;

  return v_alias;
end;
$$;
revoke all on function public.ensure_internal_graph_alias(uuid) from public;

create or replace function public.upsert_internal_graph_node(
  p_node_key text,
  p_kind text,
  p_sensitivity public.internal_graph_sensitivity,
  p_seen_at timestamptz,
  p_attributes jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.internal_graph_node_memory (
    node_key, kind, sensitivity, first_seen_at, last_seen_at, attributes, expires_at
  ) values (
    p_node_key,
    p_kind,
    p_sensitivity,
    coalesce(p_seen_at, now()),
    coalesce(p_seen_at, now()),
    coalesce(p_attributes, '{}'::jsonb),
    coalesce(p_expires_at, now() + interval '730 days')
  )
  on conflict (node_key) do update
    set last_seen_at = greatest(internal_graph_node_memory.last_seen_at, excluded.last_seen_at),
        attributes = internal_graph_node_memory.attributes || excluded.attributes,
        sensitivity = case
          when internal_graph_node_memory.sensitivity = 'restricted' then 'restricted'::public.internal_graph_sensitivity
          else excluded.sensitivity
        end,
        expires_at = greatest(internal_graph_node_memory.expires_at, excluded.expires_at);
end;
$$;
revoke all on function public.upsert_internal_graph_node(
  text, text, public.internal_graph_sensitivity, timestamptz, jsonb, timestamptz
) from public;

create or replace function public.upsert_internal_graph_edge(
  p_scope_key text,
  p_source_key text,
  p_target_key text,
  p_relation text,
  p_directed boolean,
  p_confidence public.internal_graph_confidence,
  p_sensitivity public.internal_graph_sensitivity,
  p_strength numeric,
  p_first_seen_at timestamptz,
  p_last_seen_at timestamptz,
  p_evidence_count integer,
  p_latest_evidence jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := p_source_key;
  v_target text := p_target_key;
  v_swap text;
begin
  if v_source is null or v_target is null or v_source = v_target then return; end if;

  if not coalesce(p_directed, false) and v_source > v_target then
    v_swap := v_source;
    v_source := v_target;
    v_target := v_swap;
  end if;

  insert into public.internal_graph_edge_memory (
    scope_key, source_key, target_key, relation, directed, confidence, sensitivity,
    strength, first_seen_at, last_seen_at, evidence_count, latest_evidence, expires_at
  ) values (
    p_scope_key,
    v_source,
    v_target,
    p_relation,
    coalesce(p_directed, false),
    coalesce(p_confidence, 'VERIFIED'::public.internal_graph_confidence),
    coalesce(p_sensitivity, 'standard'::public.internal_graph_sensitivity),
    least(100::numeric, greatest(0.01::numeric, coalesce(p_strength, 1))),
    coalesce(p_first_seen_at, now()),
    coalesce(p_last_seen_at, now()),
    greatest(1, coalesce(p_evidence_count, 1)),
    coalesce(p_latest_evidence, '{}'::jsonb),
    coalesce(p_expires_at, now() + interval '730 days')
  )
  on conflict (scope_key, source_key, target_key, relation, sensitivity) do update
    set first_seen_at = least(internal_graph_edge_memory.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(internal_graph_edge_memory.last_seen_at, excluded.last_seen_at),
        evidence_count = greatest(internal_graph_edge_memory.evidence_count, excluded.evidence_count),
        strength = greatest(internal_graph_edge_memory.strength, excluded.strength),
        confidence = case
          when internal_graph_edge_memory.confidence = 'VERIFIED' then internal_graph_edge_memory.confidence
          when excluded.confidence = 'VERIFIED' then excluded.confidence
          when internal_graph_edge_memory.confidence = 'DERIVED' then internal_graph_edge_memory.confidence
          else excluded.confidence
        end,
        latest_evidence = case
          when excluded.last_seen_at >= internal_graph_edge_memory.last_seen_at then excluded.latest_evidence
          else internal_graph_edge_memory.latest_evidence
        end,
        expires_at = greatest(internal_graph_edge_memory.expires_at, excluded.expires_at);
end;
$$;
revoke all on function public.upsert_internal_graph_edge(
  text, text, text, text, boolean, public.internal_graph_confidence,
  public.internal_graph_sensitivity, numeric, timestamptz, timestamptz,
  integer, jsonb, timestamptz
) from public;

-- Account erasure destroys person-linked graph nodes/edges instead of leaving a
-- permanent pseudonymous dossier. Aggregate event intelligence remains separate.
create or replace function public.purge_internal_graph_subject_on_alias_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'person:' || old.alias::text;
begin
  delete from public.internal_graph_edge_memory
  where source_key = v_key or target_key = v_key;
  delete from public.internal_graph_node_memory where node_key = v_key;
  return old;
end;
$$;

drop trigger if exists purge_internal_graph_subject_on_alias_delete
  on public.internal_graph_subject_aliases;
create trigger purge_internal_graph_subject_on_alias_delete
after delete on public.internal_graph_subject_aliases
for each row execute function public.purge_internal_graph_subject_on_alias_delete();

create or replace function public.delete_internal_assertion_edge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.internal_graph_edge_memory
  where scope_key = 'assertion:' || old.id::text;
  return old;
end;
$$;

drop trigger if exists delete_internal_assertion_edge on public.internal_graph_assertions;
create trigger delete_internal_assertion_edge
after delete on public.internal_graph_assertions
for each row execute function public.delete_internal_assertion_edge();

create or replace function public.add_internal_graph_assertion(
  p_subject_user_id uuid,
  p_entity_kind text,
  p_entity_label text,
  p_relation text,
  p_confidence public.internal_graph_confidence default 'VERIFIED',
  p_source_uri text default null,
  p_note text default null,
  p_observed_at timestamptz default now(),
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alias uuid;
  v_assertion_id uuid;
  v_entity_key text;
  v_source_key text;
  v_expiry timestamptz := coalesce(p_expires_at, now() + interval '365 days');
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_entity_kind not in ('organization', 'domain', 'project', 'topic', 'venue', 'event', 'role') then
    raise exception 'Unsupported assertion entity kind';
  end if;
  if nullif(trim(p_entity_label), '') is null or char_length(trim(p_entity_label)) > 160 then
    raise exception 'Assertion entity label must be between 1 and 160 characters';
  end if;
  if nullif(trim(p_relation), '') is null or char_length(trim(p_relation)) > 80 then
    raise exception 'Assertion relation must be between 1 and 80 characters';
  end if;
  if p_source_uri is not null and p_source_uri !~* '^https?://' then
    raise exception 'Assertion source must be an http(s) URI';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Assertion expiry must be in the future';
  end if;

  v_alias := public.ensure_internal_graph_alias(p_subject_user_id);
  if v_alias is null then raise exception 'Unknown subject'; end if;

  v_source_key := 'person:' || v_alias::text;
  v_entity_key := 'entity:' || p_entity_kind || ':' ||
    encode(digest(lower(trim(p_entity_label)), 'sha256'), 'hex');

  insert into public.internal_graph_assertions (
    created_by, subject_alias, entity_kind, entity_label, relation, confidence,
    source_uri, note, observed_at, expires_at
  ) values (
    auth.uid(), v_alias, p_entity_kind, trim(p_entity_label), trim(p_relation),
    p_confidence, nullif(trim(p_source_uri), ''), nullif(trim(p_note), ''),
    coalesce(p_observed_at, now()), v_expiry
  ) returning id into v_assertion_id;

  perform public.upsert_internal_graph_node(
    v_source_key, 'person', 'standard', p_observed_at, '{}'::jsonb,
    now() + interval '730 days'
  );
  perform public.upsert_internal_graph_node(
    v_entity_key, p_entity_kind, 'standard', p_observed_at,
    jsonb_build_object('label', trim(p_entity_label), 'manual', true), v_expiry
  );
  perform public.upsert_internal_graph_edge(
    'assertion:' || v_assertion_id::text,
    v_source_key,
    v_entity_key,
    trim(p_relation),
    true,
    p_confidence,
    'standard',
    case p_confidence when 'VERIFIED' then 1.6 when 'DERIVED' then 1.0 else 0.6 end,
    p_observed_at,
    p_observed_at,
    1,
    jsonb_build_object(
      'source', 'operator_assertion',
      'assertionId', v_assertion_id,
      'sourceUri', nullif(trim(p_source_uri), '')
    ),
    v_expiry
  );

  insert into public.internal_graph_audit_log (actor_id, action, metadata)
  values (
    auth.uid(),
    'assertion_added',
    jsonb_build_object(
      'assertionId', v_assertion_id,
      'entityKind', p_entity_kind,
      'relation', trim(p_relation),
      'confidence', p_confidence
    )
  );

  return v_assertion_id;
end;
$$;
revoke all on function public.add_internal_graph_assertion(
  uuid, text, text, text, public.internal_graph_confidence,
  text, text, timestamptz, timestamptz
) from public;
grant execute on function public.add_internal_graph_assertion(
  uuid, text, text, text, public.internal_graph_confidence,
  text, text, timestamptz, timestamptz
) to authenticated;

comment on table public.internal_graph_edge_memory is
  'Operator-only explainable relationship memory. Person identity is indirect through erasable aliases; source systems remain authoritative.';
comment on table public.internal_graph_assertions is
  'Operator-authored, provenance-required business/event-context bridges. No automated people scraping or sensitive-category enrichment.';
