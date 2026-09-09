-- =============================================================================
-- 076_internal_graph_evidence_conflicts.sql
-- Explicit operator-confirmed evidence conflicts for Constellation.
--
-- This is NOT an automatic contradiction detector. A conflict can be created only
-- by an authorized graph-management operator, against two concrete edges that both
-- exist in the exact canonical graph version under review. Both evidence edges are
-- preserved; resolution updates only the conflict ledger, never canonical truth.
-- =============================================================================

create table if not exists public.internal_graph_evidence_conflicts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.users(id) on delete set null,
  resolved_by uuid references public.users(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  left_edge_id text not null check (char_length(left_edge_id) between 1 and 240),
  right_edge_id text not null check (char_length(right_edge_id) between 1 and 240),
  conflict_kind text not null check (conflict_kind in (
    'provenance_disagreement',
    'temporal_overlap',
    'state_collision',
    'scope_mismatch',
    'manual_review'
  )),
  review_priority smallint not null default 3 check (review_priority between 1 and 5),
  rationale text not null check (char_length(trim(rationale)) between 8 and 700),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(trim(resolution_note)) between 3 and 700),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '180 days'),
  check (left_edge_id <> right_edge_id),
  check (expires_at > created_at and expires_at <= created_at + interval '365 days')
);

create index if not exists idx_internal_graph_evidence_conflicts_scope
  on public.internal_graph_evidence_conflicts(event_id, status, review_priority desc, updated_at desc);
create index if not exists idx_internal_graph_evidence_conflicts_edges
  on public.internal_graph_evidence_conflicts(left_edge_id, right_edge_id, status);

alter table public.internal_graph_evidence_conflicts enable row level security;
revoke all on table public.internal_graph_evidence_conflicts from public, anon, authenticated;

create or replace function public.internal_conflict_text_safe(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text is not null
    and p_text !~* 'https?://'
    and p_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
$$;
revoke all on function public.internal_conflict_text_safe(text) from public;

create or replace function public.create_internal_graph_evidence_conflict(
  p_event_id uuid,
  p_graph_version text,
  p_left_edge_id text,
  p_right_edge_id text,
  p_conflict_kind text,
  p_review_priority integer,
  p_rationale text,
  p_ttl_days integer default 180
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_version text;
  v_graph jsonb;
  v_left text;
  v_right text;
  v_id uuid;
  v_ttl integer := coalesce(p_ttl_days, 180);
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_conflict_kind not in ('provenance_disagreement', 'temporal_overlap', 'state_collision', 'scope_mismatch', 'manual_review') then
    raise exception 'Unsupported evidence conflict kind';
  end if;
  if p_review_priority is null or p_review_priority < 1 or p_review_priority > 5 then
    raise exception 'Conflict review priority must be between one and five';
  end if;
  if v_ttl < 7 or v_ttl > 365 then
    raise exception 'Conflict TTL must be between 7 and 365 days';
  end if;
  if not public.internal_conflict_text_safe(p_rationale)
     or char_length(trim(p_rationale)) not between 8 and 700 then
    raise exception 'Conflict rationale must be bounded and contain no direct email address or external URL';
  end if;
  if nullif(trim(p_left_edge_id), '') is null or nullif(trim(p_right_edge_id), '') is null
     or p_left_edge_id = p_right_edge_id then
    raise exception 'Two distinct edge ids are required';
  end if;

  v_expected_version := public.internal_current_canonical_graph_version(p_event_id);
  if p_graph_version <> v_expected_version then
    raise exception 'Evidence conflict graph version is stale';
  end if;

  -- Validate submitted edge identifiers against the server-derived evidence graph.
  -- Canonicalization retains a concrete source edge id for every coalesced edge, so
  -- an edge selected in the operator graph must still resolve in this raw graph.
  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_graph->'edges', '[]'::jsonb)) edge
    where edge->>'id' = p_left_edge_id
  ) then raise exception 'Left evidence edge is not present in authorized graph'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_graph->'edges', '[]'::jsonb)) edge
    where edge->>'id' = p_right_edge_id
  ) then raise exception 'Right evidence edge is not present in authorized graph'; end if;

  if p_left_edge_id < p_right_edge_id then
    v_left := p_left_edge_id; v_right := p_right_edge_id;
  else
    v_left := p_right_edge_id; v_right := p_left_edge_id;
  end if;

  select c.id into v_id
  from public.internal_graph_evidence_conflicts c
  where c.status = 'open'
    and c.expires_at > now()
    and c.event_id is not distinct from p_event_id
    and c.left_edge_id = v_left
    and c.right_edge_id = v_right
    and c.conflict_kind = p_conflict_kind
  order by c.created_at desc
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.internal_graph_evidence_conflicts(
    created_by, event_id, graph_version, left_edge_id, right_edge_id,
    conflict_kind, review_priority, rationale, expires_at
  ) values (
    auth.uid(), p_event_id, p_graph_version, v_left, v_right,
    p_conflict_kind, p_review_priority, trim(p_rationale), now() + make_interval(days => v_ttl)
  ) returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_evidence_conflict_created', p_event_id,
    jsonb_build_object('conflictId', v_id, 'kind', p_conflict_kind, 'reviewPriority', p_review_priority, 'graphVersion', p_graph_version)
  );
  return v_id;
