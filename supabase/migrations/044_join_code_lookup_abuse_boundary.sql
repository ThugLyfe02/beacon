-- =============================================================================
-- 044_join_code_lookup_abuse_boundary.sql
-- Rate-limits pre-membership join-code discovery and minimizes returned identity.
-- =============================================================================

create table if not exists public.event_join_code_lookup_attempts (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.users(id) on delete cascade,
  code_fingerprint text not null check (char_length(code_fingerprint) = 64),
  matched boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists event_join_lookup_actor_time_idx
  on public.event_join_code_lookup_attempts (actor_id, attempted_at desc);

alter table public.event_join_code_lookup_attempts enable row level security;
-- No client policies. The lookup RPC records privacy-safe attempt fingerprints.

create or replace function public.get_event_by_join_code(p_join_code text)
returns table (
  id uuid,
  host_id uuid,
  name text,
  description text,
  join_code text,
  location_type public.location_type,
  latitude numeric,
  longitude numeric,
  address text,
  requires_approval boolean,
  access_code text,
  show_participant_count boolean,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_join_code, '')));
  v_recent integer;
  v_daily integer;
  v_event public.events;
  v_entitled boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_code) <> 6
     or v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' then
    return;
  end if;

  select count(*)::integer into v_recent
  from public.event_join_code_lookup_attempts a
  where a.actor_id = auth.uid()
    and a.attempted_at > now() - interval '10 minutes';

  select count(*)::integer into v_daily
  from public.event_join_code_lookup_attempts a
  where a.actor_id = auth.uid()
    and a.attempted_at > now() - interval '24 hours';

  if v_recent >= 30 or v_daily >= 150 then
    -- Fail closed without disclosing whether the supplied code was valid.
    return;
  end if;

  select * into v_event
  from public.events e
  where e.join_code = v_code
    and e.finalized_at is null
    and (e.ends_at is null or e.ends_at > now())
  limit 1;

  insert into public.event_join_code_lookup_attempts (
    actor_id,
    code_fingerprint,
    matched
  ) values (
    auth.uid(),
    encode(digest(v_code, 'sha256'), 'hex'),
    v_event.id is not null
  );

  if v_event.id is null then return; end if;

  v_entitled := public.is_event_host(v_event.id, auth.uid())
    or public.is_approved_participant(v_event.id, auth.uid());

  return query
  select
    v_event.id,
    case when v_entitled then v_event.host_id else null::uuid end,
    v_event.name,
    v_event.description,
    v_event.join_code,
    v_event.location_type,
    case when v_entitled then v_event.latitude else null::numeric end,
    case when v_entitled then v_event.longitude else null::numeric end,
    case when v_entitled then v_event.address else null::text end,
    v_event.requires_approval,
    null::text,
    v_event.show_participant_count,
    v_event.starts_at,
    v_event.ends_at,
    v_event.created_at;
end;
$$;

revoke all on function public.get_event_by_join_code(text) from public;
grant execute on function public.get_event_by_join_code(text) to authenticated;

create or replace function public.prune_event_join_code_lookup_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.event_join_code_lookup_attempts
  where attempted_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_event_join_code_lookup_attempts() from public;
revoke execute on function public.prune_event_join_code_lookup_attempts() from authenticated;
grant execute on function public.prune_event_join_code_lookup_attempts() to service_role;

comment on table public.event_join_code_lookup_attempts is
  'Abuse-control ledger for join-code discovery. Stores only actor, timestamp, match bit, and SHA-256 code fingerprint; never plaintext attempted codes.';
