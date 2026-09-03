-- Reusable community partner programs
--
-- A successful cross-community relationship should become easier to repeat
-- without silently carrying prior event authority forward. Partner Programs are
-- durable agreements about *what the two communities want to make easier to
-- discover*. They are not durable permission to expose members at a future
-- event. Every event still requires active partnerships, host instantiation,
-- participant affiliation, participant exchange opt-in, and a real declared fit.

create table if not exists public.community_partner_programs (
  id uuid primary key default gen_random_uuid(),
  community_a_id uuid not null references public.community_partners(id) on delete cascade,
  community_b_id uuid not null references public.community_partners(id) on delete cascade,
  name text not null,
  domains text[] not null,
  proposed_by uuid not null references public.users(id) on delete restrict,
  community_a_approved boolean not null default false,
  community_b_approved boolean not null default false,
  state text not null default 'proposed' check (state in ('proposed','active','paused','retired','declined')),
  proposed_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  check (community_a_id <> community_b_id),
  check (community_a_id::text < community_b_id::text),
  check (char_length(trim(name)) between 4 and 120),
  check (cardinality(domains) between 1 and 6)
);

create unique index if not exists community_partner_program_active_name_idx
  on public.community_partner_programs (community_a_id, community_b_id, lower(name))
  where state in ('proposed','active','paused');
create index if not exists community_partner_program_a_idx
  on public.community_partner_programs (community_a_id, state, updated_at desc);
create index if not exists community_partner_program_b_idx
  on public.community_partner_programs (community_b_id, state, updated_at desc);

alter table public.community_partner_programs enable row level security;
revoke all on public.community_partner_programs from authenticated, anon;

