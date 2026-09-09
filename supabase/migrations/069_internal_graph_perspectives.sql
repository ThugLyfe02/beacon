-- =============================================================================
-- 069_internal_graph_perspectives.sql
-- Private, bounded operator Perspectives inspired by graph-workbench lenses.
--
-- Perspectives are analytical visibility rules only. They cannot add evidence,
-- query external systems, target a person, mutate relationships, or elevate
-- restricted/export privileges. Definitions are validated as a small safe DSL.
-- =============================================================================

create table if not exists public.internal_graph_perspectives (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 80),
  description text,
  definition jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  check (description is null or char_length(description) <= 320),
  check (expires_at > created_at and expires_at <= created_at + interval '365 days')
);

alter table public.internal_graph_perspectives enable row level security;
revoke all on table public.internal_graph_perspectives from public, anon, authenticated;

create index if not exists idx_internal_graph_perspectives_owner
  on public.internal_graph_perspectives(created_by, updated_at desc)
  where enabled = true;

create or replace function public.internal_graph_perspective_definition_valid(p_definition jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_key text;
  v_value jsonb;
  v_text text;
  v_numeric numeric;
begin
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_definition) loop
    if v_key not in ('focusKinds', 'relations', 'confidenceFloor', 'minEvidenceCount', 'maxAgeDays', 'includeIsolates') then
      return false;
    end if;
  end loop;

  v_value := coalesce(p_definition->'focusKinds', '[]'::jsonb);
  if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 24 then return false; end if;
  for v_text in select jsonb_array_elements_text(v_value) loop
    if v_text !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
  end loop;

  v_value := coalesce(p_definition->'relations', '[]'::jsonb);
  if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 40 then return false; end if;
  for v_text in select jsonb_array_elements_text(v_value) loop
    if v_text !~ '^[a-z][a-z0-9_]{0,63}$' then return false; end if;
  end loop;

  v_text := coalesce(p_definition->>'confidenceFloor', 'DERIVED');
  if v_text not in ('VERIFIED', 'DERIVED', 'AMBIGUOUS') then return false; end if;

  v_numeric := coalesce(nullif(p_definition->>'minEvidenceCount', '')::numeric, 1);
  if v_numeric <> trunc(v_numeric) or v_numeric < 1 or v_numeric > 20 then return false; end if;

  if p_definition ? 'maxAgeDays' and p_definition->'maxAgeDays' <> 'null'::jsonb then
    v_numeric := nullif(p_definition->>'maxAgeDays', '')::numeric;
    if v_numeric <> trunc(v_numeric) or v_numeric < 1 or v_numeric > 3650 then return false; end if;
  end if;

  if p_definition ? 'includeIsolates' and jsonb_typeof(p_definition->'includeIsolates') <> 'boolean' then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;
revoke all on function public.internal_graph_perspective_definition_valid(jsonb) from public;

create or replace function public.save_internal_graph_perspective(
  p_id uuid,
  p_title text,
  p_description text,
  p_definition jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 or char_length(trim(p_title)) > 80 then
    raise exception 'Perspective title must be 3-80 characters';
  end if;
  if p_description is not null and char_length(p_description) > 320 then
    raise exception 'Perspective description exceeds 320 characters';
  end if;
  if not public.internal_graph_perspective_definition_valid(p_definition) then
    raise exception 'Perspective definition is outside the safe analytical DSL';
  end if;

  insert into public.internal_graph_perspectives(id, created_by, title, description, definition)
  values (v_id, auth.uid(), trim(p_title), nullif(trim(p_description), ''), p_definition)
  on conflict (id) do update
    set title = excluded.title,
        description = excluded.description,
        definition = excluded.definition,
        enabled = true,
        updated_at = now(),
        expires_at = now() + interval '365 days'
    where internal_graph_perspectives.created_by = auth.uid();

  if not exists (
    select 1 from public.internal_graph_perspectives p
    where p.id = v_id and p.created_by = auth.uid()
  ) then
    raise exception 'Perspective not found for current operator';
  end if;

  insert into public.internal_graph_audit_log(actor_id, action, metadata)
  values (auth.uid(), 'graph_perspective_saved', jsonb_build_object('perspectiveId', v_id));

  return v_id;
end;
$$;
revoke all on function public.save_internal_graph_perspective(uuid, text, text, jsonb) from public;
grant execute on function public.save_internal_graph_perspective(uuid, text, text, jsonb) to authenticated;

create or replace function public.get_internal_graph_perspectives()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph read capability required';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'perspectives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'description', p.description,
        'definition', p.definition,
        'enabled', p.enabled,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'expiresAt', p.expires_at
      ) order by p.updated_at desc)
      from public.internal_graph_perspectives p
      where p.created_by = auth.uid()
        and p.enabled = true
        and p.expires_at > now()
    ), '[]'::jsonb),
    'operatingRule', 'Perspectives filter already-authorized graph evidence only; they cannot add evidence, target a person, or elevate capabilities.'
  );
end;
$$;
revoke all on function public.get_internal_graph_perspectives() from public;
grant execute on function public.get_internal_graph_perspectives() to authenticated;

create or replace function public.delete_internal_graph_perspective(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  delete from public.internal_graph_perspectives
  where id = p_id and created_by = auth.uid();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke all on function public.delete_internal_graph_perspective(uuid) from public;
grant execute on function public.delete_internal_graph_perspective(uuid) to authenticated;

create or replace function public.prune_internal_graph_perspectives()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;
  delete from public.internal_graph_perspectives
  where expires_at <= now() or updated_at < now() - interval '365 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_internal_graph_perspectives() from public;
grant execute on function public.prune_internal_graph_perspectives() to service_role;

comment on table public.internal_graph_perspectives is
  'Private bounded operator analytical lenses. Definitions contain safe graph-filter DSL only and never person targets or external endpoints.';