end;
$$;
revoke all on function public.create_internal_graph_evidence_conflict(uuid, text, text, text, text, integer, text, integer) from public;
grant execute on function public.create_internal_graph_evidence_conflict(uuid, text, text, text, text, integer, text, integer) to authenticated;

create or replace function public.get_internal_graph_evidence_conflicts(
  p_event_id uuid default null,
  p_include_closed boolean default false,
  p_limit integer default 160
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'eventId', c.event_id,
    'graphVersion', c.graph_version,
    'leftEdgeId', c.left_edge_id,
    'rightEdgeId', c.right_edge_id,
    'kind', c.conflict_kind,
    'reviewPriority', c.review_priority,
    'rationale', c.rationale,
    'status', c.status,
    'resolutionNote', c.resolution_note,
    'createdAt', c.created_at,
    'updatedAt', c.updated_at,
    'resolvedAt', c.resolved_at,
    'expiresAt', c.expires_at
  ) order by (c.status = 'open') desc, c.review_priority desc, c.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.internal_graph_evidence_conflicts
    where expires_at > now()
      and (p_event_id is null or event_id = p_event_id)
      and (coalesce(p_include_closed, false) or status = 'open')
    order by (status = 'open') desc, review_priority desc, updated_at desc
    limit least(300, greatest(1, coalesce(p_limit, 160)))
  ) c;

  return jsonb_build_object(
    'generatedAt', now(),
    'conflicts', v_rows,
    'operatingRule', 'Evidence Conflict Ledger preserves both evidence edges and records an operator-confirmed review conflict. Open conflict does not mean either edge is false and never changes canonical graph truth automatically.'
  );
end;
$$;
revoke all on function public.get_internal_graph_evidence_conflicts(uuid, boolean, integer) from public;
grant execute on function public.get_internal_graph_evidence_conflicts(uuid, boolean, integer) to authenticated;

create or replace function public.resolve_internal_graph_evidence_conflict(
  p_conflict_id uuid,
  p_status text,
  p_resolution_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_event_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Conflict status must be resolved or dismissed';
  end if;
  if not public.internal_conflict_text_safe(p_resolution_note)
     or char_length(trim(p_resolution_note)) not between 3 and 700 then
    raise exception 'Resolution note must be bounded and contain no direct email address or external URL';
  end if;

  update public.internal_graph_evidence_conflicts c
  set status = p_status,
      resolution_note = trim(p_resolution_note),
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  where c.id = p_conflict_id and c.status = 'open' and c.expires_at > now()
  returning c.event_id into v_event_id;
  if not found then raise exception 'Open evidence conflict not found'; end if;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (auth.uid(), 'graph_evidence_conflict_closed', v_event_id,
          jsonb_build_object('conflictId', p_conflict_id, 'status', p_status));
  return true;
end;
$$;
revoke all on function public.resolve_internal_graph_evidence_conflict(uuid, text, text) from public;
grant execute on function public.resolve_internal_graph_evidence_conflict(uuid, text, text) to authenticated;

create or replace function public.prune_internal_graph_evidence_conflicts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_evidence_conflicts where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_graph_evidence_conflicts() from public;
grant execute on function public.prune_internal_graph_evidence_conflicts() to service_role;

comment on table public.internal_graph_evidence_conflicts is
  'Operator-confirmed, graph-version-bound evidence review conflicts. Both source evidence edges remain intact; conflict state never rewrites canonical graph truth.';
