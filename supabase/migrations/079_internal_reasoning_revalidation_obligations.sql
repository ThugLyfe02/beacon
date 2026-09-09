-- =============================================================================
-- 079_internal_reasoning_revalidation_obligations.sql
-- Durable, exact revalidation obligations for analytical artifacts.
--
-- A conflict or graph change must not silently invalidate a hypothesis, but it also
-- must not disappear when the operator leaves the screen. This ledger records an
-- operator-scoped review obligation without mutating graph truth or journal status.
-- Automatic conflict obligations are created only through exact decision→edge refs.
-- =============================================================================

create table if not exists public.internal_reasoning_revalidation_obligations (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in ('decision_journal','case','machine_manifest')),
  artifact_id text not null check (char_length(artifact_id) between 1 and 240),
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  reason_kind text not null check (reason_kind in ('evidence_conflict','orphaned_ref','canonical_graph_change','temporal_incoherence','manual_review')),
  source_id text check (source_id is null or char_length(source_id) between 1 and 240),
  priority smallint not null default 3 check (priority between 1 and 5),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  rationale text not null check (char_length(rationale) between 8 and 1000),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1200),
  expires_at timestamptz not null default (now() + interval '120 days'),
  unique(operator_id, artifact_kind, artifact_id, reason_kind, source_id)
);

create index if not exists idx_internal_reasoning_revalidation_operator
  on public.internal_reasoning_revalidation_obligations(operator_id, status, priority desc, created_at desc);
create index if not exists idx_internal_reasoning_revalidation_event
  on public.internal_reasoning_revalidation_obligations(event_id, status, created_at desc);

alter table public.internal_reasoning_revalidation_obligations enable row level security;
revoke all on table public.internal_reasoning_revalidation_obligations from public, anon, authenticated;

create or replace function public.capture_internal_conflict_revalidation_obligations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref record;
  v_priority smallint;
begin
  if new.status <> 'open' then return new; end if;
  v_priority := greatest(1, least(5, new.review_priority));

  for v_ref in
    select distinct refs.operator_id, refs.journal_id, refs.event_id, refs.graph_version
    from public.internal_operator_decision_evidence_refs refs
    join public.internal_operator_decision_journal journal on journal.id = refs.journal_id
    where refs.event_id is not distinct from new.event_id
      and journal.status = 'open'
      and journal.expires_at > now()
      and refs.edge_id in (new.left_edge_id, new.right_edge_id)
  loop
    insert into public.internal_reasoning_revalidation_obligations(
      operator_id, event_id, artifact_kind, artifact_id, graph_version,
      reason_kind, source_id, priority, status, rationale, expires_at
    ) values (
      v_ref.operator_id, v_ref.event_id, 'decision_journal', v_ref.journal_id::text,
      v_ref.graph_version, 'evidence_conflict', new.id::text, v_priority, 'open',
      'An operator-confirmed evidence conflict intersects an exact recorded dependency of this open hypothesis. Revalidate the hypothesis after conflict review; conflict does not imply either edge or the hypothesis is false.',
      least(new.expires_at, now() + interval '120 days')
    )
    on conflict (operator_id, artifact_kind, artifact_id, reason_kind, source_id)
    do update set
      priority = greatest(public.internal_reasoning_revalidation_obligations.priority, excluded.priority),
      status = case when public.internal_reasoning_revalidation_obligations.status = 'resolved' then 'open' else public.internal_reasoning_revalidation_obligations.status end,
      rationale = excluded.rationale,
      resolved_at = null,
      resolution_note = null,
      expires_at = greatest(public.internal_reasoning_revalidation_obligations.expires_at, excluded.expires_at);
  end loop;
  return new;
end;
$$;
revoke all on function public.capture_internal_conflict_revalidation_obligations() from public;

-- A conflict is created only by the hardened operator RPC. The trigger derives
-- affected decisions from exact stored refs so no client can submit arbitrary
-- journal IDs as "impacted" artifacts.
drop trigger if exists capture_conflict_revalidation_obligations on public.internal_graph_evidence_conflicts;
create trigger capture_conflict_revalidation_obligations
after insert or update of status, review_priority on public.internal_graph_evidence_conflicts
for each row execute function public.capture_internal_conflict_revalidation_obligations();

