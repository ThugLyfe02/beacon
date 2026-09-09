-- =============================================================================
-- 075_internal_graph_case_question_visibility.sql
-- Expose question-resolution state through the existing collaboration RPC.
-- =============================================================================

create or replace function public.get_internal_graph_case_collaboration(p_case_id uuid)
returns jsonb
language plpgsql
stable
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
        'resolvedAt', m.resolved_at,
        'resolvedById', m.resolved_by,
        'resolvedByLabel', case when m.resolved_by is null then null else coalesce(nullif(trim(ru.name), ''), 'Operator ' || left(m.resolved_by::text, 8)) end,
        'createdAt', m.created_at,
        'expiresAt', m.expires_at
      ) order by m.created_at desc)
      from public.internal_graph_case_memory_entries m
      left join public.users u on u.id = m.author_id
      left join public.users ru on ru.id = m.resolved_by
      where m.case_id = v_case.id and m.expires_at > now()
    ), '[]'::jsonb),
    'operatingRule', 'Collaborative Case Memory stores bounded operator reasoning bound to canonical graph versions and evidence digests. Question resolution changes operator memory state only and never graph truth.'
  );
end;
$$;
revoke all on function public.get_internal_graph_case_collaboration(uuid) from public;
grant execute on function public.get_internal_graph_case_collaboration(uuid) to authenticated;
