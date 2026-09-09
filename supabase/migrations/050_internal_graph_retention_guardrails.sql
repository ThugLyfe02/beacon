-- =============================================================================
-- 050_internal_graph_retention_guardrails.sql
-- Bounded retention and maintenance for Beacon's operator-only intelligence graph.
--
-- The graph is allowed to compound; it is not allowed to become an immortal
-- person dossier. Source systems remain authoritative, person aliases remain
-- erasable, and expired graph material is pruned only by a trusted service role.
-- =============================================================================

create or replace function public.prune_internal_graph_memory()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assertions integer := 0;
  v_bridge_watches integer := 0;
  v_edges integer := 0;
  v_nodes integer := 0;
  v_audit integer := 0;
  v_operator_grants integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  -- Assertions are deleted first so their cleanup trigger can remove assertion
  -- edges before generic edge/node expiry runs.
  delete from public.internal_graph_assertions
  where expires_at <= now();
  get diagnostics v_assertions = row_count;

  -- Bridge watches are observational calibration material, not permanent
  -- relationship labels. Their own bounded expiry is authoritative.
  delete from public.internal_graph_bridge_watches
  where expires_at <= now();
  get diagnostics v_bridge_watches = row_count;

  delete from public.internal_graph_edge_memory
  where expires_at <= now();
  get diagnostics v_edges = row_count;

  -- Expired nodes are removed only when no retained edge still references them.
  delete from public.internal_graph_node_memory n
  where n.expires_at <= now()
    and not exists (
      select 1
      from public.internal_graph_edge_memory e
      where e.source_key = n.node_key or e.target_key = n.node_key
    );
  get diagnostics v_nodes = row_count;

  -- Operator audit history is useful for accountability but should not grow
  -- without bound. One year preserves reviewability without indefinite storage.
  delete from public.internal_graph_audit_log
  where created_at < now() - interval '365 days';
  get diagnostics v_audit = row_count;

  -- Expired operator grants should disappear rather than remain dormant rows.
  delete from public.internal_operator_access
  where expires_at is not null and expires_at <= now();
  get diagnostics v_operator_grants = row_count;

  return jsonb_build_object(
    'prunedAt', now(),
    'assertions', v_assertions,
    'bridgeWatches', v_bridge_watches,
    'edges', v_edges,
    'nodes', v_nodes,
    'auditRows', v_audit,
    'operatorGrants', v_operator_grants
  );
end;
$$;

revoke all on function public.prune_internal_graph_memory() from public;
grant execute on function public.prune_internal_graph_memory() to service_role;

comment on function public.prune_internal_graph_memory() is
  'Service-only bounded retention for Constellation graph memory, bridge calibration, operator audit history, and expired access grants.';
