-- =============================================================================
-- 057_internal_agent_mission_reconciliation_metrics.sql
-- Makes Mission Ledger reconciliation telemetry semantically exact without
-- rewriting the already-landed 056 migration.
-- =============================================================================

create or replace function public.sync_internal_agent_missions_v2(
  p_event_id uuid,
  p_objective text,
  p_graph_version text,
  p_missions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_digest text;
  v_scope_key text;
  v_newly_resolved integer := 0;
  v_transaction_time timestamptz := now();
begin
  -- The v1 function owns validation, server graph re-derivation, persistence,
  -- miss damping, erasure semantics and audit behavior. This wrapper only fixes
  -- reconciliation telemetry: v1's historical resolvedCandidateCount represented
  -- every absent row touched by the miss update, not only rows that became
  -- resolved during this reconciliation.
  v_result := public.sync_internal_agent_missions(
    p_event_id,
    p_objective,
    p_graph_version,
    p_missions
  );

  v_digest := encode(digest(lower(trim(coalesce(p_objective, ''))), 'sha256'), 'hex');
  v_scope_key := coalesce(p_event_id::text, 'global') || '|objective:' || v_digest;

  select count(*)::integer
  into v_newly_resolved
  from public.internal_graph_agent_missions mission
  where mission.scope_key = v_scope_key
    and mission.status = 'resolved'
    and mission.resolved_at = v_transaction_time;

  return (v_result - 'resolvedCandidateCount') || jsonb_build_object(
    'newlyResolvedCount', v_newly_resolved
  );
end;
$$;
revoke all on function public.sync_internal_agent_missions_v2(uuid, text, text, jsonb) from public;
grant execute on function public.sync_internal_agent_missions_v2(uuid, text, text, jsonb) to authenticated;

comment on function public.sync_internal_agent_missions_v2(uuid, text, text, jsonb) is
  'Exact Mission Ledger reconciliation telemetry wrapper. Newly resolved counts include only missions whose two-miss damping threshold was crossed in the current transaction.';
