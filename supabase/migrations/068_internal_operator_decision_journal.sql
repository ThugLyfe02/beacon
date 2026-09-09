-- =============================================================================
-- 068_internal_operator_decision_journal.sql
-- Private operator assumption / decision journal for compounding calibration.
--
-- The journal records bounded hypotheses about graph conditions and the evidence
-- state that justified operator review. It is NOT a person watchlist: there is no
-- person-node column, contact identifier, movement field, or autonomous action.
-- Evidence summaries are digested server-side and not persisted as graph payloads.
-- =============================================================================

create table if not exists public.internal_operator_decision_journal (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  decision_kind text not null check (decision_kind in (
    'analysis_review', 'target_route_review', 'intervention_review',
    'restricted_forensics_review', 'portable_export_review'
  )),
  title text not null check (char_length(trim(title)) between 3 and 120),
  hypothesis text not null check (char_length(trim(hypothesis)) between 20 and 800),
  disconfirming_condition text not null check (char_length(trim(disconfirming_condition)) between 12 and 600),
  graph_version text not null check (char_length(graph_version) between 8 and 160),
  admission_state text not null check (admission_state in (
    'admitted_to_review', 'review_with_caution', 'evidence_remediation_required',
    'capability_required', 'safety_blocked'
  )),
  admission_authority numeric(6,5) not null check (admission_authority between 0 and 1),
  evidence_digest text not null check (char_length(evidence_digest) = 64),
  status text not null default 'open' check (status in (
    'open', 'supported', 'weakened', 'invalidated', 'closed'
  )),
  conclusion_note text check (conclusion_note is null or char_length(trim(conclusion_note)) between 3 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '120 days'),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '180 days')
);
create index if not exists internal_operator_decision_journal_owner_idx
  on public.internal_operator_decision_journal(operator_id, status, updated_at desc);
create index if not exists internal_operator_decision_journal_event_idx
  on public.internal_operator_decision_journal(operator_id, event_id, updated_at desc);

alter table public.internal_operator_decision_journal enable row level security;
revoke all on table public.internal_operator_decision_journal from anon, authenticated;

create or replace function public.save_internal_operator_decision_journal(
  p_event_id uuid,
  p_decision_kind text,
  p_title text,
  p_hypothesis text,
  p_disconfirming_condition text,
  p_graph_version text,
  p_admission_state text,
  p_admission_authority numeric,
  p_evidence_summary jsonb,
  p_ttl_days integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_digest text;
  v_ttl integer := coalesce(p_ttl_days, 120);
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Unknown event scope';
  end if;
  if p_decision_kind not in (
    'analysis_review', 'target_route_review', 'intervention_review',
    'restricted_forensics_review', 'portable_export_review'
  ) then raise exception 'Unsupported decision kind'; end if;
  if p_admission_state not in (
    'admitted_to_review', 'review_with_caution', 'evidence_remediation_required',
    'capability_required', 'safety_blocked'
  ) then raise exception 'Unsupported admission state'; end if;
  if p_admission_authority is null or p_admission_authority < 0 or p_admission_authority > 1 then
    raise exception 'Admission authority must be between zero and one';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) not between 3 and 120 then
    raise exception 'Decision title must be between 3 and 120 characters';
  end if;
  if nullif(trim(p_hypothesis), '') is null or char_length(trim(p_hypothesis)) not between 20 and 800 then
    raise exception 'Hypothesis must be between 20 and 800 characters';
  end if;
  if nullif(trim(p_disconfirming_condition), '') is null or char_length(trim(p_disconfirming_condition)) not between 12 and 600 then
    raise exception 'Disconfirming condition must be between 12 and 600 characters';
  end if;
  if nullif(trim(p_graph_version), '') is null or char_length(trim(p_graph_version)) not between 8 and 160 then
    raise exception 'Graph version is invalid';
  end if;
  if p_evidence_summary is null or jsonb_typeof(p_evidence_summary) <> 'object' then
    raise exception 'Bounded evidence summary is required';
  end if;
  if pg_column_size(p_evidence_summary) > 8192 then
    raise exception 'Evidence summary exceeds 8KB digest boundary';
  end if;
  if v_ttl < 7 or v_ttl > 180 then
    raise exception 'Decision journal TTL must be between 7 and 180 days';
  end if;

  v_digest := encode(digest(p_evidence_summary::text, 'sha256'), 'hex');

  insert into public.internal_operator_decision_journal(
    operator_id, event_id, decision_kind, title, hypothesis, disconfirming_condition,
    graph_version, admission_state, admission_authority, evidence_digest, expires_at
  ) values (
    auth.uid(), p_event_id, p_decision_kind, trim(p_title), trim(p_hypothesis),
    trim(p_disconfirming_condition), trim(p_graph_version), p_admission_state,
    p_admission_authority, v_digest, now() + make_interval(days => v_ttl)
  ) returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'decision_journal_saved', p_event_id,
    jsonb_build_object(
      'journalId', v_id,
      'decisionKind', p_decision_kind,
      'admissionState', p_admission_state,
      'evidenceDigest', v_digest,
      'graphVersion', p_graph_version
    )
  );

  return jsonb_build_object('id', v_id, 'evidenceDigest', v_digest, 'createdAt', now());
