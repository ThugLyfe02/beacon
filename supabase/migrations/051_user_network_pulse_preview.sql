-- =============================================================================
-- 051_user_network_pulse_preview.sql
-- A deliberately small, self-scoped taste of Beacon's network intelligence.
--
-- This is NOT Constellation-lite. It exposes no identities, hidden paths, broker
-- rankings, restricted topology, community membership, operator assertions or
-- forensic graph edges. It summarizes only the caller's verified activity plus
-- coarse aggregate reach derived from their existing mutual relationships.
-- =============================================================================

create or replace function public.get_my_network_pulse(p_event_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event_count integer := 0;
  v_mutual_count integer := 0;
  v_office_hours_completed integer := 0;
  v_outcomes_completed integer := 0;
  v_second_degree integer := 0;
  v_momentum integer := 0;
  v_shape text;
  v_reach_band text;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  if p_event_id is not null and not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = v_user
      and ep.status = 'approved'
  ) then
    raise exception 'Approved event membership required';
  end if;

  select count(distinct ep.event_id)::integer
  into v_event_count
  from public.event_participants ep
  where ep.user_id = v_user
    and ep.status = 'approved'
    and (p_event_id is null or ep.event_id = p_event_id);

  select count(*)::integer
  into v_mutual_count
  from public.matches m
  where v_user in (m.user_a_id, m.user_b_id)
    and (p_event_id is null or m.event_id = p_event_id);

  select count(*)::integer
  into v_office_hours_completed
  from public.office_hours_requests o
  where v_user in (o.requester_id, o.recipient_id)
    and o.status = 'completed'
    and (p_event_id is null or o.event_id = p_event_id);

  select count(*)::integer
  into v_outcomes_completed
  from public.outcome_handshakes h
  where v_user in (h.user_a_id, h.user_b_id)
    and h.status = 'completed'
    and (p_event_id is null or h.event_id = p_event_id);

  -- Coarse two-hop reach: aggregate count only. No second-degree identity leaves
  -- this function and blocked pairs are excluded from the count.
  with direct_people as (
    select case when m.user_a_id = v_user then m.user_b_id else m.user_a_id end as user_id
    from public.matches m
    where v_user in (m.user_a_id, m.user_b_id)
      and (p_event_id is null or m.event_id = p_event_id)
  ), second_degree as (
    select distinct case
      when m.user_a_id = d.user_id then m.user_b_id
      else m.user_a_id
    end as user_id
    from direct_people d
    join public.matches m
      on d.user_id in (m.user_a_id, m.user_b_id)
    where (p_event_id is null or m.event_id = p_event_id)
  )
  select count(*)::integer
  into v_second_degree
  from second_degree s
  where s.user_id <> v_user
    and not exists (select 1 from direct_people d where d.user_id = s.user_id)
    and not exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_id = s.user_id)
         or (b.blocker_id = s.user_id and b.blocked_id = v_user)
    );

  v_momentum := least(100, greatest(0,
    v_mutual_count * 8
    + v_office_hours_completed * 14
    + v_outcomes_completed * 24
    + least(v_second_degree, 20)
  ));

  v_shape := case
    when v_outcomes_completed >= 2 or (v_mutual_count >= 5 and v_second_degree >= 10) then 'bridging'
    when v_mutual_count >= 2 or v_office_hours_completed >= 1 then 'forming'
    else 'warming_up'
  end;

  v_reach_band := case
    when v_second_degree >= 20 then 'broad'
    when v_second_degree >= 5 then 'expanding'
    when v_second_degree >= 1 then 'local'
    else 'direct_only'
  end;

  return jsonb_build_object(
    'generatedAt', now(),
    'eventId', p_event_id,
    'eventCount', v_event_count,
    'mutualCount', v_mutual_count,
    'officeHoursCompleted', v_office_hours_completed,
    'outcomesCompleted', v_outcomes_completed,
    'secondDegreeReach', v_second_degree,
    'momentum', v_momentum,
    'shape', v_shape,
    'reachBand', v_reach_band,
    'privacyNote', 'Network Pulse is self-scoped and aggregate. It does not expose other people, hidden paths, broker scores, restricted relationships, or operator intelligence.'
  );
end;
$$;

revoke all on function public.get_my_network_pulse(uuid) from public;
grant execute on function public.get_my_network_pulse(uuid) to authenticated;

comment on function public.get_my_network_pulse(uuid) is
  'Self-scoped aggregate network preview for normal users; deliberately excludes Constellation forensic topology and identities.';
