-- =============================================================================
-- 074_internal_graph_case_rehydration.sql
-- Per-operator Casebook rehydration state and resolvable analytical questions.
--
-- Rehydration answers "what changed since I last looked?" without storing an old
-- graph snapshot. It retains only per-operator last-seen pointers/version metadata
-- and derives new shared-memory activity from the existing bounded case chronology.
-- =============================================================================

alter table public.internal_graph_case_memory_entries
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.users(id) on delete set null;

create table if not exists public.internal_graph_case_operator_state (
  case_id uuid not null references public.internal_graph_cases(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_seen_graph_version text not null check (char_length(last_seen_graph_version) between 8 and 240),
  last_seen_memory_at timestamptz,
  primary key (case_id, operator_id)
);

alter table public.internal_graph_case_operator_state enable row level security;
revoke all on table public.internal_graph_case_operator_state from public, anon, authenticated;

create or replace function public.resolve_internal_graph_case_question(
  p_case_id uuid,
  p_entry_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_case
  from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now() and c.status <> 'archived';
  if v_case.id is null then raise exception 'Case is not active'; end if;

  update public.internal_graph_case_memory_entries m
  set resolved_at = now(), resolved_by = auth.uid()
  where m.id = p_entry_id
    and m.case_id = p_case_id
    and m.entry_kind = 'question'
    and m.resolved_at is null
    and m.expires_at > now();
  if not found then raise exception 'Open case-memory question not found'; end if;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (auth.uid(), 'graph_case_question_resolved', v_case.scope_event_id,
          jsonb_build_object('caseId', p_case_id, 'entryId', p_entry_id));
  return true;
end;
$$;
revoke all on function public.resolve_internal_graph_case_question(uuid, uuid) from public;
grant execute on function public.resolve_internal_graph_case_question(uuid, uuid) to authenticated;

create or replace function public.get_internal_graph_case_rehydration(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
  v_state public.internal_graph_case_operator_state;
  v_current_version text;
  v_since timestamptz;
  v_new_count integer;
  v_open_questions integer;
  v_last_memory timestamptz;
  v_recommended text := 'InternalCollaborativeCaseMemory';
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_case
  from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now();
  if v_case.id is null then raise exception 'Unknown or expired case'; end if;

  v_current_version := public.internal_current_canonical_graph_version(v_case.scope_event_id);
  select * into v_state from public.internal_graph_case_operator_state s
  where s.case_id = p_case_id and s.operator_id = auth.uid();
  v_since := v_state.last_seen_memory_at;

  select count(*), max(m.created_at)
  into v_new_count, v_last_memory
  from public.internal_graph_case_memory_entries m
  where m.case_id = p_case_id and m.expires_at > now()
    and (v_since is null or m.created_at > v_since);

  select count(*) into v_open_questions
  from public.internal_graph_case_memory_entries m
  where m.case_id = p_case_id and m.entry_kind = 'question'
    and m.resolved_at is null and m.expires_at > now();

  if exists (
    select 1 from public.internal_graph_case_memory_entries m
    where m.case_id = p_case_id and m.expires_at > now()
      and (v_since is null or m.created_at > v_since) and m.entry_kind = 'verification'
  ) then v_recommended := 'InternalEvidenceDebt';
  elsif exists (
    select 1 from public.internal_graph_case_memory_entries m
    where m.case_id = p_case_id and m.expires_at > now()
      and (v_since is null or m.created_at > v_since) and m.entry_kind = 'timeline'
  ) then v_recommended := 'InternalAgenticTimeline';
  elsif exists (
    select 1 from public.internal_graph_case_memory_entries m
    where m.case_id = p_case_id and m.expires_at > now()
      and (v_since is null or m.created_at > v_since) and m.entry_kind = 'decision'
  ) then v_recommended := 'InternalDecisionJournal';
  elsif exists (
    select 1 from public.internal_graph_case_memory_entries m
    where m.case_id = p_case_id and m.expires_at > now()
      and (v_since is null or m.created_at > v_since) and m.entry_kind = 'handoff'
  ) then v_recommended := 'InternalHandoffLab';
  elsif v_state.last_seen_graph_version is not null and v_state.last_seen_graph_version <> v_current_version then
    v_recommended := 'InternalGraph';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'caseId', v_case.id,
    'caseTitle', v_case.title,
    'currentGraphVersion', v_current_version,
    'lastSeenAt', v_state.last_seen_at,
    'lastSeenGraphVersion', v_state.last_seen_graph_version,
    'graphVersionChanged', v_state.last_seen_graph_version is not null and v_state.last_seen_graph_version <> v_current_version,
    'newMemoryCount', coalesce(v_new_count, 0),
    'openQuestionCount', coalesce(v_open_questions, 0),
    'assignmentChanged', v_case.assigned_at is not null and (v_state.last_seen_at is null or v_case.assigned_at > v_state.last_seen_at),
    'assignedOperatorId', v_case.assigned_operator,
    'assignedOperatorLabel', case when v_case.assigned_operator is null then null else coalesce((select nullif(trim(u.name),'') from public.users u where u.id = v_case.assigned_operator), 'Operator ' || left(v_case.assigned_operator::text, 8)) end,
    'lastMemoryAt', v_last_memory,
    'newMemoryByKind', coalesce((
      select jsonb_object_agg(x.entry_kind, x.cnt)
      from (
        select m.entry_kind, count(*)::int cnt
        from public.internal_graph_case_memory_entries m
        where m.case_id = p_case_id and m.expires_at > now()
          and (v_since is null or m.created_at > v_since)
        group by m.entry_kind
      ) x
    ), '{}'::jsonb),
    'latestNewEntries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', y.id,
        'kind', y.entry_kind,
        'title', y.title,
        'authorLabel', coalesce(nullif(trim(u.name),''), case when y.author_id is null then 'Deleted operator' else 'Operator ' || left(y.author_id::text,8) end),
        'createdAt', y.created_at,
        'graphVersion', y.graph_version,
        'resolvedAt', y.resolved_at
      ) order by y.created_at desc)
      from (
        select * from public.internal_graph_case_memory_entries m
        where m.case_id = p_case_id and m.expires_at > now()
          and (v_since is null or m.created_at > v_since)
        order by m.created_at desc limit 12
      ) y
      left join public.users u on u.id = y.author_id
    ), '[]'::jsonb),
    'recommendedSurface', v_recommended,
    'operatingRule', 'Case Rehydration derives what changed since this operator last reviewed the case. It stores no graph snapshots and makes no causal or social inference.'
  );
