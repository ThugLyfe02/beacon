-- Private participant event playbook
--
-- Beacon already learns how a host can operate a venue across repeat events.
-- This migration adds the complementary participant-owned memory layer: a user
-- can carry forward domains that repeatedly appeared in their own ended-event
-- declarations, captured mutuals, and explicit outcome handshakes.
--
-- The server returns aggregate evidence for the caller only. It does not expose
-- counterpart identities, profile activity, movement, dwell, clicks, messages,
-- or another participant's full declaration. Historical evidence can inform a
-- draft for a new event, but it never changes the current declaration by itself.

create index if not exists participant_event_intents_user_history_idx
  on public.participant_event_intents (user_id, event_id, updated_at desc)
  where enabled = true;

create index if not exists matches_user_a_event_history_idx
  on public.matches (user_a_id, event_id, created_at desc);

create index if not exists matches_user_b_event_history_idx
  on public.matches (user_b_id, event_id, created_at desc);

create or replace function public.get_my_event_playbook(p_current_event_id uuid)
returns table (
  intent_key text,
  seeking_event_count integer,
  offering_event_count integer,
  declared_event_count integer,
  observed_mutual_count integer,
  two_way_mutual_count integer,
  aligned_outcome_count integer,
  completed_outcome_count integer,
  last_declared_at timestamptz,
  last_outcome_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  -- This projection exists to help an approved participant prepare the current
  -- event. A host, spectator, or former participant cannot use it as a private
  -- attendee-history lookup.
  if not public.is_event_operational(p_current_event_id) then
    return;
  end if;

  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_current_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    return;
  end if;

  return query
  with intent_keys as (
    select unnest(array[
      'capital','hiring','partnerships','customers','technical','product',
      'design','media','mentorship','community','research','operations'
    ]::text[]) as intent_key
  ), historical_declarations as (
    select
      i.event_id,
      i.seeking,
      i.offering,
      i.updated_at
    from public.participant_event_intents i
    join public.events e on e.id = i.event_id
    join public.event_participants ep
      on ep.event_id = i.event_id
     and ep.user_id = i.user_id
     and ep.status = 'approved'
    where i.user_id = auth.uid()
      and i.enabled = true
      and e.ended_at is not null
      and i.event_id <> p_current_event_id
  ), declaration_counts as (
    select
      k.intent_key,
      count(distinct d.event_id) filter (
        where k.intent_key = any(d.seeking)
      )::integer as seeking_event_count,
      count(distinct d.event_id) filter (
        where k.intent_key = any(d.offering)
      )::integer as offering_event_count,
      count(distinct d.event_id) filter (
        where k.intent_key = any(d.seeking)
           or k.intent_key = any(d.offering)
      )::integer as declared_event_count,
      max(d.updated_at) filter (
        where k.intent_key = any(d.seeking)
           or k.intent_key = any(d.offering)
      ) as last_declared_at
    from intent_keys k
    left join historical_declarations d
      on k.intent_key = any(d.seeking)
      or k.intent_key = any(d.offering)
    group by k.intent_key
  ), caller_matches as (
    select
      m.id as match_id,
      m.event_id,
      m.created_at,
      case
        when m.user_a_id = auth.uid() then m.user_b_id
        else m.user_a_id
      end as counterpart_id
    from public.matches m
    join public.events e on e.id = m.event_id
    where auth.uid() in (m.user_a_id, m.user_b_id)
      and e.ended_at is not null
      and m.event_id <> p_current_event_id
      and not exists (
        select 1
        from public.user_blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = case
                 when m.user_a_id = auth.uid() then m.user_b_id else m.user_a_id end)
           or (b.blocked_id = auth.uid() and b.blocker_id = case
                 when m.user_a_id = auth.uid() then m.user_b_id else m.user_a_id end)
      )
  ), caller_outcome_context as (
    select
      cm.match_id,
      cm.event_id,
      cm.created_at,
      c.fit_class,
      c.domains,
      oh.status as handshake_status,
      oh.aligned_at,
      oh.completed_at
    from caller_matches cm
    join public.declared_fit_mutual_contexts c
      on c.match_id = cm.match_id
     and c.event_id = cm.event_id
    left join public.outcome_handshakes oh
      on oh.match_id = cm.match_id
     and oh.event_id = cm.event_id
  ), expanded_outcomes as (
    select
      o.match_id,
      domain.intent_key,
      o.fit_class,
      o.handshake_status,
      o.aligned_at,
      o.completed_at,
      greatest(
        o.created_at,
        coalesce(o.aligned_at, o.created_at),
        coalesce(o.completed_at, o.created_at)
      ) as outcome_at
    from caller_outcome_context o
    cross join lateral unnest(o.domains) as domain(intent_key)
  ), outcome_counts as (
    select
      x.intent_key,
      count(distinct x.match_id)::integer as observed_mutual_count,
      count(distinct x.match_id) filter (
        where x.fit_class = 'two-way'
      )::integer as two_way_mutual_count,
      count(distinct x.match_id) filter (
        where x.handshake_status in ('aligned', 'completed')
           or x.aligned_at is not null
      )::integer as aligned_outcome_count,
      count(distinct x.match_id) filter (
        where x.handshake_status = 'completed'
           or x.completed_at is not null
      )::integer as completed_outcome_count,
      max(x.outcome_at) as last_outcome_at
    from expanded_outcomes x
    group by x.intent_key
  )
  select
    d.intent_key,
    d.seeking_event_count,
    d.offering_event_count,
    d.declared_event_count,
    coalesce(o.observed_mutual_count, 0),
    coalesce(o.two_way_mutual_count, 0),
    coalesce(o.aligned_outcome_count, 0),
    coalesce(o.completed_outcome_count, 0),
    d.last_declared_at,
    o.last_outcome_at
  from declaration_counts d
  left join outcome_counts o on o.intent_key = d.intent_key
  where d.declared_event_count > 0
  order by
    coalesce(o.completed_outcome_count, 0) desc,
    coalesce(o.aligned_outcome_count, 0) desc,
    coalesce(o.observed_mutual_count, 0) desc,
    d.declared_event_count desc,
    d.intent_key;
end;
$$;

revoke all on function public.get_my_event_playbook(uuid) from public;
grant execute on function public.get_my_event_playbook(uuid) to authenticated;

comment on function public.get_my_event_playbook(uuid) is
  'Caller-private evidence from the participant own ended events. Returns bounded domain counts only; no counterpart identities, behavioral inference, host access, or automatic current-event declaration changes.';
