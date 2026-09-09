-- =============================================================================
-- 080_internal_decision_reproducibility_receipts.sql
-- Server-sealed reproducibility receipts for private operator hypotheses.
--
-- A receipt proves which canonical graph version + exact stored evidence refs +
-- bounded analytical-policy context were attached to a hypothesis at seal time.
-- It stores hashes/counts, never another graph payload or target query.
-- =============================================================================

create table if not exists public.internal_decision_reproducibility_receipts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.users(id) on delete cascade,
  journal_id uuid not null references public.internal_operator_decision_journal(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  graph_version text not null check (char_length(graph_version) between 8 and 240),
  evidence_ref_digest text not null check (char_length(evidence_ref_digest) = 64),
  evidence_ref_count integer not null check (evidence_ref_count between 0 and 64),
  policy_version text not null check (char_length(policy_version) between 3 and 80),
  lens_fingerprint text check (lens_fingerprint is null or char_length(lens_fingerprint) between 3 and 160),
  admission_state text not null check (admission_state in ('admitted_to_review','review_with_caution','evidence_remediation_required','capability_required','safety_blocked')),
  admission_authority numeric(6,5) not null check (admission_authority between 0 and 1),
  calibration_penalty numeric(6,5) not null default 0 check (calibration_penalty between 0 and 0.45),
  temporal_overlap numeric(6,5) check (temporal_overlap is null or temporal_overlap between 0 and 1),
  route_diversity numeric(6,5) check (route_diversity is null or route_diversity between 0 and 1),
  route_count integer not null default 0 check (route_count between 0 and 32),
  receipt_digest text not null check (char_length(receipt_digest) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  unique(operator_id, journal_id, receipt_digest)
);

create index if not exists idx_internal_decision_receipts_operator
  on public.internal_decision_reproducibility_receipts(operator_id, created_at desc);

alter table public.internal_decision_reproducibility_receipts enable row level security;
revoke all on table public.internal_decision_reproducibility_receipts from public, anon, authenticated;

create or replace function public.internal_decision_receipt_context_valid(p_context jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(coalesce(p_context, '{}'::jsonb)) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(coalesce(p_context, '{}'::jsonb)) key
      where key not in ('policyVersion','lensFingerprint','calibrationPenalty','temporalOverlap','routeDiversity','routeCount')
    )
    and pg_column_size(coalesce(p_context, '{}'::jsonb)) <= 2048;
$$;
revoke all on function public.internal_decision_receipt_context_valid(jsonb) from public;

create or replace function public.seal_internal_decision_reproducibility_receipt(
  p_journal_id uuid,
  p_graph_version text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal public.internal_operator_decision_journal;
  v_expected text;
  v_refs text;
  v_ref_digest text;
  v_ref_count integer;
  v_policy text;
  v_lens text;
  v_calibration numeric;
  v_temporal numeric;
  v_diversity numeric;
  v_route_count integer;
  v_receipt_digest text;
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if not public.internal_decision_receipt_context_valid(p_context) then
    raise exception 'Decision receipt context violates bounded allowlist';
  end if;

  select * into v_journal
  from public.internal_operator_decision_journal j
  where j.id = p_journal_id
    and j.operator_id = auth.uid()
    and j.expires_at > now();
  if v_journal.id is null then raise exception 'Operator hypothesis not found'; end if;

  v_expected := public.internal_current_canonical_graph_version(v_journal.event_id);
  if p_graph_version <> v_journal.graph_version or p_graph_version <> v_expected then
    raise exception 'Cannot seal reproducibility receipt against a stale canonical graph version';
  end if;

  select coalesce(string_agg(refs.edge_id, '|' order by refs.edge_id), ''), count(*)::integer
  into v_refs, v_ref_count
  from public.internal_operator_decision_evidence_refs refs
  where refs.journal_id = v_journal.id and refs.operator_id = auth.uid();
  if v_ref_count > 64 then raise exception 'Decision evidence reference boundary exceeded'; end if;
  v_ref_digest := encode(digest(convert_to(v_refs, 'utf8'), 'sha256'), 'hex');

  v_policy := nullif(trim(coalesce(p_context->>'policyVersion', '')), '');
  if v_policy is null or char_length(v_policy) > 80 then raise exception 'Policy version required'; end if;
  v_lens := nullif(trim(coalesce(p_context->>'lensFingerprint', '')), '');
  if v_lens is not null and char_length(v_lens) > 160 then raise exception 'Lens fingerprint too long'; end if;
  v_calibration := least(0.45, greatest(0, coalesce((p_context->>'calibrationPenalty')::numeric, 0)));
  v_temporal := case when p_context ? 'temporalOverlap' then least(1, greatest(0, (p_context->>'temporalOverlap')::numeric)) else null end;
  v_diversity := case when p_context ? 'routeDiversity' then least(1, greatest(0, (p_context->>'routeDiversity')::numeric)) else null end;
  v_route_count := least(32, greatest(0, coalesce((p_context->>'routeCount')::integer, 0)));

  v_receipt_digest := encode(digest(convert_to(
    v_journal.id::text || '|' || p_graph_version || '|' || v_ref_digest || '|' || v_policy || '|' ||
    coalesce(v_lens, '-') || '|' || v_journal.admission_state || '|' || v_journal.admission_authority::text || '|' ||
    v_calibration::text || '|' || coalesce(v_temporal::text, '-') || '|' || coalesce(v_diversity::text, '-') || '|' || v_route_count::text,
    'utf8'), 'sha256'), 'hex');

  insert into public.internal_decision_reproducibility_receipts(
    operator_id, journal_id, event_id, graph_version, evidence_ref_digest,
    evidence_ref_count, policy_version, lens_fingerprint, admission_state,
    admission_authority, calibration_penalty, temporal_overlap, route_diversity,
    route_count, receipt_digest, expires_at
  ) values (
    auth.uid(), v_journal.id, v_journal.event_id, p_graph_version, v_ref_digest,
    v_ref_count, v_policy, v_lens, v_journal.admission_state,
    v_journal.admission_authority, v_calibration, v_temporal, v_diversity,
    v_route_count, v_receipt_digest, least(v_journal.expires_at, now() + interval '180 days')
  ) on conflict (operator_id, journal_id, receipt_digest) do update set expires_at = greatest(public.internal_decision_reproducibility_receipts.expires_at, excluded.expires_at)
  returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (auth.uid(), 'decision_reproducibility_receipt_sealed', v_journal.event_id,
          jsonb_build_object('journalId', v_journal.id, 'receiptId', v_id, 'graphVersion', p_graph_version, 'refCount', v_ref_count, 'policyVersion', v_policy));

  return jsonb_build_object(
    'id', v_id,
    'journalId', v_journal.id,
    'graphVersion', p_graph_version,
    'evidenceRefDigest', v_ref_digest,
    'evidenceRefCount', v_ref_count,
    'receiptDigest', v_receipt_digest,
    'createdAt', now(),
    'operatingRule', 'A reproducibility receipt hashes the canonical graph version, exact stored evidence refs and bounded analytical-policy context. It does not copy graph evidence or certify the hypothesis as true.'
  );
end;
$$;
revoke all on function public.seal_internal_decision_reproducibility_receipt(uuid, text, jsonb) from public;
grant execute on function public.seal_internal_decision_reproducibility_receipt(uuid, text, jsonb) to authenticated;

create or replace function public.get_internal_decision_reproducibility_receipts(
  p_event_id uuid default null,
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
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'journalId', r.journal_id, 'eventId', r.event_id,
    'graphVersion', r.graph_version, 'evidenceRefDigest', r.evidence_ref_digest,
    'evidenceRefCount', r.evidence_ref_count, 'policyVersion', r.policy_version,
    'lensFingerprint', r.lens_fingerprint, 'admissionState', r.admission_state,
    'admissionAuthority', r.admission_authority, 'calibrationPenalty', r.calibration_penalty,
    'temporalOverlap', r.temporal_overlap, 'routeDiversity', r.route_diversity,
    'routeCount', r.route_count, 'receiptDigest', r.receipt_digest,
    'createdAt', r.created_at, 'expiresAt', r.expires_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.internal_decision_reproducibility_receipts receipt
    where receipt.operator_id = auth.uid()
      and receipt.expires_at > now()
      and (p_event_id is null or receipt.event_id = p_event_id)
    order by receipt.created_at desc
    limit least(800, greatest(1, coalesce(p_limit, 240)))
  ) r;
  return jsonb_build_object('generatedAt', now(), 'receipts', v_rows,
    'operatingRule', 'Receipts retain digests and bounded analytical context only; no graph payload or target query is stored.');
end;
$$;
revoke all on function public.get_internal_decision_reproducibility_receipts(uuid, integer) from public;
grant execute on function public.get_internal_decision_reproducibility_receipts(uuid, integer) to authenticated;

create or replace function public.compare_internal_decision_reproducibility_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_receipt public.internal_decision_reproducibility_receipts;
  v_current_version text;
  v_refs text;
  v_current_ref_digest text;
  v_current_ref_count integer;
  v_graph jsonb;
  v_live_ref_count integer;
  v_open_conflict_count integer;
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  select * into v_receipt from public.internal_decision_reproducibility_receipts r
  where r.id = p_receipt_id and r.operator_id = auth.uid() and r.expires_at > now();
  if v_receipt.id is null then raise exception 'Reproducibility receipt not found'; end if;

  v_current_version := public.internal_current_canonical_graph_version(v_receipt.event_id);
  select coalesce(string_agg(refs.edge_id, '|' order by refs.edge_id), ''), count(*)::integer
  into v_refs, v_current_ref_count
  from public.internal_operator_decision_evidence_refs refs
  where refs.journal_id = v_receipt.journal_id and refs.operator_id = auth.uid();
  v_current_ref_digest := encode(digest(convert_to(v_refs, 'utf8'), 'sha256'), 'hex');

  v_graph := public.get_internal_intelligence_graph(v_receipt.event_id, false, 2000);
  select count(*)::integer into v_live_ref_count
  from public.internal_operator_decision_evidence_refs refs
  where refs.journal_id = v_receipt.journal_id and refs.operator_id = auth.uid()
    and exists (select 1 from jsonb_array_elements(coalesce(v_graph->'edges','[]'::jsonb)) edge where edge->>'id' = refs.edge_id);

  select count(distinct conflict.id)::integer into v_open_conflict_count
  from public.internal_graph_evidence_conflicts conflict
  join public.internal_operator_decision_evidence_refs refs
    on refs.journal_id = v_receipt.journal_id
   and refs.operator_id = auth.uid()
   and refs.edge_id in (conflict.left_edge_id, conflict.right_edge_id)
  where conflict.operator_id = auth.uid() and conflict.status = 'open' and conflict.expires_at > now();

  return jsonb_build_object(
    'receiptId', v_receipt.id,
    'journalId', v_receipt.journal_id,
    'sealedGraphVersion', v_receipt.graph_version,
    'currentGraphVersion', v_current_version,
    'sameGraphVersion', v_receipt.graph_version = v_current_version,
    'sameEvidenceRefDigest', v_receipt.evidence_ref_digest = v_current_ref_digest,
    'sealedRefCount', v_receipt.evidence_ref_count,
    'currentRefCount', v_current_ref_count,
    'liveRefCount', v_live_ref_count,
    'orphanedRefCount', greatest(0, v_current_ref_count - v_live_ref_count),
    'openConflictCount', coalesce(v_open_conflict_count, 0),
    'reproducibleNow', v_receipt.graph_version = v_current_version
      and v_receipt.evidence_ref_digest = v_current_ref_digest
      and v_current_ref_count = v_live_ref_count
      and coalesce(v_open_conflict_count, 0) = 0,
    'operatingRule', 'Reproducible now means the same canonical graph version and exact dependency set remain present with no open confirmed conflict intersection. It does not certify the analytical conclusion as true.'
  );
end;
$$;
revoke all on function public.compare_internal_decision_reproducibility_receipt(uuid) from public;
grant execute on function public.compare_internal_decision_reproducibility_receipt(uuid) to authenticated;

create or replace function public.prune_internal_decision_reproducibility_receipts(p_before timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_decision_reproducibility_receipts where expires_at <= p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_decision_reproducibility_receipts(timestamptz) from public;
grant execute on function public.prune_internal_decision_reproducibility_receipts(timestamptz) to service_role;

comment on table public.internal_decision_reproducibility_receipts is
  'Bounded server-sealed analytical reproducibility receipts. Stores hashes/counts/policy context rather than graph payloads or target queries; reproducibility is not truth certification.';
