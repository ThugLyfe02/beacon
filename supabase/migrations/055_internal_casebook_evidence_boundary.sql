-- =============================================================================
-- 055_internal_casebook_evidence_boundary.sql
-- Prevents the operator Casebook from becoming an arbitrary PII/raw-location
-- side channel through its structured finding evidence JSON.
-- =============================================================================

create or replace function public.internal_graph_case_evidence_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_child jsonb;
  v_forbidden constant text[] := array[
    'email', 'email_address', 'phone', 'phone_number', 'mobile',
    'latitude', 'longitude', 'lat', 'lng', 'last_known_lat', 'last_known_lng',
    'address', 'street_address', 'push_token', 'expo_push_token',
    'access_code', 'join_code', 'auth_token', 'token', 'device_id', 'ip_address'
  ]::text[];
begin
  if p_value is null then return true; end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) = any(v_forbidden)
         or lower(v_key) ~ '(email|phone|mobile|latitude|longitude|(^|_)lat($|_)|(^|_)lng($|_)|push.*token|access.*code|join.*code|auth.*token|device.*id|ip.*address|street.*address)' then
        return false;
      end if;
      if not public.internal_graph_case_evidence_is_safe(v_child) then return false; end if;
    end loop;
    return true;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if not public.internal_graph_case_evidence_is_safe(v_child) then return false; end if;
    end loop;
  end if;

  return true;
end;
$$;
revoke all on function public.internal_graph_case_evidence_is_safe(jsonb) from public;

-- Existing rows predate the boundary. Fail privacy-safe rather than preserving an
-- arbitrary payload whose key structure violates the new contract.
update public.internal_graph_case_findings
set evidence = jsonb_build_object('redactedByMigration', true)
where not public.internal_graph_case_evidence_is_safe(evidence)
   or pg_column_size(evidence) > 16384;

alter table public.internal_graph_case_findings
  drop constraint if exists internal_graph_case_findings_safe_evidence;
alter table public.internal_graph_case_findings
  add constraint internal_graph_case_findings_safe_evidence
  check (
    pg_column_size(evidence) <= 16384
    and public.internal_graph_case_evidence_is_safe(evidence)
  );

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
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
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
  if pg_column_size(v_evidence) > 16384 then
    raise exception 'Case evidence exceeds the 16KB structured-evidence limit';
  end if;
  if not public.internal_graph_case_evidence_is_safe(v_evidence) then
    raise exception 'Case evidence contains a forbidden contact/location/credential field';
  end if;
  if not exists (
    select 1 from public.internal_graph_cases c
    where c.id = p_case_id and c.status <> 'archived' and c.expires_at > now()
  ) then raise exception 'Case is not active for findings'; end if;

  insert into public.internal_graph_case_findings(
    case_id, finding_key, finding_class, summary, evidence, score, expires_at
  ) values (
    p_case_id, trim(p_finding_key), p_finding_class, trim(p_summary),
    v_evidence, coalesce(p_score, 0), now() + interval '180 days'
  ) on conflict(case_id, finding_key) do update set
    finding_class = excluded.finding_class,
    summary = excluded.summary,
    evidence = excluded.evidence,
    score = excluded.score,
    last_seen_at = now(),
    expires_at = greatest(public.internal_graph_case_findings.expires_at, excluded.expires_at)
  returning id into v_id;

  update public.internal_graph_cases
  set last_evaluated_at = now(), updated_at = now()
  where id = p_case_id;

  return v_id;
end;
$$;
revoke all on function public.upsert_internal_graph_case_finding(uuid, text, text, text, numeric, jsonb) from public;
grant execute on function public.upsert_internal_graph_case_finding(uuid, text, text, text, numeric, jsonb) to authenticated;

comment on function public.internal_graph_case_evidence_is_safe(jsonb) is
  'Recursive Casebook evidence guard. Forbids contact, precise-location, credential and device-identity fields and complements the 16KB payload cap.';
