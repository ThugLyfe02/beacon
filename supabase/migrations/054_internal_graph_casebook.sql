-- =============================================================================
-- 054_internal_graph_casebook.sql
-- Persistent operator investigations/watchlists over Beacon-owned graph evidence.
--
-- Person pins reference erasable graph aliases by FK. Cases may survive an
-- account deletion, but that person's pin disappears automatically.
-- =============================================================================

create type public.internal_graph_case_status as enum ('active', 'paused', 'archived');

create table if not exists public.internal_graph_cases (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  objective text check (objective is null or char_length(objective) <= 600),
  target_query text check (target_query is null or char_length(target_query) <= 160),
  scope_event_id uuid references public.events(id) on delete set null,
  status public.internal_graph_case_status not null default 'active',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_evaluated_at timestamptz,
  expires_at timestamptz not null default (now() + interval '365 days')
);
create index if not exists internal_graph_cases_status_idx
  on public.internal_graph_cases(status, updated_at desc);

create table if not exists public.internal_graph_case_pins (
  case_id uuid not null references public.internal_graph_cases(id) on delete cascade,
  subject_alias uuid references public.internal_graph_subject_aliases(alias) on delete cascade,
  entity_node_key text,
  label_snapshot text not null check (char_length(label_snapshot) between 1 and 160),
  kind_snapshot text not null check (char_length(kind_snapshot) between 1 and 60),
  note text check (note is null or char_length(note) <= 500),
  pinned_by uuid references public.users(id) on delete set null,
  pinned_at timestamptz not null default now(),
  check ((subject_alias is not null)::integer + (entity_node_key is not null)::integer = 1),
  check (entity_node_key is null or char_length(entity_node_key) between 3 and 220)
);
create unique index if not exists internal_graph_case_person_pin_unique
  on public.internal_graph_case_pins(case_id, subject_alias)
  where subject_alias is not null;
create unique index if not exists internal_graph_case_entity_pin_unique
  on public.internal_graph_case_pins(case_id, entity_node_key)
  where entity_node_key is not null;

create table if not exists public.internal_graph_case_findings (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.internal_graph_cases(id) on delete cascade,
  finding_key text not null check (char_length(finding_key) between 1 and 120),
  finding_class text not null check (finding_class in (
    'path', 'broker', 'bridge', 'drift', 'motif', 'fragility', 'ecosystem_gap'
  )),
  summary text not null check (char_length(summary) between 1 and 600),
  evidence jsonb not null default '{}'::jsonb,
  score numeric(12,6) not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  unique(case_id, finding_key)
);

alter table public.internal_graph_cases enable row level security;
alter table public.internal_graph_case_pins enable row level security;
alter table public.internal_graph_case_findings enable row level security;
revoke all on table public.internal_graph_cases from anon, authenticated;
revoke all on table public.internal_graph_case_pins from anon, authenticated;
revoke all on table public.internal_graph_case_findings from anon, authenticated;