create or replace function public.get_internal_reasoning_revalidation_obligations(
  p_event_id uuid default null,
  p_include_resolved boolean default false,
  p_limit integer default 240
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
    'id', r.id,
    'eventId', r.event_id,
    'artifactKind', r.artifact_kind,
    'artifactId', r.artifact_id,
    'graphVersion', r.graph_version,
    'reasonKind', r.reason_kind,
    'sourceId', r.source_id,
    'priority', r.priority,
    'status', r.status,
    'rationale', r.rationale,
    'createdAt', r.created_at,
    'acknowledgedAt', r.acknowledged_at,
    'resolvedAt', r.resolved_at,
    'resolutionNote', r.resolution_note,
    'expiresAt', r.expires_at
  ) order by r.priority desc, r.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select *
    from public.internal_reasoning_revalidation_obligations obligation
    where obligation.operator_id = auth.uid()
      and obligation.expires_at > now()
      and (p_event_id is null or obligation.event_id = p_event_id)
      and (coalesce(p_include_resolved, false) or obligation.status <> 'resolved')
    order by obligation.priority desc, obligation.created_at desc
    limit least(800, greatest(1, coalesce(p_limit, 240)))
  ) r;

  return jsonb_build_object(
    'generatedAt', now(),
    'obligations', v_rows,
    'operatingRule', 'Revalidation obligations are private analytical-memory tasks derived from exact evidence dependencies. They never invalidate graph evidence or authorize action automatically.'
  );
end;
$$;
revoke all on function public.get_internal_reasoning_revalidation_obligations(uuid, boolean, integer) from public;
grant execute on function public.get_internal_reasoning_revalidation_obligations(uuid, boolean, integer) to authenticated;

create or replace function public.update_internal_reasoning_revalidation_obligation(
  p_id uuid,
  p_status text,
  p_resolution_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('acknowledged','resolved') then raise exception 'Unsupported revalidation status'; end if;
  if p_status = 'resolved' and char_length(trim(coalesce(p_resolution_note,''))) < 3 then
    raise exception 'Resolution note required';
  end if;
  if char_length(coalesce(p_resolution_note,'')) > 1200 then raise exception 'Resolution note too long'; end if;

  update public.internal_reasoning_revalidation_obligations obligation
  set status = p_status,
      acknowledged_at = case when p_status = 'acknowledged' then coalesce(obligation.acknowledged_at, now()) else obligation.acknowledged_at end,
      resolved_at = case when p_status = 'resolved' then now() else obligation.resolved_at end,
      resolution_note = case when p_status = 'resolved' then trim(p_resolution_note) else obligation.resolution_note end
  where obligation.id = p_id
    and obligation.operator_id = auth.uid()
    and obligation.expires_at > now();
  if not found then raise exception 'Revalidation obligation not found'; end if;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  select auth.uid(), 'reasoning_revalidation_' || p_status, obligation.event_id,
         jsonb_build_object('obligationId', obligation.id, 'artifactKind', obligation.artifact_kind, 'artifactId', obligation.artifact_id, 'reasonKind', obligation.reason_kind)
  from public.internal_reasoning_revalidation_obligations obligation where obligation.id = p_id;
  return true;
end;
$$;
revoke all on function public.update_internal_reasoning_revalidation_obligation(uuid, text, text) from public;
grant execute on function public.update_internal_reasoning_revalidation_obligation(uuid, text, text) to authenticated;

create or replace function public.prune_internal_reasoning_revalidation_obligations(p_before timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_reasoning_revalidation_obligations where expires_at <= p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_reasoning_revalidation_obligations(timestamptz) from public;
grant execute on function public.prune_internal_reasoning_revalidation_obligations(timestamptz) to service_role;

comment on table public.internal_reasoning_revalidation_obligations is
  'Bounded private analytical revalidation tasks. Conflict-derived decision obligations are created only from exact stored decision→edge refs; no person scoring or graph mutation occurs.';
