-- =============================================================================
-- 070_internal_graph_case_handoffs.sql
-- Bounded operator-to-operator investigation handoff capsules.
--
-- Handoffs transfer analytical context, not graph payloads. Evidence summaries
-- are SHA-256 digested server-side. Only sender/recipient can read/comment.
-- =============================================================================

create table if not exists public.internal_graph_case_handoffs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.internal_graph_cases(id) on delete cascade,
  from_operator uuid references public.users(id) on delete set null,
  to_operator uuid not null references public.users(id) on delete cascade,
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  perspective_fingerprint text check (perspective_fingerprint is null or char_length(perspective_fingerprint) <= 120),
  perspective_title text check (perspective_title is null or char_length(perspective_title) <= 100),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  summary text not null check (char_length(trim(summary)) between 12 and 900),
  next_question text not null check (char_length(trim(next_question)) between 8 and 700),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'resolved', 'withdrawn')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create unique index if not exists idx_internal_graph_case_handoff_active_unique
  on public.internal_graph_case_handoffs(case_id, to_operator)
  where status in ('open', 'accepted');
create index if not exists idx_internal_graph_case_handoff_recipient
  on public.internal_graph_case_handoffs(to_operator, created_at desc);
create index if not exists idx_internal_graph_case_handoff_sender
  on public.internal_graph_case_handoffs(from_operator, created_at desc);

create table if not exists public.internal_graph_case_handoff_notes (
  id uuid primary key default gen_random_uuid(),
  handoff_id uuid not null references public.internal_graph_case_handoffs(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  note text not null check (char_length(trim(note)) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists idx_internal_graph_case_handoff_notes
  on public.internal_graph_case_handoff_notes(handoff_id, created_at);

alter table public.internal_graph_case_handoffs enable row level security;
alter table public.internal_graph_case_handoff_notes enable row level security;
revoke all on table public.internal_graph_case_handoffs from public, anon, authenticated;
revoke all on table public.internal_graph_case_handoff_notes from public, anon, authenticated;

create or replace function public.internal_handoff_text_safe(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text is not null
    and p_text !~* 'https?://'
    and p_text !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
$$;
revoke all on function public.internal_handoff_text_safe(text) from public;

create or replace function public.get_internal_handoff_operator_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'operators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', access.user_id,
        'label', coalesce(nullif(trim(u.name), ''), 'Operator ' || left(access.user_id::text, 8))
      ) order by coalesce(nullif(trim(u.name), ''), access.user_id::text))
      from public.internal_operator_access access
      join public.users u on u.id = access.user_id
      where (access.expires_at is null or access.expires_at > now())
        and 'graph_manage' = any(access.capabilities)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_internal_handoff_operator_directory() from public;
grant execute on function public.get_internal_handoff_operator_directory() to authenticated;

create or replace function public.create_internal_graph_case_handoff(
  p_case_id uuid,
  p_to_operator uuid,
  p_graph_version text,
  p_perspective_fingerprint text,
  p_perspective_title text,
  p_summary text,
  p_next_question text,
  p_evidence_summary jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
  v_graph jsonb;
  v_raw_version text;
  v_alias_version text;
  v_expected_version text;
  v_digest text;
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_to_operator is null or p_to_operator = auth.uid() then
    raise exception 'Handoff recipient must be another operator';
  end if;
  if not exists (
    select 1 from public.internal_operator_access access
    where access.user_id = p_to_operator
      and (access.expires_at is null or access.expires_at > now())
      and 'graph_manage' = any(access.capabilities)
  ) then
    raise exception 'Recipient is not an active graph-management operator';
  end if;

  select * into v_case
  from public.internal_graph_cases c
  where c.id = p_case_id and c.expires_at > now() and c.status <> 'archived';
  if v_case.id is null then raise exception 'Case is not active for handoff'; end if;

  if not public.internal_handoff_text_safe(p_summary)
     or not public.internal_handoff_text_safe(p_next_question) then
    raise exception 'Handoff text must not contain direct email addresses or external URLs';
  end if;
  if char_length(trim(p_summary)) < 12 or char_length(trim(p_summary)) > 900
     or char_length(trim(p_next_question)) < 8 or char_length(trim(p_next_question)) > 700 then
    raise exception 'Handoff summary/question exceeds bounded text limits';
  end if;
  if p_perspective_fingerprint is not null and char_length(p_perspective_fingerprint) > 120 then
    raise exception 'Perspective fingerprint is too long';
  end if;
  if p_perspective_title is not null and char_length(p_perspective_title) > 100 then
    raise exception 'Perspective title is too long';
  end if;
  if p_evidence_summary is null or jsonb_typeof(p_evidence_summary) <> 'object'
     or pg_column_size(p_evidence_summary) > 8192 then
    raise exception 'Handoff evidence summary must be a bounded object';
  end if;

  v_graph := public.get_internal_intelligence_graph(v_case.scope_event_id, false, 2000);
  v_raw_version := coalesce(v_graph->>'graphVersion', '');
  v_alias_version := public.internal_graph_entity_alias_version();
  if exists (select 1 from public.internal_graph_entity_aliases where expires_at > now()) then
    v_expected_version := v_raw_version || ':canon:' || left(v_alias_version, 12);
  else
    v_expected_version := v_raw_version;
  end if;
  if p_graph_version <> v_expected_version then
    raise exception 'Handoff graph version is stale';
  end if;

  v_digest := encode(digest(p_evidence_summary::text, 'sha256'), 'hex');

  insert into public.internal_graph_case_handoffs(
    case_id, from_operator, to_operator, graph_version,
    perspective_fingerprint, perspective_title, evidence_digest,
    summary, next_question
  ) values (
    p_case_id, auth.uid(), p_to_operator, p_graph_version,
    nullif(trim(p_perspective_fingerprint), ''), nullif(trim(p_perspective_title), ''), v_digest,
    trim(p_summary), trim(p_next_question)
  ) returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_case_handoff_created', v_case.scope_event_id,
    jsonb_build_object('handoffId', v_id, 'caseId', p_case_id, 'toOperator', p_to_operator, 'evidenceDigest', v_digest)
  );

  return v_id;
end;
$$;
revoke all on function public.create_internal_graph_case_handoff(uuid, uuid, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_internal_graph_case_handoff(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;

create or replace function public.get_internal_graph_case_handoffs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'caseId', h.case_id,
        'caseTitle', c.title,
        'fromOperatorId', h.from_operator,
        'fromOperatorLabel', coalesce(nullif(trim(fu.name), ''), case when h.from_operator is null then 'Deleted operator' else 'Operator ' || left(h.from_operator::text, 8) end),
        'toOperatorId', h.to_operator,
        'toOperatorLabel', coalesce(nullif(trim(tu.name), ''), 'Operator ' || left(h.to_operator::text, 8)),
        'graphVersion', h.graph_version,
        'perspectiveFingerprint', h.perspective_fingerprint,
        'perspectiveTitle', h.perspective_title,
        'evidenceDigest', h.evidence_digest,
        'summary', h.summary,
        'nextQuestion', h.next_question,
        'status', h.status,
        'createdAt', h.created_at,
        'acceptedAt', h.accepted_at,
        'resolvedAt', h.resolved_at,
        'expiresAt', h.expires_at,
        'notes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', n.id,
            'authorId', n.author_id,
            'authorLabel', coalesce(nullif(trim(nu.name), ''), case when n.author_id is null then 'Deleted operator' else 'Operator ' || left(n.author_id::text, 8) end),
            'note', n.note,
            'createdAt', n.created_at
          ) order by n.created_at)
          from public.internal_graph_case_handoff_notes n
          left join public.users nu on nu.id = n.author_id
          where n.handoff_id = h.id
        ), '[]'::jsonb)
      ) order by h.created_at desc)
      from public.internal_graph_case_handoffs h
      join public.internal_graph_cases c on c.id = h.case_id
      left join public.users fu on fu.id = h.from_operator
      join public.users tu on tu.id = h.to_operator
      where h.expires_at > now()
        and (h.from_operator = auth.uid() or h.to_operator = auth.uid())
    ), '[]'::jsonb),
    'operatingRule', 'Handoffs transfer bounded analytical context between provisioned operators. They do not copy graph payloads or authorize social action.'
  );