create or replace function public.create_internal_graph_case(
  p_title text,
  p_objective text default null,
  p_target_query text default null,
  p_scope_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 120 then
    raise exception 'Case title must be between 1 and 120 characters';
  end if;
  if p_scope_event_id is not null and not exists (select 1 from public.events where id = p_scope_event_id) then
    raise exception 'Unknown event scope';
  end if;

  insert into public.internal_graph_cases(title, objective, target_query, scope_event_id, created_by)
  values (
    trim(p_title),
    nullif(trim(p_objective), ''),
    nullif(trim(p_target_query), ''),
    p_scope_event_id,
    auth.uid()
  ) returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (auth.uid(), 'graph_case_created', p_scope_event_id, jsonb_build_object('caseId', v_id));
  return v_id;
end;
$$;
revoke all on function public.create_internal_graph_case(text, text, text, uuid) from public;
grant execute on function public.create_internal_graph_case(text, text, text, uuid) to authenticated;

create or replace function public.pin_internal_graph_case_node(
  p_case_id uuid,
  p_node_key text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.internal_graph_cases;
  v_node public.internal_graph_node_memory;
  v_alias uuid;
  v_label text;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  select * into v_case from public.internal_graph_cases where id = p_case_id and expires_at > now();
  if v_case.id is null then raise exception 'Unknown or expired case'; end if;

  select * into v_node from public.internal_graph_node_memory
  where node_key = p_node_key and expires_at > now();
  if v_node.node_key is null then raise exception 'Node is not present in retained graph memory'; end if;

  v_label := left(coalesce(nullif(v_node.attributes->>'label', ''), v_node.kind), 160);
  if p_node_key like 'person:%' then
    begin
      v_alias := substring(p_node_key from 8)::uuid;
    exception when invalid_text_representation then
      raise exception 'Malformed person graph alias';
    end;
    if not exists (select 1 from public.internal_graph_subject_aliases a where a.alias = v_alias) then
      raise exception 'Unknown person graph alias';
    end if;
    insert into public.internal_graph_case_pins(
      case_id, subject_alias, label_snapshot, kind_snapshot, note, pinned_by
    ) values (
      p_case_id, v_alias, v_label, v_node.kind, nullif(trim(p_note), ''), auth.uid()
    ) on conflict (case_id, subject_alias) where subject_alias is not null do update
      set note = excluded.note, label_snapshot = excluded.label_snapshot, kind_snapshot = excluded.kind_snapshot;
  else
    insert into public.internal_graph_case_pins(
      case_id, entity_node_key, label_snapshot, kind_snapshot, note, pinned_by
    ) values (
      p_case_id, p_node_key, v_label, v_node.kind, nullif(trim(p_note), ''), auth.uid()
    ) on conflict (case_id, entity_node_key) where entity_node_key is not null do update
      set note = excluded.note, label_snapshot = excluded.label_snapshot, kind_snapshot = excluded.kind_snapshot;
  end if;

  update public.internal_graph_cases set updated_at = now() where id = p_case_id;
  return true;
end;
$$;
revoke all on function public.pin_internal_graph_case_node(uuid, text, text) from public;
grant execute on function public.pin_internal_graph_case_node(uuid, text, text) to authenticated;

create or replace function public.set_internal_graph_case_status(
  p_case_id uuid,
  p_status public.internal_graph_case_status
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
  update public.internal_graph_cases
  set status = p_status, updated_at = now()
  where id = p_case_id and expires_at > now();
  if not found then raise exception 'Unknown or expired case'; end if;
  return true;
end;
$$;
revoke all on function public.set_internal_graph_case_status(uuid, public.internal_graph_case_status) from public;
grant execute on function public.set_internal_graph_case_status(uuid, public.internal_graph_case_status) to authenticated;

create or replace function public.upsert_internal_graph_case_finding(
  p_case_id uuid,
  p_finding_key text,
  p_finding_class text,
  p_summary text,
  p_score numeric,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_finding_class not in ('path', 'broker', 'bridge', 'drift', 'motif', 'fragility', 'ecosystem_gap') then
    raise exception 'Unsupported finding class';
  end if;
  if nullif(trim(p_finding_key), '') is null or char_length(trim(p_finding_key)) > 120 then
    raise exception 'Invalid finding key';
  end if;
  if nullif(trim(p_summary), '') is null or char_length(trim(p_summary)) > 600 then
    raise exception 'Invalid finding summary';
  end if;
  if not exists (
    select 1 from public.internal_graph_cases c
    where c.id = p_case_id and c.status <> 'archived' and c.expires_at > now()
  ) then raise exception 'Case is not active for findings'; end if;

  insert into public.internal_graph_case_findings(
    case_id, finding_key, finding_class, summary, evidence, score, expires_at
  ) values (
    p_case_id, trim(p_finding_key), p_finding_class, trim(p_summary),
    coalesce(p_evidence, '{}'::jsonb), coalesce(p_score, 0), now() + interval '180 days'
  ) on conflict(case_id, finding_key) do update set
    finding_class = excluded.finding_class,
    summary = excluded.summary,
    evidence = excluded.evidence,
    score = excluded.score,
    last_seen_at = now(),
    expires_at = greatest(public.internal_graph_case_findings.expires_at, excluded.expires_at)
  returning id into v_id;

  update public.internal_graph_cases set last_evaluated_at = now(), updated_at = now() where id = p_case_id;
  return v_id;
end;
$$;
revoke all on function public.upsert_internal_graph_case_finding(uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.upsert_internal_graph_case_finding(uuid, text, text, text, numeric, jsonb) to authenticated;

create or replace function public.get_internal_graph_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cases jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  select coalesce(jsonb_agg(case_payload order by updated_at desc), '[]'::jsonb)
  into v_cases
  from (
    select c.updated_at,
      jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'objective', c.objective,
        'targetQuery', c.target_query,
        'scopeEventId', c.scope_event_id,
        'status', c.status,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'lastEvaluatedAt', c.last_evaluated_at,
        'pins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'nodeId', case
              when p.subject_alias is not null then 'person:' || p.subject_alias::text
              else p.entity_node_key
            end,
            'label', p.label_snapshot,
            'kind', p.kind_snapshot,
            'note', p.note,
            'pinnedAt', p.pinned_at
          ) order by p.pinned_at)
          from public.internal_graph_case_pins p where p.case_id = c.id
        ), '[]'::jsonb),
        'findings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', f.id,
            'key', f.finding_key,
            'class', f.finding_class,
            'summary', f.summary,
            'score', f.score,
            'firstSeenAt', f.first_seen_at,
            'lastSeenAt', f.last_seen_at
          ) order by f.score desc, f.last_seen_at desc)
          from public.internal_graph_case_findings f
          where f.case_id = c.id and f.expires_at > now()
        ), '[]'::jsonb)
      ) as case_payload
    from public.internal_graph_cases c
    where c.expires_at > now()
    order by c.updated_at desc
    limit 100
  ) rows;

  return jsonb_build_object('generatedAt', now(), 'cases', v_cases);
end;
$$;
revoke all on function public.get_internal_graph_cases() from public;
grant execute on function public.get_internal_graph_cases() to authenticated;

create or replace function public.prune_internal_graph_cases()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_findings integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_case_findings where expires_at <= now();
  get diagnostics v_findings = row_count;
  delete from public.internal_graph_cases where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted + v_findings;
end;
$$;
revoke all on function public.prune_internal_graph_cases() from public;
grant execute on function public.prune_internal_graph_cases() to service_role;

comment on table public.internal_graph_cases is
  'Bounded operator-only saved investigations. Analysis agents may update internal findings, but cases never authorize outreach or relationship mutation.';
