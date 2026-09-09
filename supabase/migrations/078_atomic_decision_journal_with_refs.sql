-- =============================================================================
-- 078_atomic_decision_journal_with_refs.sql
-- Atomically seal a falsifiable hypothesis and its exact evidence dependencies.
--
-- Route/intervention hypotheses should never exist in a half-recorded state where
-- the journal row committed but the supporting edge references failed. This RPC
-- composes the already-hardened journal + ref functions in one database transaction.
-- =============================================================================

create or replace function public.save_internal_operator_decision_journal_with_refs(
  p_event_id uuid,
  p_decision_kind text,
  p_title text,
  p_hypothesis text,
  p_disconfirming_condition text,
  p_graph_version text,
  p_admission_state text,
  p_admission_authority numeric,
  p_evidence_summary jsonb,
  p_edge_ids text[] default '{}'::text[],
  p_ref_kind text default 'route_portfolio',
  p_ttl_days integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved jsonb;
  v_journal_id uuid;
  v_reference_count integer := 0;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  v_saved := public.save_internal_operator_decision_journal(
    p_event_id,
    p_decision_kind,
    p_title,
    p_hypothesis,
    p_disconfirming_condition,
    p_graph_version,
    p_admission_state,
    p_admission_authority,
    p_evidence_summary,
    p_ttl_days
  );
  v_journal_id := (v_saved->>'id')::uuid;

  if coalesce(array_length(p_edge_ids, 1), 0) > 0 then
    v_reference_count := public.record_internal_operator_decision_evidence_refs(
      v_journal_id,
      p_graph_version,
      p_edge_ids,
      p_ref_kind
    );
  end if;

  return v_saved || jsonb_build_object('referenceCount', v_reference_count);
end;
$$;

revoke all on function public.save_internal_operator_decision_journal_with_refs(
  uuid, text, text, text, text, text, text, numeric, jsonb, text[], text, integer
) from public;
grant execute on function public.save_internal_operator_decision_journal_with_refs(
  uuid, text, text, text, text, text, text, numeric, jsonb, text[], text, integer
) to authenticated;

comment on function public.save_internal_operator_decision_journal_with_refs(
  uuid, text, text, text, text, text, text, numeric, jsonb, text[], text, integer
) is 'Atomically seals a private falsifiable operator hypothesis and exact evidence-edge dependencies. Failure in dependency validation rolls back the journal insert.';