end;
$$;
revoke all on function public.get_internal_graph_case_handoffs() from public;
grant execute on function public.get_internal_graph_case_handoffs() to authenticated;

create or replace function public.set_internal_graph_case_handoff_status(
  p_handoff_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.internal_graph_case_handoffs;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('accepted', 'declined', 'resolved', 'withdrawn') then
    raise exception 'Unsupported handoff status';
  end if;
  select * into v_handoff from public.internal_graph_case_handoffs h
  where h.id = p_handoff_id and h.expires_at > now();
  if v_handoff.id is null then raise exception 'Unknown or expired handoff'; end if;

  if p_status in ('accepted', 'declined') and v_handoff.to_operator <> auth.uid() then
    raise exception 'Only the recipient may accept or decline a handoff';
  end if;
  if p_status = 'withdrawn' and v_handoff.from_operator <> auth.uid() then
    raise exception 'Only the sender may withdraw a handoff';
  end if;
  if p_status = 'resolved' and auth.uid() not in (v_handoff.from_operator, v_handoff.to_operator) then
    raise exception 'Only a handoff participant may resolve it';
  end if;

  update public.internal_graph_case_handoffs
  set status = p_status,
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      resolved_at = case when p_status in ('resolved', 'declined', 'withdrawn') then now() else resolved_at end
  where id = p_handoff_id;

  return true;
end;
$$;
revoke all on function public.set_internal_graph_case_handoff_status(uuid, text) from public;
grant execute on function public.set_internal_graph_case_handoff_status(uuid, text) to authenticated;

create or replace function public.add_internal_graph_case_handoff_note(
  p_handoff_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.internal_graph_case_handoffs;
  v_id uuid;
  v_count integer;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_handoff from public.internal_graph_case_handoffs h
  where h.id = p_handoff_id and h.expires_at > now();
  if v_handoff.id is null or auth.uid() not in (v_handoff.from_operator, v_handoff.to_operator) then
    raise exception 'Handoff is not available to current operator';
  end if;
  if not public.internal_handoff_text_safe(p_note) or char_length(trim(p_note)) > 600 then
    raise exception 'Handoff note must be bounded and contain no direct email address or external URL';
  end if;
  select count(*) into v_count from public.internal_graph_case_handoff_notes where handoff_id = p_handoff_id;
  if v_count >= 50 then raise exception 'Handoff note limit reached'; end if;

  insert into public.internal_graph_case_handoff_notes(handoff_id, author_id, note)
  values (p_handoff_id, auth.uid(), trim(p_note)) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_internal_graph_case_handoff_note(uuid, text) from public;
grant execute on function public.add_internal_graph_case_handoff_note(uuid, text) to authenticated;

create or replace function public.prune_internal_graph_case_handoffs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_case_handoffs where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_graph_case_handoffs() from public;
grant execute on function public.prune_internal_graph_case_handoffs() to service_role;

comment on table public.internal_graph_case_handoffs is
  'Bounded private operator-to-operator investigation handoff capsules. Evidence summaries are retained only as SHA-256 digests; graph payloads are not copied.';
