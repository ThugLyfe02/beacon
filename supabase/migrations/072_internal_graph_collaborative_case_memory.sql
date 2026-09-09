-- =============================================================================
-- 072_internal_graph_collaborative_case_memory.sql
-- Shared, bounded operator memory for Casebook investigations.
--
-- Case memory preserves analytical intent and evidence context, not graph payloads.
-- Every analytical entry is bound to the current canonical graph version and keeps
-- only a SHA-256 digest of the submitted evidence summary. Active graph-management
-- operators may collaborate; normal users and direct table clients cannot read it.
-- =============================================================================

alter table public.internal_graph_cases
  add column if not exists assigned_operator uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

create table if not exists public.internal_graph_case_memory_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.internal_graph_cases(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  entry_kind text not null check (entry_kind in (
    'checkpoint', 'question', 'verification', 'decision', 'timeline', 'handoff', 'note'
  )),
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  perspective_fingerprint text check (perspective_fingerprint is null or char_length(perspective_fingerprint) <= 120),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(trim(title)) between 1 and 140),
  body text not null check (char_length(trim(body)) between 1 and 1200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  check (expires_at > created_at and expires_at <= created_at + interval '365 days')
);

create index if not exists idx_internal_graph_case_memory_case
  on public.internal_graph_case_memory_entries(case_id, created_at desc);
create index if not exists idx_internal_graph_case_memory_author
  on public.internal_graph_case_memory_entries(author_id, created_at desc);

alter table public.internal_graph_case_memory_entries enable row level security;
revoke all on table public.internal_graph_case_memory_entries from public, anon, authenticated;

create or replace function public.internal_current_canonical_graph_version(p_event_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_graph jsonb;
  v_raw text;
  v_alias text;
begin
  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_raw := coalesce(v_graph->>'graphVersion', '');
  v_alias := public.internal_graph_entity_alias_version();
  if exists (select 1 from public.internal_graph_entity_aliases where expires_at > now()) then
    return v_raw || ':canon:' || left(v_alias, 12);
  end if;
  return v_raw;
end;
$$;
revoke all on function public.internal_current_canonical_graph_version(uuid) from public;

create or replace function public.assign_internal_graph_case(
  p_case_id uuid,
  p_operator_id uuid
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

  if p_operator_id is not null and not exists (
    select 1 from public.internal_operator_access access
    where access.user_id = p_operator_id
      and (access.expires_at is null or access.expires_at > now())
      and 'graph_manage' = any(access.capabilities)
  ) then
    raise exception 'Assignee is not an active graph-management operator';
  end if;

  update public.internal_graph_cases
  set assigned_operator = p_operator_id,
      assigned_at = case when p_operator_id is null then null else now() end,
      updated_at = now()
  where id = p_case_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_case_assignment_changed', v_case.scope_event_id,
    jsonb_build_object('caseId', p_case_id, 'assignedOperator', p_operator_id)
  );
  return true;
end;
$$;
revoke all on function public.assign_internal_graph_case(uuid, uuid) from public;
grant execute on function public.assign_internal_graph_case(uuid, uuid) to authenticated;

create or replace function public.append_internal_graph_case_memory(
  p_case_id uuid,
  p_entry_kind text,
  p_graph_version text,
  p_perspective_fingerprint text,
  p_title text,
  p_body text,
  p_evidence_summary jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
  v_expected_version text;
  v_digest text;
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_entry_kind not in ('checkpoint', 'question', 'verification', 'decision', 'timeline', 'handoff', 'note') then
    raise exception 'Unsupported case-memory entry kind';
  end if;

  select * into v_case
  from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now() and c.status <> 'archived';
  if v_case.id is null then raise exception 'Case is not active for collaborative memory'; end if;

  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 140
     or nullif(trim(p_body), '') is null or char_length(trim(p_body)) > 1200 then
    raise exception 'Case-memory text exceeds bounded limits';
  end if;
  if not public.internal_handoff_text_safe(p_title) or not public.internal_handoff_text_safe(p_body) then
    raise exception 'Case-memory text must not contain direct email addresses or external URLs';
  end if;
  if p_perspective_fingerprint is not null and char_length(p_perspective_fingerprint) > 120 then
    raise exception 'Perspective fingerprint is too long';
  end if;
  if p_evidence_summary is null or jsonb_typeof(p_evidence_summary) <> 'object'
     or pg_column_size(p_evidence_summary) > 8192 then
    raise exception 'Case-memory evidence summary must be a bounded object';
  end if;

  v_expected_version := public.internal_current_canonical_graph_version(v_case.scope_event_id);
  if p_graph_version <> v_expected_version then
    raise exception 'Case-memory graph version is stale';
  end if;
  v_digest := encode(digest(p_evidence_summary::text, 'sha256'), 'hex');

  insert into public.internal_graph_case_memory_entries(
    case_id, author_id, entry_kind, graph_version, perspective_fingerprint,
    evidence_digest, title, body
  ) values (
    p_case_id, auth.uid(), p_entry_kind, p_graph_version, nullif(trim(p_perspective_fingerprint), ''),
    v_digest, trim(p_title), trim(p_body)
  ) returning id into v_id;

  update public.internal_graph_cases
  set updated_at = now(), last_evaluated_at = now()
  where id = p_case_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_case_memory_appended', v_case.scope_event_id,
    jsonb_build_object('caseId', p_case_id, 'entryId', v_id, 'entryKind', p_entry_kind, 'evidenceDigest', v_digest)
  );
  return v_id;
end;
$$;
revoke all on function public.append_internal_graph_case_memory(uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.append_internal_graph_case_memory(uuid, text, text, text, text, text, jsonb) to authenticated;

create or replace function public.get_internal_graph_case_collaboration(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$;
declare
  v_case public.internal_graph_cases;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_case
  from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now();
  if v_case.id is null then raise exception 'Unknown or expired case'; end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'caseId', v_case.id,
    'caseTitle', v_case.title,
    'assignedOperatorId', v_case.assigned_operator,
    'assignedOperatorLabel', case
      when v_case.assigned_operator is null then null
      else coalesce((select nullif(trim(u.name), '') from public.users u where u.id = v_case.assigned_operator), 'Operator ' || left(v_case.assigned_operator::text, 8))
    end,
    'assignedAt', v_case.assigned_at,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'authorId', m.author_id,
        'authorLabel', coalesce(nullif(trim(u.name), ''), case when m.author_id is null then 'Deleted operator' else 'Operator ' || left(m.author_id::text, 8) end),
        'kind', m.entry_kind,
        'graphVersion', m.graph_version,
        'perspectiveFingerprint', m.perspective_fingerprint,
        'evidenceDigest', m.evidence_digest,
        'title', m.title,
        'body', m.body,
        'createdAt', m.created_at,
        'expiresAt', m.expires_at
      ) order by m.created_at desc)
      from public.internal_graph_case_memory_entries m
      left join public.users u on u.id = m.author_id
      where m.case_id = v_case.id and m.expires_at > now()
    ), '[]'::jsonb),
    'operatingRule', 'Collaborative Case Memory stores bounded operator reasoning bound to canonical graph versions and evidence digests. It does not copy graph payloads or create relationship truth.'
  );
