-- =============================================================================
-- 077_internal_operator_decision_evidence_refs.sql
-- Exact evidence dependencies for falsifiable operator hypotheses.
--
-- This table stores edge identifiers only, never graph payloads. It lets Beacon
-- answer a narrow question defensibly: which open hypotheses actually depended on
-- an evidence edge that later entered conflict/revalidation? Unrelated hypotheses
-- must not be penalized merely because the same event contains a conflict.
-- =============================================================================

create table if not exists public.internal_operator_decision_evidence_refs (
  journal_id uuid not null references public.internal_operator_decision_journal(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  edge_id text not null check (char_length(edge_id) between 1 and 240),
  ref_kind text not null check (ref_kind in ('route_portfolio', 'forensic_review', 'manual_review')),
  created_at timestamptz not null default now(),
  primary key (journal_id, edge_id, ref_kind)
);

create index if not exists idx_internal_decision_evidence_refs_edge
  on public.internal_operator_decision_evidence_refs(operator_id, event_id, edge_id);

alter table public.internal_operator_decision_evidence_refs enable row level security;
revoke all on table public.internal_operator_decision_evidence_refs from public, anon, authenticated;

create or replace function public.record_internal_operator_decision_evidence_refs(
  p_journal_id uuid,
  p_graph_version text,
  p_edge_ids text[],
  p_ref_kind text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal public.internal_operator_decision_journal;
  v_expected text;
  v_graph jsonb;
  v_edge_id text;
  v_count integer := 0;
  v_distinct_count integer;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_ref_kind not in ('route_portfolio', 'forensic_review', 'manual_review') then
    raise exception 'Unsupported decision evidence reference kind';
  end if;
  if p_edge_ids is null then raise exception 'Evidence edge array is required'; end if;

  select * into v_journal
  from public.internal_operator_decision_journal j
  where j.id = p_journal_id
    and j.operator_id = auth.uid()
    and j.status = 'open'
    and j.expires_at > now();
  if v_journal.id is null then raise exception 'Open operator hypothesis not found'; end if;

  v_expected := public.internal_current_canonical_graph_version(v_journal.event_id);
  if p_graph_version <> v_journal.graph_version or p_graph_version <> v_expected then
    raise exception 'Decision evidence reference graph version is stale';
  end if;

  select count(distinct item) into v_distinct_count
  from unnest(p_edge_ids) item
  where nullif(trim(item), '') is not null;
  if v_distinct_count > 64 then
    raise exception 'Decision evidence reference limit is 64 distinct edges';
  end if;

  v_graph := public.get_internal_intelligence_graph(v_journal.event_id, false, 2000);
  for v_edge_id in
    select distinct trim(item)
    from unnest(p_edge_ids) item
    where nullif(trim(item), '') is not null
    order by trim(item)
  loop
    if char_length(v_edge_id) > 240 then raise exception 'Evidence edge id exceeds boundary'; end if;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(v_graph->'edges', '[]'::jsonb)) edge
      where edge->>'id' = v_edge_id
    ) then
      raise exception 'Decision evidence edge is not present in authorized graph';
    end if;

    insert into public.internal_operator_decision_evidence_refs(
      journal_id, operator_id, event_id, graph_version, edge_id, ref_kind
    ) values (
      v_journal.id, auth.uid(), v_journal.event_id, p_graph_version, v_edge_id, p_ref_kind
    ) on conflict do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'decision_evidence_refs_recorded', v_journal.event_id,
    jsonb_build_object('journalId', v_journal.id, 'refKind', p_ref_kind, 'recordedCount', v_count, 'graphVersion', p_graph_version)
  );
  return v_count;
end;
$$;
revoke all on function public.record_internal_operator_decision_evidence_refs(uuid, text, text[], text) from public;
grant execute on function public.record_internal_operator_decision_evidence_refs(uuid, text, text[], text) to authenticated;

create or replace function public.get_internal_operator_decision_evidence_refs(
  p_event_id uuid default null,
  p_open_only boolean default true,
  p_limit integer default 1200
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
    'journalId', r.journal_id,
    'eventId', r.event_id,
    'graphVersion', r.graph_version,
    'edgeId', r.edge_id,
    'refKind', r.ref_kind,
    'createdAt', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select refs.*
    from public.internal_operator_decision_evidence_refs refs
    join public.internal_operator_decision_journal journal on journal.id = refs.journal_id
    where refs.operator_id = auth.uid()
      and (p_event_id is null or refs.event_id = p_event_id)
      and (not coalesce(p_open_only, true) or journal.status = 'open')
      and journal.expires_at > now()
    order by refs.created_at desc
    limit least(4000, greatest(1, coalesce(p_limit, 1200)))
  ) r;

  return jsonb_build_object(
    'generatedAt', now(),
    'refs', v_rows,
    'operatingRule', 'Decision evidence references store only exact edge identifiers used by an operator hypothesis. They do not copy graph payloads or imply the referenced evidence is true.'
  );
end;
$$;
revoke all on function public.get_internal_operator_decision_evidence_refs(uuid, boolean, integer) from public;
grant execute on function public.get_internal_operator_decision_evidence_refs(uuid, boolean, integer) to authenticated;

comment on table public.internal_operator_decision_evidence_refs is
  'Exact edge-level dependency references for private falsifiable hypotheses. Used for targeted revalidation; unrelated hypotheses must not inherit conflict state.';
