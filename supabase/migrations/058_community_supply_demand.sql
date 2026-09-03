-- Cohort-gated community supply / demand map
--
-- This is a partnership-planning surface, not a people search. For two active
-- event partner communities, the event host and the two community owners may
-- inspect only domain rows supported by at least five exchange-enabled declaring
-- participants on each side. The map describes explicit aggregate need/supply;
-- it does not predict a match, expose who selected a domain, or authorize an
-- exchange between the communities.

create or replace function public.get_community_pair_supply_demand(
  p_event_id uuid,
  p_community_one uuid,
  p_community_two uuid
)
returns table (
  intent_key text,
  community_a_name text,
  community_b_name text,
  community_a_contributors integer,
  community_a_seeking integer,
  community_a_offering integer,
  community_b_contributors integer,
  community_b_seeking integer,
  community_b_offering integer,
  a_supply_for_b_need integer,
  b_supply_for_a_need integer,
  exchange_posture text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  if auth.uid() is null or p_community_one = p_community_two then return; end if;
  if p_community_one::text < p_community_two::text then v_a := p_community_one; v_b := p_community_two;
  else v_a := p_community_two; v_b := p_community_one; end if;

  select owner_id into v_owner_a from public.community_partners where id = v_a and state = 'active';
  select owner_id into v_owner_b from public.community_partners where id = v_b and state = 'active';
  if v_owner_a is null or v_owner_b is null then return; end if;

  if not public.is_event_host(p_event_id, auth.uid()) and auth.uid() not in (v_owner_a, v_owner_b) then
    return;
  end if;

  if not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id and p.community_id = v_a and p.state = 'active'
  ) or not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id and p.community_id = v_b and p.state = 'active'
  ) then return; end if;

  return query
  with intent_keys as (
    select unnest(array[
      'capital','hiring','partnerships','customers','technical','product',
      'design','media','mentorship','community','research','operations'
    ]::text[]) as intent_key
  ), eligible as (
    select
      a.community_id,
      i.user_id,
      i.seeking,
      i.offering
    from public.participant_event_community_affiliations a
    join public.event_participants ep
      on ep.event_id = a.event_id
     and ep.user_id = a.user_id
     and ep.status = 'approved'
    join public.participant_event_intents i
      on i.event_id = a.event_id
     and i.user_id = a.user_id
     and i.enabled = true
    where a.event_id = p_event_id
      and a.exchange_enabled = true
      and a.community_id in (v_a, v_b)
  ), per_domain as (
    select
      k.intent_key,
      count(distinct e.user_id) filter (
        where e.community_id = v_a
          and (k.intent_key = any(e.seeking) or k.intent_key = any(e.offering))
      )::integer as a_contributors,
      count(distinct e.user_id) filter (
        where e.community_id = v_a and k.intent_key = any(e.seeking)
      )::integer as a_seeking,
      count(distinct e.user_id) filter (
        where e.community_id = v_a and k.intent_key = any(e.offering)
      )::integer as a_offering,
      count(distinct e.user_id) filter (
        where e.community_id = v_b
          and (k.intent_key = any(e.seeking) or k.intent_key = any(e.offering))
      )::integer as b_contributors,
      count(distinct e.user_id) filter (
        where e.community_id = v_b and k.intent_key = any(e.seeking)
      )::integer as b_seeking,
      count(distinct e.user_id) filter (
        where e.community_id = v_b and k.intent_key = any(e.offering)
      )::integer as b_offering
    from intent_keys k
    left join eligible e on true
    group by k.intent_key
  )
  select
    d.intent_key,
    a.name,
    b.name,
    d.a_contributors,
    d.a_seeking,
    d.a_offering,
    d.b_contributors,
    d.b_seeking,
    d.b_offering,
    least(d.a_offering, d.b_seeking),
    least(d.b_offering, d.a_seeking),
    case
      when least(d.a_offering, d.b_seeking) >= 5 and least(d.b_offering, d.a_seeking) >= 5 then 'two-way'
      when least(d.a_offering, d.b_seeking) >= 5 then 'a-can-support-b'
      when least(d.b_offering, d.a_seeking) >= 5 then 'b-can-support-a'
      else 'observe'
    end
  from per_domain d
  join public.community_partners a on a.id = v_a
  join public.community_partners b on b.id = v_b
  where d.a_contributors >= 5
    and d.b_contributors >= 5
  order by
    greatest(
      least(d.a_offering, d.b_seeking),
      least(d.b_offering, d.a_seeking)
    ) desc,
    d.intent_key;
end;
$$;

revoke all on function public.get_community_pair_supply_demand(uuid,uuid,uuid) from public;
grant execute on function public.get_community_pair_supply_demand(uuid,uuid,uuid) to authenticated;

comment on function public.get_community_pair_supply_demand(uuid,uuid,uuid) is
  'Host/two-owner cohort-gated planning map of explicit community need and supply. Rows require at least five exchange-enabled declaring participants per community in that domain; output is descriptive and grants no participant or exchange authority.';
