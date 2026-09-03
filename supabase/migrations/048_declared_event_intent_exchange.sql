-- Declared event intent exchange
--
-- This layer makes Beacon more useful without inferring private intent from
-- clicks, dwell time, or proximity. Participants explicitly state what domains
-- they are looking for help with and what domains they can help with. Other
-- participants never receive the full declaration; they receive only pairwise
-- intersections that are relevant to them and already present in their current
-- live field.

create table if not exists public.participant_event_intents (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  seeking text[] not null default '{}',
  offering text[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  check (cardinality(seeking) <= 6),
  check (cardinality(offering) <= 6),
  check (seeking <@ array[
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ]::text[]),
  check (offering <@ array[
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ]::text[])
);

alter table public.participant_event_intents enable row level security;

-- Direct reads expose only the caller's own declaration. Pairwise compatibility
-- and organizer aggregates are released through narrowly scoped RPCs below.
create policy "participants can read their own event intent"
on public.participant_event_intents for select
to authenticated
using (user_id = auth.uid());

revoke insert, update, delete on public.participant_event_intents from authenticated;
revoke all on public.participant_event_intents from anon;

create index if not exists participant_event_intents_event_idx
  on public.participant_event_intents (event_id, enabled)
  where enabled = true;

create or replace function public.normalize_event_intent_keys(p_keys text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(key order by key), '{}')
  from (
    select distinct lower(trim(value)) as key
    from unnest(coalesce(p_keys, '{}')) as value
    where lower(trim(value)) in (
      'capital',
      'hiring',
      'partnerships',
      'customers',
      'technical',
      'product',
      'design',
      'media',
      'mentorship',
      'community',
      'research',
      'operations'
    )
  ) normalized;
$$;

create or replace function public.set_my_event_intent(
  p_event_id uuid,
  p_seeking text[],
  p_offering text[],
  p_enabled boolean default true
)
returns table (
  event_id uuid,
  user_id uuid,
  seeking text[],
  offering text[],
  enabled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seeking text[];
  v_offering text[];
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'approved event participation required';
  end if;

  if not public.is_event_operational(p_event_id) then
    raise exception 'event intent can be changed only while the event is operational';
  end if;

  v_seeking := public.normalize_event_intent_keys(p_seeking);
  v_offering := public.normalize_event_intent_keys(p_offering);

  if cardinality(v_seeking) > 6 or cardinality(v_offering) > 6 then
    raise exception 'choose at most six seeking and six offering domains';
  end if;

  insert into public.participant_event_intents (
    event_id,
    user_id,
    seeking,
    offering,
    enabled,
    updated_at
  ) values (
    p_event_id,
    auth.uid(),
    v_seeking,
    v_offering,
    coalesce(p_enabled, true),
    now()
  )
  on conflict (event_id, user_id) do update
  set
    seeking = excluded.seeking,
    offering = excluded.offering,
    enabled = excluded.enabled,
    updated_at = now();

  return query
  select
    i.event_id,
    i.user_id,
    i.seeking,
    i.offering,
    i.enabled,
    i.updated_at
  from public.participant_event_intents i
  where i.event_id = p_event_id
    and i.user_id = auth.uid();
end;
$$;

create or replace function public.get_my_event_intent(p_event_id uuid)
returns table (
  event_id uuid,
  user_id uuid,
  seeking text[],
  offering text[],
  enabled boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.event_id,
    i.user_id,
    i.seeking,
    i.offering,
    i.enabled,
    i.updated_at
  from public.participant_event_intents i
  where i.event_id = p_event_id
    and i.user_id = auth.uid()
    and exists (
      select 1
      from public.event_participants ep
      where ep.event_id = i.event_id
        and ep.user_id = auth.uid()
        and ep.status = 'approved'
    );
$$;

-- Returns only the portion of another participant's declaration that intersects
-- with the caller's own declaration. Full peer declarations are never released.
-- The caller also supplies only ids that are already in its live proximity field,
-- preventing this RPC from becoming an event-wide intent enumerator.
create or replace function public.get_event_declared_fit(
  p_event_id uuid,
  p_target_user_ids uuid[]
)
returns table (
  target_user_id uuid,
  they_can_help_with text[],
  i_can_help_with text[],
  fit_strength numeric,
  two_way boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_target_user_ids uuid[];
begin
  if auth.uid() is null then
    return;
  end if;

  if not public.is_event_operational(p_event_id) then
    return;
  end if;

  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    return;
  end if;

  select coalesce(array_agg(target_id order by target_id), '{}')
    into v_target_user_ids
  from (
    select distinct target_id
    from unnest(coalesce(p_target_user_ids, '{}')) target_id
    where target_id <> auth.uid()
    order by target_id
    limit 128
  ) bounded;

  if cardinality(v_target_user_ids) = 0 then
    return;
  end if;

  return query
  with mine as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    where i.event_id = p_event_id
      and i.user_id = auth.uid()
      and i.enabled = true
  ), peers as (
    select
      i.user_id,
      i.seeking,
      i.offering
    from public.participant_event_intents i
    join public.event_participants ep
      on ep.event_id = i.event_id
     and ep.user_id = i.user_id
     and ep.status = 'approved'
    join public.users u on u.id = i.user_id
    where i.event_id = p_event_id
      and i.user_id = any(v_target_user_ids)
      and i.enabled = true
      and u.is_discoverable = true
      and not exists (
        select 1
        from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = i.user_id)
           or (b.blocker_id = i.user_id and b.blocked_id = auth.uid())
      )
  ), intersections as (
    select
      p.user_id,
      array(
        select key
        from unnest(m.seeking) key
        where key = any(p.offering)
        order by key
      ) as they_can_help_with,
      array(
        select key
        from unnest(m.offering) key
        where key = any(p.seeking)
        order by key
      ) as i_can_help_with
    from peers p
    cross join mine m
  ), scored as (
    select
      x.user_id,
      x.they_can_help_with,
      x.i_can_help_with,
      least(
        1::numeric,
        cardinality(x.they_can_help_with)::numeric * 0.28
          + cardinality(x.i_can_help_with)::numeric * 0.18
          + case
              when cardinality(x.they_can_help_with) > 0
               and cardinality(x.i_can_help_with) > 0
              then 0.22
              else 0
            end
      ) as fit_strength,
      cardinality(x.they_can_help_with) > 0
        and cardinality(x.i_can_help_with) > 0 as two_way
    from intersections x
    where cardinality(x.they_can_help_with) > 0
       or cardinality(x.i_can_help_with) > 0
  )
  select
    s.user_id,
    s.they_can_help_with,
    s.i_can_help_with,
    s.fit_strength,
    s.two_way
  from scored s
  order by s.two_way desc, s.fit_strength desc, s.user_id;
end;
$$;

-- Host-only aggregate demand/supply view. Categories with fewer than five
-- declaring participants remain suppressed instead of exposing a small cohort.
create or replace function public.get_event_intent_mix(p_event_id uuid)
returns table (
  intent_key text,
  seeking_count integer,
  offering_count integer,
  contributor_count integer,
  balance text
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
  with keys as (
    select unnest(array[
      'capital','hiring','partnerships','customers','technical','product',
      'design','media','mentorship','community','research','operations'
    ]::text[]) as intent_key
  ), approved as (
    select i.*
    from public.participant_event_intents i
    join public.event_participants ep
      on ep.event_id = i.event_id
     and ep.user_id = i.user_id
     and ep.status = 'approved'
    where i.event_id = p_event_id
      and i.enabled = true
  ), counts as (
    select
      k.intent_key,
      count(*) filter (where k.intent_key = any(a.seeking))::integer as seeking_count,
      count(*) filter (where k.intent_key = any(a.offering))::integer as offering_count,
      count(*) filter (
        where k.intent_key = any(a.seeking)
           or k.intent_key = any(a.offering)
      )::integer as contributor_count
    from keys k
    cross join approved a
    group by k.intent_key
  )
  select
    c.intent_key,
    c.seeking_count,
    c.offering_count,
    c.contributor_count,
    case
      when c.seeking_count >= greatest(3, ceil(c.offering_count * 1.5)::integer) then 'need-heavy'
      when c.offering_count >= greatest(3, ceil(c.seeking_count * 1.5)::integer) then 'offer-heavy'
      else 'balanced'
    end as balance
  from counts c
  where c.contributor_count >= 5
  order by c.contributor_count desc, c.intent_key;
end;
$$;

revoke all on function public.normalize_event_intent_keys(text[]) from public;
revoke all on function public.set_my_event_intent(uuid,text[],text[],boolean) from public;
revoke all on function public.get_my_event_intent(uuid) from public;
revoke all on function public.get_event_declared_fit(uuid,uuid[]) from public;
revoke all on function public.get_event_intent_mix(uuid) from public;

grant execute on function public.set_my_event_intent(uuid,text[],text[],boolean) to authenticated;
grant execute on function public.get_my_event_intent(uuid) to authenticated;
grant execute on function public.get_event_declared_fit(uuid,uuid[]) to authenticated;
grant execute on function public.get_event_intent_mix(uuid) to authenticated;

comment on table public.participant_event_intents is
  'Explicit event-scoped seeking/offering declarations. Peer access is intersection-only through get_event_declared_fit; Beacon does not infer these intents from behavior.';

comment on function public.get_event_declared_fit(uuid,uuid[]) is
  'Returns only caller-relevant pairwise intersections for caller-supplied live-field targets; does not reveal full peer declarations, popularity, or inferred private intent.';

comment on function public.get_event_intent_mix(uuid) is
  'Host-only aggregate declared-intent mix with minimum cohort suppression for event programming and supply/demand planning; never returns participant identities.';