end;
$$;
revoke all on function public.get_internal_graph_case_rehydration(uuid) from public;
grant execute on function public.get_internal_graph_case_rehydration(uuid) to authenticated;

create or replace function public.mark_internal_graph_case_seen(
  p_case_id uuid,
  p_graph_version text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
  v_expected text;
  v_last_memory timestamptz;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_case from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now();
  if v_case.id is null then raise exception 'Unknown or expired case'; end if;
  v_expected := public.internal_current_canonical_graph_version(v_case.scope_event_id);
  if p_graph_version <> v_expected then raise exception 'Cannot acknowledge stale case graph version'; end if;

  select max(m.created_at) into v_last_memory
  from public.internal_graph_case_memory_entries m
  where m.case_id = p_case_id and m.expires_at > now();

  insert into public.internal_graph_case_operator_state(
    case_id, operator_id, last_seen_at, last_seen_graph_version, last_seen_memory_at
  ) values (
    p_case_id, auth.uid(), now(), v_expected, v_last_memory
  )
  on conflict (case_id, operator_id) do update set
    last_seen_at = excluded.last_seen_at,
    last_seen_graph_version = excluded.last_seen_graph_version,
    last_seen_memory_at = excluded.last_seen_memory_at;
  return true;
end;
$$;
revoke all on function public.mark_internal_graph_case_seen(uuid, text) from public;
grant execute on function public.mark_internal_graph_case_seen(uuid, text) to authenticated;

comment on table public.internal_graph_case_operator_state is
  'Private per-operator Casebook read state used to derive rehydration briefs. It stores only last-seen timestamps and canonical graph version metadata, never graph payloads.';
