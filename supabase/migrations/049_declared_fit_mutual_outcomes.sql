-- Aggregate declared-fit context at the moment a real mutual match is created.
--
-- This closes the loop between explicit participant intent and an actual Beacon
-- outcome without creating an attendee movement dossier or exposing match pairs
-- to organizers. The raw context table is not client-readable; hosts receive
-- only cohort-gated aggregates through the RPCs below.

create table if not exists public.declared_fit_mutual_contexts (
  match_id uuid primary key references public.matches(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  fit_class text not null check (fit_class in ('none','one-way','two-way')),
  domains text[] not null default '{}',
  domain_count integer not null default 0 check (domain_count between 0 and 12),
  recorded_at timestamptz not null default now(),
  check (domains <@ array[
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ]::text[]),
  check (domain_count = cardinality(domains))
);

alter table public.declared_fit_mutual_contexts enable row level security;
revoke all on public.declared_fit_mutual_contexts from authenticated, anon;

create index if not exists declared_fit_mutual_contexts_event_idx
  on public.declared_fit_mutual_contexts (event_id, recorded_at desc);

create or replace function public.capture_declared_fit_mutual_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a_seeking text[] := '{}';
  v_a_offering text[] := '{}';
  v_b_seeking text[] := '{}';
  v_b_offering text[] := '{}';
  v_a_helped_by_b text[] := '{}';
  v_b_helped_by_a text[] := '{}';
  v_domains text[] := '{}';
  v_fit_class text := 'none';
begin
  select i.seeking, i.offering
    into v_a_seeking, v_a_offering
  from public.participant_event_intents i
  where i.event_id = new.event_id
    and i.user_id = new.user_a_id
    and i.enabled = true
  limit 1;

  select i.seeking, i.offering
    into v_b_seeking, v_b_offering
  from public.participant_event_intents i
  where i.event_id = new.event_id
    and i.user_id = new.user_b_id
    and i.enabled = true
  limit 1;

  v_a_seeking := coalesce(v_a_seeking, '{}');
  v_a_offering := coalesce(v_a_offering, '{}');
  v_b_seeking := coalesce(v_b_seeking, '{}');
  v_b_offering := coalesce(v_b_offering, '{}');

  select coalesce(array_agg(key order by key), '{}')
    into v_a_helped_by_b
  from (
    select distinct key
    from unnest(v_a_seeking) key
    where key = any(v_b_offering)
  ) overlap;

  select coalesce(array_agg(key order by key), '{}')
    into v_b_helped_by_a
  from (
    select distinct key
    from unnest(v_b_seeking) key
    where key = any(v_a_offering)
  ) overlap;

  select coalesce(array_agg(key order by key), '{}')
    into v_domains
  from (
    select distinct key
    from unnest(v_a_helped_by_b || v_b_helped_by_a) key
  ) combined;

  if cardinality(v_a_helped_by_b) > 0 and cardinality(v_b_helped_by_a) > 0 then
    v_fit_class := 'two-way';
  elsif cardinality(v_domains) > 0 then
    v_fit_class := 'one-way';
  end if;

  insert into public.declared_fit_mutual_contexts (
    match_id,
    event_id,
    fit_class,
    domains,
    domain_count,
    recorded_at
  ) values (
    new.id,
    new.event_id,
    v_fit_class,
    v_domains,
    cardinality(v_domains),
    coalesce(new.created_at, now())
  )
  on conflict (match_id) do nothing;

  return new;
end;
$$;

drop trigger if exists capture_declared_fit_context_after_match on public.matches;
create trigger capture_declared_fit_context_after_match
after insert on public.matches
for each row execute function public.capture_declared_fit_mutual_context();

-- The summary describes composition of actual mutual outcomes. It is not a
-- conversion rate because Beacon does not persist every pairwise fit exposure.
-- Fewer than five mutuals yields only supported=false, with all counts withheld.
create or replace function public.get_declared_fit_mutual_summary(p_event_id uuid)
returns table (
  supported boolean,
  total_mutual_matches integer,
  declared_fit_mutual_matches integer,
  two_way_declared_fit_mutual_matches integer,
  declared_fit_share numeric,
  two_way_share numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_declared integer;
  v_two_way integer;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where c.fit_class <> 'none')::integer,
    count(*) filter (where c.fit_class = 'two-way')::integer
  into v_total, v_declared, v_two_way
  from public.declared_fit_mutual_contexts c
  where c.event_id = p_event_id;

  if coalesce(v_total, 0) < 5 then
    return query select false, null::integer, null::integer, null::integer, null::numeric, null::numeric;
    return;
  end if;

  return query select
    true,
    v_total,
    v_declared,
    v_two_way,
    v_declared::numeric / greatest(1, v_total),
    v_two_way::numeric / greatest(1, v_total);
end;
$$;

-- Domain rows are released only after at least five mutual matches carry that
-- declared intersection, preventing a small number of real pairs from becoming
-- identifiable through an organizer analytics surface.
create or replace function public.get_declared_fit_mutual_domains(p_event_id uuid)
returns table (
  intent_key text,
  mutual_match_count integer,
  two_way_match_count integer,
  two_way_share numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    return;
  end if;

  return query
  with expanded as (
    select
      domain.intent_key,
      c.fit_class,
      c.match_id
    from public.declared_fit_mutual_contexts c
    cross join lateral unnest(c.domains) as domain(intent_key)
    where c.event_id = p_event_id
  ), grouped as (
    select
      e.intent_key,
      count(distinct e.match_id)::integer as mutual_match_count,
      count(distinct e.match_id) filter (where e.fit_class = 'two-way')::integer as two_way_match_count
    from expanded e
    group by e.intent_key
  )
  select
    g.intent_key,
    g.mutual_match_count,
    g.two_way_match_count,
    g.two_way_match_count::numeric / greatest(1, g.mutual_match_count)
  from grouped g
  where g.mutual_match_count >= 5
  order by g.mutual_match_count desc, g.intent_key;
end;
$$;

revoke all on function public.capture_declared_fit_mutual_context() from public;
revoke all on function public.get_declared_fit_mutual_summary(uuid) from public;
revoke all on function public.get_declared_fit_mutual_domains(uuid) from public;

grant execute on function public.get_declared_fit_mutual_summary(uuid) to authenticated;
grant execute on function public.get_declared_fit_mutual_domains(uuid) to authenticated;

comment on table public.declared_fit_mutual_contexts is
  'Server-private aggregate declared-fit context captured when a real mutual match is created. Organizers cannot read match pairs from this table.';

comment on function public.get_declared_fit_mutual_summary(uuid) is
  'Host-only cohort-gated composition of mutual matches by declared-fit class; not a pairwise exposure conversion rate.';

comment on function public.get_declared_fit_mutual_domains(uuid) is
  'Host-only domain composition of real mutual outcomes with a five-match minimum per released domain and no participant identities.';
