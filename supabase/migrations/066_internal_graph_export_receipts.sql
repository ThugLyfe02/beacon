-- =============================================================================
-- 066_internal_graph_export_receipts.sql
-- Audit portable Constellation exports without retaining another graph copy.
-- =============================================================================

create or replace function public.record_internal_graph_export_receipt(
  p_event_id uuid,
  p_graph_version text,
  p_format text,
  p_person_mode text,
  p_restricted boolean,
  p_node_count integer,
  p_edge_count integer,
  p_bytes integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary jsonb;
  v_expected_version text;
  v_audit_id bigint;
begin
  if not public.has_internal_operator_capability('graph_export') then
    raise exception 'Internal graph export capability required';
  end if;
  if coalesce(p_restricted, false)
     and not public.has_internal_operator_capability('graph_restricted') then
    raise exception 'Restricted graph capability required';
  end if;
  if p_format not in ('graphml', 'cypher') then
    raise exception 'Unsupported graph export format';
  end if;
  if p_person_mode not in ('pseudonymous', 'labeled') then
    raise exception 'Unsupported graph export person mode';
  end if;
  if p_graph_version is null or char_length(p_graph_version) > 240 then
    raise exception 'Invalid graph export version';
  end if;
  if coalesce(p_node_count, -1) < 0 or coalesce(p_edge_count, -1) < 0
     or coalesce(p_bytes, -1) < 0 or p_bytes > 100000000 then
    raise exception 'Invalid graph export size metadata';
  end if;

  -- Re-derive canonical topology immediately before an artifact leaves the app.
  -- This prevents an operator from sealing an export receipt against a stale or
  -- forged graph version while still avoiding retention of serialized content.
  v_summary := public.internal_graph_canonical_summary(p_event_id);
  v_expected_version := v_summary->>'graphVersion';
  if v_expected_version is null or v_expected_version <> p_graph_version then
    raise exception 'Graph changed before export could be sealed; regenerate the artifact';
  end if;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(),
    'graph_export_sealed',
    p_event_id,
    jsonb_build_object(
      'graphVersion', p_graph_version,
      'format', p_format,
      'personMode', p_person_mode,
      'restricted', coalesce(p_restricted, false),
      'nodeCount', p_node_count,
      'edgeCount', p_edge_count,
      'bytes', p_bytes,
      'contentRetained', false
    )
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;
revoke all on function public.record_internal_graph_export_receipt(uuid, text, text, text, boolean, integer, integer, integer) from public;
grant execute on function public.record_internal_graph_export_receipt(uuid, text, text, text, boolean, integer, integer, integer) to authenticated;

comment on function public.record_internal_graph_export_receipt(uuid, text, text, text, boolean, integer, integer, integer) is
  'Seals minimal metadata for a portable graph export after rechecking exact capabilities and canonical graph version. Export content is never retained.';