end;
$$;
revoke all on function public.get_internal_graph_case_collaboration(uuid) from public;
grant execute on function public.get_internal_graph_case_collaboration(uuid) to authenticated;

create or replace function public.capture_internal_handoff_case_memory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
  v_author uuid;
begin
  v_author := auth.uid();
  if tg_op = 'INSERT' then
    v_title := 'Investigation handoff created';
    v_body := left(new.summary || ' Next question: ' || new.next_question, 1200);
  elsif old.status is distinct from new.status then
    v_title := 'Investigation handoff status changed';
    v_body := 'Handoff transitioned from ' || old.status || ' to ' || new.status || '.';
  else
    return new;
  end if;

  insert into public.internal_graph_case_memory_entries(
    case_id, author_id, entry_kind, graph_version, perspective_fingerprint,
    evidence_digest, title, body, expires_at
  ) values (
    new.case_id, v_author, 'handoff', new.graph_version, new.perspective_fingerprint,
    new.evidence_digest, v_title, v_body, least(new.expires_at, now() + interval '365 days')
  );
  return new;
end;
$$;
revoke all on function public.capture_internal_handoff_case_memory() from public;

drop trigger if exists internal_graph_case_handoff_memory on public.internal_graph_case_handoffs;
create trigger internal_graph_case_handoff_memory
after insert or update of status on public.internal_graph_case_handoffs
for each row execute function public.capture_internal_handoff_case_memory();

create or replace function public.prune_internal_graph_case_memory()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_case_memory_entries where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_graph_case_memory() from public;
grant execute on function public.prune_internal_graph_case_memory() to service_role;

comment on table public.internal_graph_case_memory_entries is
  'Bounded collaborative analytical memory for Casebook investigations. Evidence summaries are retained only as SHA-256 digests and every entry is bound to a canonical graph version.';