create or replace function public.propose_community_partner_program(
  p_community_one uuid,
  p_community_two uuid,
  p_name text,
  p_domains text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_owner_a uuid;
  v_owner_b uuid;
  v_domains text[];
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_community_one = p_community_two then raise exception 'partner program requires two communities'; end if;
  if p_community_one::text < p_community_two::text then v_a := p_community_one; v_b := p_community_two;
  else v_a := p_community_two; v_b := p_community_one; end if;

  select owner_id into v_owner_a from public.community_partners where id = v_a and state = 'active';
  select owner_id into v_owner_b from public.community_partners where id = v_b and state = 'active';
  if v_owner_a is null or v_owner_b is null then raise exception 'both communities must be active'; end if;
  if auth.uid() not in (v_owner_a, v_owner_b) then raise exception 'community owner scope required'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 4 and 120 then raise exception 'program name must be 4-120 characters'; end if;

  v_domains := array(
    select distinct lower(trim(value)) from unnest(coalesce(p_domains, '{}')) value
    where trim(value) <> '' order by 1
  );
  if cardinality(v_domains) not between 1 and 6 or not public.community_intent_keys_valid(v_domains) then
    raise exception 'program domains must contain one to six supported event-focus domains';
  end if;

  insert into public.community_partner_programs (
    community_a_id,
    community_b_id,
    name,
    domains,
    proposed_by,
    community_a_approved,
    community_b_approved
  ) values (
    v_a,
    v_b,
    trim(p_name),
    v_domains,
    auth.uid(),
    auth.uid() = v_owner_a,
    auth.uid() = v_owner_b
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.respond_to_community_partner_program(
  p_program_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_owner_a uuid;
  v_owner_b uuid;
  v_state text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select p.* into v_program from public.community_partner_programs p where p.id = p_program_id for update;
  if v_program.id is null then raise exception 'partner program not found'; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_program.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_program.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b) then raise exception 'community owner scope required'; end if;
  if v_program.state not in ('proposed','active','paused') then return v_program.state; end if;

  if not p_accept then
    update public.community_partner_programs
    set state = 'declined', retired_at = now(), updated_at = now()
    where id = p_program_id;
    return 'declined';
  end if;

  update public.community_partner_programs p
  set community_a_approved = case when auth.uid() = v_owner_a then true else p.community_a_approved end,
      community_b_approved = case when auth.uid() = v_owner_b then true else p.community_b_approved end,
      updated_at = now()
  where p.id = p_program_id;

  select * into v_program from public.community_partner_programs where id = p_program_id;
  v_state := case when v_program.community_a_approved and v_program.community_b_approved then 'active' else 'proposed' end;
  update public.community_partner_programs
  set state = v_state,
      activated_at = case when v_state = 'active' then coalesce(activated_at, now()) else activated_at end,
      updated_at = now()
  where id = p_program_id;
  return v_state;
end;
$$;

create or replace function public.set_community_partner_program_state(
  p_program_id uuid,
  p_state text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_state not in ('active','paused','retired') then raise exception 'unsupported partner program state'; end if;
  select p.* into v_program from public.community_partner_programs p where p.id = p_program_id for update;
  if v_program.id is null then raise exception 'partner program not found'; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_program.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_program.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b) then raise exception 'community owner scope required'; end if;
  if p_state = 'active' and not (v_program.community_a_approved and v_program.community_b_approved) then
    raise exception 'both owners must approve before activation';
  end if;

  update public.community_partner_programs
  set state = p_state,
      retired_at = case when p_state = 'retired' then now() else null end,
      updated_at = now()
  where id = p_program_id;
  return true;
end;
$$;

create or replace function public.get_my_community_partner_programs()
returns table (
  program_id uuid,
  community_a_id uuid,
  community_a_name text,
  community_b_id uuid,
  community_b_name text,
  name text,
  domains text[],
  state text,
  community_a_approved boolean,
  community_b_approved boolean,
  caller_owns_a boolean,
  caller_owns_b boolean,
  activated_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    a.id,
    a.name,
    b.id,
    b.name,
    p.name,
    p.domains,
    p.state,
    p.community_a_approved,
    p.community_b_approved,
    a.owner_id = auth.uid(),
    b.owner_id = auth.uid(),
    p.activated_at,
    p.updated_at
  from public.community_partner_programs p
  join public.community_partners a on a.id = p.community_a_id
  join public.community_partners b on b.id = p.community_b_id
  where auth.uid() in (a.owner_id, b.owner_id)
  order by case p.state when 'active' then 0 when 'proposed' then 1 when 'paused' then 2 else 3 end,
           p.updated_at desc,
           p.id;
$$;

create or replace function public.get_event_available_partner_programs(p_event_id uuid)
returns table (
  program_id uuid,
  community_a_id uuid,
  community_a_name text,
  community_b_id uuid,
  community_b_name text,
  name text,
  domains text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    a.id,
    a.name,
    b.id,
    b.name,
    p.name,
    p.domains
  from public.community_partner_programs p
  join public.community_partners a on a.id = p.community_a_id
  join public.community_partners b on b.id = p.community_b_id
  where public.is_event_host(p_event_id, auth.uid())
    and public.is_event_operational(p_event_id)
    and p.state = 'active'
    and exists (
      select 1 from public.community_event_partnerships ep
      where ep.event_id = p_event_id and ep.community_id = p.community_a_id and ep.state = 'active'
    )
    and exists (
      select 1 from public.community_event_partnerships ep
      where ep.event_id = p_event_id and ep.community_id = p.community_b_id and ep.state = 'active'
    )
  order by p.updated_at desc, p.id;
$$;

create or replace function public.use_community_partner_program(
  p_event_id uuid,
  p_program_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program public.community_partner_programs;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if not public.is_event_operational(p_event_id) then raise exception 'event is not operational'; end if;

  select p.* into v_program from public.community_partner_programs p where p.id = p_program_id and p.state = 'active';
  if v_program.id is null then raise exception 'active partner program not found'; end if;
  if not exists (
    select 1 from public.community_event_partnerships ep
    where ep.event_id = p_event_id and ep.community_id = v_program.community_a_id and ep.state = 'active'
  ) or not exists (
    select 1 from public.community_event_partnerships ep
    where ep.event_id = p_event_id and ep.community_id = v_program.community_b_id and ep.state = 'active'
  ) then raise exception 'both program communities must be active partners of this event'; end if;

  -- Deliberately create a *proposed* event exchange. Historical program approval
  -- reduces configuration cost but does not carry consent into a new event.
  insert into public.community_exchange_agreements (
    event_id,
    community_a_id,
    community_b_id,
    domains,
    proposed_by,
    community_a_approved,
    community_b_approved,
    state
  ) values (
    p_event_id,
    v_program.community_a_id,
    v_program.community_b_id,
    v_program.domains,
    auth.uid(),
    false,
    false,
    'proposed'
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.propose_community_partner_program(uuid,uuid,text,text[]) from public;
revoke all on function public.respond_to_community_partner_program(uuid,boolean) from public;
revoke all on function public.set_community_partner_program_state(uuid,text) from public;
revoke all on function public.get_my_community_partner_programs() from public;
revoke all on function public.get_event_available_partner_programs(uuid) from public;
revoke all on function public.use_community_partner_program(uuid,uuid) from public;

grant execute on function public.propose_community_partner_program(uuid,uuid,text,text[]) to authenticated;
grant execute on function public.respond_to_community_partner_program(uuid,boolean) to authenticated;
grant execute on function public.set_community_partner_program_state(uuid,text) to authenticated;
grant execute on function public.get_my_community_partner_programs() to authenticated;
grant execute on function public.get_event_available_partner_programs(uuid) to authenticated;
grant execute on function public.use_community_partner_program(uuid,uuid) to authenticated;

comment on table public.community_partner_programs is
  'Reusable bilateral community program configuration. Program approval can reduce future setup cost but never carries member disclosure or event-specific exchange authority into a new event.';
comment on function public.use_community_partner_program(uuid,uuid) is
  'Instantiates an active reusable partner program as a proposed event exchange with both event-specific approvals reset to false.';