end;
$$;
revoke all on function public.save_internal_operator_decision_journal(uuid, text, text, text, text, text, text, numeric, jsonb, integer) from public;
grant execute on function public.save_internal_operator_decision_journal(uuid, text, text, text, text, text, text, numeric, jsonb, integer) to authenticated;

create or replace function public.get_internal_operator_decision_journal(
  p_event_id uuid default null,
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id,
    'eventId', entry.event_id,
    'decisionKind', entry.decision_kind,
    'title', entry.title,
    'hypothesis', entry.hypothesis,
    'disconfirmingCondition', entry.disconfirming_condition,
    'graphVersion', entry.graph_version,
    'admissionState', entry.admission_state,
    'admissionAuthority', entry.admission_authority,
    'evidenceDigest', entry.evidence_digest,
    'status', entry.status,
    'conclusionNote', entry.conclusion_note,
    'createdAt', entry.created_at,
    'updatedAt', entry.updated_at,
    'resolvedAt', entry.resolved_at,
    'expiresAt', entry.expires_at
  ) order by entry.updated_at desc), '[]'::jsonb)
  into v_rows
  from (
    select *
    from public.internal_operator_decision_journal
    where operator_id = auth.uid()
      and expires_at > now()
      and (p_event_id is null or event_id = p_event_id)
    order by updated_at desc
    limit least(250, greatest(1, coalesce(p_limit, 120)))
  ) entry;

  return jsonb_build_object(
    'generatedAt', now(),
    'entries', v_rows,
    'operatingRule', 'Decision Journal records operator hypotheses about graph evidence and review posture. It is not a person watchlist and it never executes decisions.'
  );
end;
$$;
revoke all on function public.get_internal_operator_decision_journal(uuid, integer) from public;
grant execute on function public.get_internal_operator_decision_journal(uuid, integer) to authenticated;

create or replace function public.resolve_internal_operator_decision_journal(
  p_journal_id uuid,
  p_status text,
  p_conclusion_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('supported', 'weakened', 'invalidated', 'closed') then
    raise exception 'Unsupported journal resolution status';
  end if;
  if nullif(trim(p_conclusion_note), '') is null or char_length(trim(p_conclusion_note)) not between 3 and 600 then
    raise exception 'Conclusion note must be between 3 and 600 characters';
  end if;

  update public.internal_operator_decision_journal entry
  set status = p_status,
      conclusion_note = trim(p_conclusion_note),
      resolved_at = now(),
      updated_at = now()
  where entry.id = p_journal_id
    and entry.operator_id = auth.uid()
    and entry.expires_at > now()
  returning event_id into v_event_id;

  if not found then raise exception 'Decision journal entry not found'; end if;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'decision_journal_resolved', v_event_id,
    jsonb_build_object('journalId', p_journal_id, 'status', p_status)
  );
  return true;
end;
$$;
revoke all on function public.resolve_internal_operator_decision_journal(uuid, text, text) from public;
grant execute on function public.resolve_internal_operator_decision_journal(uuid, text, text) to authenticated;

create or replace function public.prune_internal_operator_decision_journal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_operator_decision_journal where expires_at <= now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('prunedEntries', v_count, 'prunedAt', now());
end;
$$;
revoke all on function public.prune_internal_operator_decision_journal() from public;
grant execute on function public.prune_internal_operator_decision_journal() to service_role;

comment on table public.internal_operator_decision_journal is
  'Private operator hypothesis ledger for graph-condition calibration. No person target column, contact identifier, movement field, or action executor exists.';
comment on function public.save_internal_operator_decision_journal(uuid, text, text, text, text, text, text, numeric, jsonb, integer) is
  'Stores bounded operator hypothesis metadata while retaining only a SHA-256 digest of the supplied evidence summary.';
