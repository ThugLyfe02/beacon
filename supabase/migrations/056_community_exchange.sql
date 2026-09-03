-- Community exchange rail
--
-- Beacon can partner with professional communities without turning those
-- communities into identity silos, lead lists, or opaque acquisition channels.
-- The unit of interoperability is an explicit event partnership plus a
-- participant-owned event affiliation. Cross-community exchange requires:
--   1) both communities to be active partners of the same event;
--   2) both community owners to approve the exchange;
--   3) each participant to opt into exchange for that event;
--   4) a real pairwise declared-fit domain before a community bridge is shown;
--   5) cohort support before operators receive outcome evidence.
--
-- Direct client reads are intentionally denied. Purpose-built RPC projections
-- prevent a partner from turning Beacon into a cross-community member directory.

create table if not exists public.community_partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text,
  state text not null default 'active' check (state in ('active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 2 and 120),
  check (slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  check (description is null or char_length(description) <= 600)
);

create table if not exists public.community_event_partnerships (
  event_id uuid not null references public.events(id) on delete cascade,
  community_id uuid not null references public.community_partners(id) on delete cascade,
  invited_by uuid not null references public.users(id) on delete restrict,
  state text not null default 'invited' check (state in ('invited','active','declined','retired')),
  goals text[] not null default '{}',
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  primary key (event_id, community_id),
  check (cardinality(goals) <= 6)
);

create table if not exists public.community_event_invite_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  community_id uuid not null references public.community_partners(id) on delete cascade,
  code_hash text not null,
  max_uses integer not null default 100 check (max_uses between 1 and 2000),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= max_uses),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, code_hash),
  check (expires_at > created_at)
);

create table if not exists public.participant_event_community_affiliations (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  community_id uuid not null references public.community_partners(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private','badge')),
  exchange_enabled boolean not null default false,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id, community_id)
);

create table if not exists public.community_exchange_agreements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  community_a_id uuid not null references public.community_partners(id) on delete cascade,
  community_b_id uuid not null references public.community_partners(id) on delete cascade,
  domains text[] not null,
  proposed_by uuid not null references public.users(id) on delete restrict,
  community_a_approved boolean not null default false,
  community_b_approved boolean not null default false,
  state text not null default 'proposed' check (state in ('proposed','active','declined','closed')),
  proposed_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  check (community_a_id <> community_b_id),
  check (community_a_id::text < community_b_id::text),
  check (cardinality(domains) between 1 and 6)
);

create unique index if not exists community_exchange_unique_open_pair_idx
  on public.community_exchange_agreements (event_id, community_a_id, community_b_id)
  where state in ('proposed','active');
create index if not exists community_event_partnerships_event_idx
  on public.community_event_partnerships (event_id, state, community_id);
create index if not exists participant_event_community_user_idx
  on public.participant_event_community_affiliations (user_id, event_id);
create index if not exists participant_event_community_community_idx
  on public.participant_event_community_affiliations (community_id, event_id)
  where exchange_enabled = true;
create index if not exists community_exchange_event_idx
  on public.community_exchange_agreements (event_id, state, activated_at desc);

alter table public.community_partners enable row level security;
alter table public.community_event_partnerships enable row level security;
alter table public.community_event_invite_codes enable row level security;
alter table public.participant_event_community_affiliations enable row level security;
alter table public.community_exchange_agreements enable row level security;

revoke all on public.community_partners from authenticated, anon;
revoke all on public.community_event_partnerships from authenticated, anon;
revoke all on public.community_event_invite_codes from authenticated, anon;
revoke all on public.participant_event_community_affiliations from authenticated, anon;
revoke all on public.community_exchange_agreements from authenticated, anon;

create or replace function public.community_intent_keys_valid(p_keys text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(key = any(array[
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ]::text[])), true)
  from unnest(coalesce(p_keys, '{}')) as key;
$$;

create or replace function public.create_community_partner(
  p_name text,
  p_slug text,
  p_description text default null
)
returns table (
  community_id uuid,
  name text,
  slug text,
  description text,
  state text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_partner public.community_partners;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_slug := lower(trim(coalesce(p_slug, '')));
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'community name must be between 2 and 120 characters';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{2,47}$' then
    raise exception 'community slug must be 3-48 lowercase letters, numbers, or hyphens';
  end if;
  if p_description is not null and char_length(p_description) > 600 then
    raise exception 'community description is too long';
  end if;

  insert into public.community_partners (owner_id, name, slug, description)
  values (auth.uid(), trim(p_name), v_slug, nullif(trim(coalesce(p_description, '')), ''))
  returning * into v_partner;

  return query select
    v_partner.id,
    v_partner.name,
    v_partner.slug,
    v_partner.description,
    v_partner.state,
    v_partner.created_at;
end;
$$;

create or replace function public.get_my_community_partners()
returns table (
  community_id uuid,
  name text,
  slug text,
  description text,
  state text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, c.description, c.state, c.created_at
  from public.community_partners c
  where c.owner_id = auth.uid()
  order by c.created_at desc, c.id;
$$;

create or replace function public.invite_community_partner_to_event(
  p_event_id uuid,
  p_community_slug text,
  p_goals text[] default '{}'
)
returns table (
  event_id uuid,
  community_id uuid,
  community_name text,
  community_slug text,
  state text,
  goals text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community public.community_partners;
  v_goals text[];
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'community partnerships can be invited only while the event is operational';
  end if;

  v_goals := array(
    select distinct lower(trim(value))
    from unnest(coalesce(p_goals, '{}')) value
    where trim(value) <> ''
    order by 1
  );
  if cardinality(v_goals) > 6 or not public.community_intent_keys_valid(v_goals) then
    raise exception 'community goals must use at most six supported event-focus domains';
  end if;

  select c.* into v_community
  from public.community_partners c
  where c.slug = lower(trim(coalesce(p_community_slug, '')))
    and c.state = 'active';
  if v_community.id is null then
    raise exception 'active community partner not found';
  end if;

  insert into public.community_event_partnerships (
    event_id, community_id, invited_by, state, goals
  ) values (
    p_event_id, v_community.id, auth.uid(), 'invited', v_goals
  )
  on conflict (event_id, community_id) do update
  set goals = excluded.goals,
      state = case
        when community_event_partnerships.state = 'declined' then 'invited'
        else community_event_partnerships.state
      end,
      invited_by = auth.uid(),
      invited_at = case
        when community_event_partnerships.state = 'declined' then now()
        else community_event_partnerships.invited_at
      end;

  return query
  select p.event_id, c.id, c.name, c.slug, p.state, p.goals
  from public.community_event_partnerships p
  join public.community_partners c on c.id = p.community_id
  where p.event_id = p_event_id and p.community_id = v_community.id;
end;
$$;

create or replace function public.respond_to_community_event_partnership(
  p_event_id uuid,
  p_community_id uuid,
  p_accept boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  select owner_id into v_owner from public.community_partners where id = p_community_id;
  if v_owner is distinct from auth.uid() then
    raise exception 'community owner scope required';
  end if;

  update public.community_event_partnerships p
  set state = case when p_accept then 'active' else 'declined' end,
      activated_at = case when p_accept then coalesce(p.activated_at, now()) else p.activated_at end,
      retired_at = case when p_accept then null else now() end
  where p.event_id = p_event_id
    and p.community_id = p_community_id
    and p.state in ('invited','declined');

  return found;
end;
$$;

create or replace function public.get_event_community_partnerships(p_event_id uuid)
returns table (
  community_id uuid,
  community_name text,
  community_slug text,
  state text,
  goals text[],
  caller_is_owner boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    c.slug,
    p.state,
    p.goals,
    c.owner_id = auth.uid()
  from public.community_event_partnerships p
  join public.community_partners c on c.id = p.community_id
  where p.event_id = p_event_id
    and (
      p.state = 'active'
      or public.is_event_host(p_event_id, auth.uid())
      or c.owner_id = auth.uid()
    )
    and (
      public.is_event_host(p_event_id, auth.uid())
      or c.owner_id = auth.uid()
      or exists (
        select 1 from public.event_participants ep
        where ep.event_id = p_event_id
          and ep.user_id = auth.uid()
          and ep.status = 'approved'
      )
    )
  order by case p.state when 'active' then 0 when 'invited' then 1 else 2 end, c.name, c.id;
$$;

create or replace function public.create_community_event_invite_code(
  p_event_id uuid,
  p_community_id uuid,
  p_max_uses integer default 100,
  p_valid_minutes integer default 1440
)
returns table (
  invite_id uuid,
  invite_code text,
  expires_at timestamptz,
  max_uses integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_code text;
  v_hash text;
  v_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  select owner_id into v_owner from public.community_partners where id = p_community_id;
  if v_owner is distinct from auth.uid() then
    raise exception 'community owner scope required';
  end if;
  if not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id
      and p.community_id = p_community_id
      and p.state = 'active'
  ) then
    raise exception 'community must be an active event partner';
  end if;
  if p_max_uses not between 1 and 2000 then
    raise exception 'max uses must be between 1 and 2000';
  end if;
  if p_valid_minutes not between 15 and 10080 then
    raise exception 'validity must be between 15 minutes and 7 days';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_hash := encode(digest(v_code, 'sha256'), 'hex');
  v_expires := now() + make_interval(mins => p_valid_minutes);

  insert into public.community_event_invite_codes (
    event_id, community_id, code_hash, max_uses, expires_at, created_by
  ) values (
    p_event_id, p_community_id, v_hash, p_max_uses, v_expires, auth.uid()
  ) returning id into v_id;

  return query select v_id, v_code, v_expires, p_max_uses;
end;
$$;

create or replace function public.claim_event_community_affiliation(
  p_event_id uuid,
  p_invite_code text,
  p_visibility text default 'private',
  p_exchange_enabled boolean default false
)
returns table (
  community_id uuid,
  community_name text,
  community_slug text,
  visibility text,
  exchange_enabled boolean,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invite public.community_event_invite_codes;
  v_affiliation public.participant_event_community_affiliations;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_visibility not in ('private','badge') then
    raise exception 'visibility must be private or badge';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'event is not operational';
  end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'approved event participation required';
  end if;

  v_hash := encode(digest(upper(trim(coalesce(p_invite_code, ''))), 'sha256'), 'hex');
  select i.* into v_invite
  from public.community_event_invite_codes i
  where i.event_id = p_event_id
    and i.code_hash = v_hash
  for update;

  if v_invite.id is null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or v_invite.used_count >= v_invite.max_uses then
    raise exception 'community code is invalid or unavailable';
  end if;
  if not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id
      and p.community_id = v_invite.community_id
      and p.state = 'active'
  ) then
    raise exception 'community is not an active event partner';
  end if;

  insert into public.participant_event_community_affiliations (
    event_id, user_id, community_id, visibility, exchange_enabled
  ) values (
    p_event_id, auth.uid(), v_invite.community_id, p_visibility, coalesce(p_exchange_enabled, false)
  )
  on conflict (event_id, user_id, community_id) do update
  set visibility = excluded.visibility,
      exchange_enabled = excluded.exchange_enabled,
      updated_at = now()
  returning * into v_affiliation;

  update public.community_event_invite_codes
  set used_count = least(max_uses, used_count + 1)
  where id = v_invite.id
    and not exists (
      select 1 from public.participant_event_community_affiliations existing
      where existing.event_id = p_event_id
        and existing.user_id = auth.uid()
        and existing.community_id = v_invite.community_id
        and existing.verified_at < v_affiliation.verified_at
    );

  return query
  select c.id, c.name, c.slug, v_affiliation.visibility,
         v_affiliation.exchange_enabled, v_affiliation.verified_at
  from public.community_partners c
  where c.id = v_affiliation.community_id;
end;
$$;

-- Fix invite usage accounting for idempotent affiliation refreshes. The prior
-- INSERT may update an existing row; usage is incremented only when this user did
-- not already hold the verified affiliation before the claim transaction.
create or replace function public.claim_event_community_affiliation(
  p_event_id uuid,
  p_invite_code text,
  p_visibility text default 'private',
  p_exchange_enabled boolean default false
)
returns table (
  community_id uuid,
  community_name text,
  community_slug text,
  visibility text,
  exchange_enabled boolean,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invite public.community_event_invite_codes;
  v_affiliation public.participant_event_community_affiliations;
  v_already_affiliated boolean;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_visibility not in ('private','badge') then raise exception 'visibility must be private or badge'; end if;
  if not public.is_event_operational(p_event_id) then raise exception 'event is not operational'; end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id and ep.user_id = auth.uid() and ep.status = 'approved'
  ) then raise exception 'approved event participation required'; end if;

  v_hash := encode(digest(upper(trim(coalesce(p_invite_code, ''))), 'sha256'), 'hex');
  select i.* into v_invite
  from public.community_event_invite_codes i
  where i.event_id = p_event_id and i.code_hash = v_hash
  for update;

  if v_invite.id is null or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() or v_invite.used_count >= v_invite.max_uses then
    raise exception 'community code is invalid or unavailable';
  end if;
  if not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id and p.community_id = v_invite.community_id and p.state = 'active'
  ) then raise exception 'community is not an active event partner'; end if;

  select exists (
    select 1 from public.participant_event_community_affiliations a
    where a.event_id = p_event_id and a.user_id = auth.uid() and a.community_id = v_invite.community_id
  ) into v_already_affiliated;

  insert into public.participant_event_community_affiliations (
    event_id, user_id, community_id, visibility, exchange_enabled
  ) values (
    p_event_id, auth.uid(), v_invite.community_id, p_visibility, coalesce(p_exchange_enabled, false)
  )
  on conflict (event_id, user_id, community_id) do update
  set visibility = excluded.visibility,
      exchange_enabled = excluded.exchange_enabled,
      updated_at = now()
  returning * into v_affiliation;

  if not v_already_affiliated then
    update public.community_event_invite_codes
    set used_count = used_count + 1
    where id = v_invite.id;
  end if;

  return query
  select c.id, c.name, c.slug, v_affiliation.visibility,
         v_affiliation.exchange_enabled, v_affiliation.verified_at
  from public.community_partners c where c.id = v_affiliation.community_id;
end;
$$;

create or replace function public.set_my_event_community_affiliation(
  p_event_id uuid,
  p_community_id uuid,
  p_visibility text,
  p_exchange_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_visibility not in ('private','badge') then raise exception 'visibility must be private or badge'; end if;

  update public.participant_event_community_affiliations a
  set visibility = p_visibility,
      exchange_enabled = coalesce(p_exchange_enabled, false),
      updated_at = now()
  where a.event_id = p_event_id
    and a.community_id = p_community_id
    and a.user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.get_my_event_community_affiliations(p_event_id uuid)
returns table (
  community_id uuid,
  community_name text,
  community_slug text,
  visibility text,
  exchange_enabled boolean,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.slug, a.visibility, a.exchange_enabled, a.verified_at
  from public.participant_event_community_affiliations a
  join public.community_partners c on c.id = a.community_id
  where a.event_id = p_event_id and a.user_id = auth.uid()
  order by c.name, c.id;
$$;

create or replace function public.propose_community_exchange(
  p_event_id uuid,
  p_community_one uuid,
  p_community_two uuid,
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
  v_domains text[];
  v_id uuid;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if p_community_one = p_community_two then raise exception 'exchange requires two communities'; end if;
  if p_community_one::text < p_community_two::text then v_a := p_community_one; v_b := p_community_two;
  else v_a := p_community_two; v_b := p_community_one; end if;

  v_domains := array(
    select distinct lower(trim(value)) from unnest(coalesce(p_domains, '{}')) value
    where trim(value) <> '' order by 1
  );
  if cardinality(v_domains) not between 1 and 6 or not public.community_intent_keys_valid(v_domains) then
    raise exception 'exchange domains must contain one to six supported event-focus domains';
  end if;
  if not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id and p.community_id = v_a and p.state = 'active'
  ) or not exists (
    select 1 from public.community_event_partnerships p
    where p.event_id = p_event_id and p.community_id = v_b and p.state = 'active'
  ) then raise exception 'both communities must be active event partners'; end if;

  insert into public.community_exchange_agreements (
    event_id, community_a_id, community_b_id, domains, proposed_by
  ) values (p_event_id, v_a, v_b, v_domains, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.respond_to_community_exchange(
  p_exchange_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exchange public.community_exchange_agreements;
  v_owner_a uuid;
  v_owner_b uuid;
  v_new_state text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select e.* into v_exchange from public.community_exchange_agreements e where e.id = p_exchange_id for update;
  if v_exchange.id is null then raise exception 'community exchange not found'; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_exchange.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_exchange.community_b_id;
  if auth.uid() not in (v_owner_a, v_owner_b) then raise exception 'community owner scope required'; end if;
  if v_exchange.state not in ('proposed','active') then return v_exchange.state; end if;

  if not p_accept then
    update public.community_exchange_agreements
    set state = 'declined', closed_at = now()
    where id = p_exchange_id;
    return 'declined';
  end if;

  update public.community_exchange_agreements e
  set community_a_approved = case when auth.uid() = v_owner_a then true else e.community_a_approved end,
      community_b_approved = case when auth.uid() = v_owner_b then true else e.community_b_approved end
  where e.id = p_exchange_id;

  select * into v_exchange from public.community_exchange_agreements where id = p_exchange_id;
  v_new_state := case when v_exchange.community_a_approved and v_exchange.community_b_approved then 'active' else 'proposed' end;
  update public.community_exchange_agreements
  set state = v_new_state,
      activated_at = case when v_new_state = 'active' then coalesce(activated_at, now()) else activated_at end
  where id = p_exchange_id;
  return v_new_state;
end;
$$;

create or replace function public.get_event_community_exchanges(p_event_id uuid)
returns table (
  exchange_id uuid,
  community_a_id uuid,
  community_a_name text,
  community_b_id uuid,
  community_b_name text,
  domains text[],
  state text,
  community_a_approved boolean,
  community_b_approved boolean,
  caller_can_respond boolean,
  activated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    x.id,
    a.id,
    a.name,
    b.id,
    b.name,
    x.domains,
    x.state,
    x.community_a_approved,
    x.community_b_approved,
    auth.uid() in (a.owner_id, b.owner_id),
    x.activated_at
  from public.community_exchange_agreements x
  join public.community_partners a on a.id = x.community_a_id
  join public.community_partners b on b.id = x.community_b_id
  where x.event_id = p_event_id
    and (
      x.state = 'active'
      or public.is_event_host(p_event_id, auth.uid())
      or auth.uid() in (a.owner_id, b.owner_id)
    )
    and (
      public.is_event_host(p_event_id, auth.uid())
      or auth.uid() in (a.owner_id, b.owner_id)
      or exists (
        select 1 from public.event_participants ep
        where ep.event_id = p_event_id and ep.user_id = auth.uid() and ep.status = 'approved'
      )
    )
  order by case x.state when 'active' then 0 else 1 end, x.proposed_at desc, x.id;
$$;

create or replace function public.get_live_community_bridges(
  p_event_id uuid,
  p_target_ids uuid[]
)
returns table (
  target_id uuid,
  my_community_id uuid,
  my_community_name text,
  target_community_id uuid,
  target_community_name text,
  exchange_id uuid,
  domains text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_operational(p_event_id) then return; end if;
  if cardinality(coalesce(p_target_ids, '{}')) > 40 then raise exception 'target list exceeds live-field bound'; end if;
  if not exists (
    select 1 from public.event_participants ep
    where ep.event_id = p_event_id and ep.user_id = auth.uid() and ep.status = 'approved'
  ) then return; end if;

  return query
  with targets as (
    select distinct unnest(coalesce(p_target_ids, '{}')) as target_id
  ), my_affiliations as (
    select a.community_id
    from public.participant_event_community_affiliations a
    where a.event_id = p_event_id and a.user_id = auth.uid() and a.exchange_enabled = true
  ), target_affiliations as (
    select a.user_id, a.community_id
    from public.participant_event_community_affiliations a
    join targets t on t.target_id = a.user_id
    join public.users u on u.id = a.user_id
    join public.event_participants ep on ep.event_id = p_event_id and ep.user_id = a.user_id and ep.status = 'approved'
    where a.event_id = p_event_id
      and a.exchange_enabled = true
      and a.visibility = 'badge'
      and coalesce(u.is_discoverable, false) = true
      and u.last_location_at >= now() - interval '90 seconds'
      and not exists (
        select 1 from public.user_blocks block
        where (block.blocker_id = auth.uid() and block.blocked_id = a.user_id)
           or (block.blocker_id = a.user_id and block.blocked_id = auth.uid())
      )
  ), pair_candidates as (
    select
      ta.user_id as target_id,
      ma.community_id as my_community_id,
      ta.community_id as target_community_id,
      x.id as exchange_id,
      x.domains as exchange_domains
    from my_affiliations ma
    join target_affiliations ta on ta.community_id <> ma.community_id
    join public.community_exchange_agreements x
      on x.event_id = p_event_id
     and x.state = 'active'
     and ((x.community_a_id = ma.community_id and x.community_b_id = ta.community_id)
       or (x.community_b_id = ma.community_id and x.community_a_id = ta.community_id))
  ), declared as (
    select
      pc.*,
      array(
        select distinct domain
        from (
          select unnest(coalesce(me.seeking, '{}')) as domain
          intersect
          select unnest(coalesce(peer.offering, '{}')) as domain
          union
          select unnest(coalesce(me.offering, '{}')) as domain
          intersect
          select unnest(coalesce(peer.seeking, '{}')) as domain
        ) fit
        where domain = any(pc.exchange_domains)
        order by domain
      ) as fit_domains
    from pair_candidates pc
    join public.participant_event_intents me
      on me.event_id = p_event_id and me.user_id = auth.uid() and me.enabled = true
    join public.participant_event_intents peer
      on peer.event_id = p_event_id and peer.user_id = pc.target_id and peer.enabled = true
  )
  select
    d.target_id,
    d.my_community_id,
    mine.name,
    d.target_community_id,
    theirs.name,
    d.exchange_id,
    d.fit_domains
  from declared d
  join public.community_partners mine on mine.id = d.my_community_id
  join public.community_partners theirs on theirs.id = d.target_community_id
  where cardinality(d.fit_domains) > 0
  order by d.target_id, mine.name, theirs.name, d.exchange_id;
end;
$$;

create or replace function public.get_community_exchange_summary(p_exchange_id uuid)
returns table (
  supported boolean,
  community_a_name text,
  community_b_name text,
  community_a_opted_count integer,
  community_b_opted_count integer,
  cross_community_mutual_count integer,
  declared_fit_mutual_count integer,
  two_way_declared_fit_mutual_count integer,
  declared_fit_share numeric,
  two_way_share numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exchange public.community_exchange_agreements;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  if auth.uid() is null then return; end if;
  select x.* into v_exchange from public.community_exchange_agreements x where x.id = p_exchange_id;
  if v_exchange.id is null then return; end if;
  select owner_id into v_owner_a from public.community_partners where id = v_exchange.community_a_id;
  select owner_id into v_owner_b from public.community_partners where id = v_exchange.community_b_id;
  if not public.is_event_host(v_exchange.event_id, auth.uid()) and auth.uid() not in (v_owner_a, v_owner_b) then return; end if;

  return query
  with counts as (
    select
      (select count(*)::integer from public.participant_event_community_affiliations a
       where a.event_id = v_exchange.event_id and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true) as a_count,
      (select count(*)::integer from public.participant_event_community_affiliations a
       where a.event_id = v_exchange.event_id and a.community_id = v_exchange.community_b_id and a.exchange_enabled = true) as b_count
  ), qualifying_matches as (
    select distinct m.id
    from public.matches m
    where m.event_id = v_exchange.event_id
      and m.created_at >= coalesce(v_exchange.activated_at, v_exchange.proposed_at)
      and (
        (exists (select 1 from public.participant_event_community_affiliations a where a.event_id = m.event_id and a.user_id = m.user_a_id and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true)
         and exists (select 1 from public.participant_event_community_affiliations b where b.event_id = m.event_id and b.user_id = m.user_b_id and b.community_id = v_exchange.community_b_id and b.exchange_enabled = true))
        or
        (exists (select 1 from public.participant_event_community_affiliations b where b.event_id = m.event_id and b.user_id = m.user_a_id and b.community_id = v_exchange.community_b_id and b.exchange_enabled = true)
         and exists (select 1 from public.participant_event_community_affiliations a where a.event_id = m.event_id and a.user_id = m.user_b_id and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true))
      )
  ), outcome as (
    select
      count(q.id)::integer as mutual_count,
      count(c.match_id) filter (where c.fit_class in ('one-way','two-way'))::integer as fit_count,
      count(c.match_id) filter (where c.fit_class = 'two-way')::integer as two_way_count
    from qualifying_matches q
    left join public.declared_fit_mutual_contexts c on c.match_id = q.id
  )
  select
    counts.a_count >= 5 and counts.b_count >= 5,
    ca.name,
    cb.name,
    case when counts.a_count >= 5 and counts.b_count >= 5 then counts.a_count else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 then counts.b_count else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 then outcome.mutual_count else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 then outcome.fit_count else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 then outcome.two_way_count else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 and outcome.mutual_count > 0
      then round(outcome.fit_count::numeric / outcome.mutual_count, 4) else null end,
    case when counts.a_count >= 5 and counts.b_count >= 5 and outcome.fit_count > 0
      then round(outcome.two_way_count::numeric / outcome.fit_count, 4) else null end
  from counts, outcome
  join public.community_partners ca on ca.id = v_exchange.community_a_id
  join public.community_partners cb on cb.id = v_exchange.community_b_id;
end;
$$;

create or replace function public.get_my_community_exchange_portfolio(p_community_id uuid)
returns table (
  ended_event_count integer,
  partner_community_count integer,
  supported_exchange_count integer,
  cross_community_mutual_count integer,
  declared_fit_mutual_count integer,
  latest_event_ended_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.community_partners where id = p_community_id;
  if auth.uid() is null or v_owner is distinct from auth.uid() then return; end if;

  return query
  with ended_partnerships as (
    select p.event_id, e.ended_at
    from public.community_event_partnerships p
    join public.events e on e.id = p.event_id
    where p.community_id = p_community_id and p.state in ('active','retired') and e.ended_at is not null
  ), exchanges as (
    select x.*
    from public.community_exchange_agreements x
    join ended_partnerships ep on ep.event_id = x.event_id
    where x.state in ('active','closed') and p_community_id in (x.community_a_id, x.community_b_id)
  ), supported as (
    select x.id, x.event_id,
      case when x.community_a_id = p_community_id then x.community_b_id else x.community_a_id end as partner_id
    from exchanges x
    where (select count(*) from public.participant_event_community_affiliations a where a.event_id = x.event_id and a.community_id = x.community_a_id and a.exchange_enabled = true) >= 5
      and (select count(*) from public.participant_event_community_affiliations b where b.event_id = x.event_id and b.community_id = x.community_b_id and b.exchange_enabled = true) >= 5
  ), matches as (
    select distinct s.id as exchange_id, m.id as match_id
    from supported s
    join exchanges x on x.id = s.id
    join public.matches m on m.event_id = x.event_id and m.created_at >= coalesce(x.activated_at, x.proposed_at)
    where (
      (exists (select 1 from public.participant_event_community_affiliations a where a.event_id = m.event_id and a.user_id = m.user_a_id and a.community_id = x.community_a_id and a.exchange_enabled = true)
       and exists (select 1 from public.participant_event_community_affiliations b where b.event_id = m.event_id and b.user_id = m.user_b_id and b.community_id = x.community_b_id and b.exchange_enabled = true))
      or
      (exists (select 1 from public.participant_event_community_affiliations b where b.event_id = m.event_id and b.user_id = m.user_a_id and b.community_id = x.community_b_id and b.exchange_enabled = true)
       and exists (select 1 from public.participant_event_community_affiliations a where a.event_id = m.event_id and a.user_id = m.user_b_id and a.community_id = x.community_a_id and a.exchange_enabled = true))
    )
  )
  select
    (select count(distinct event_id)::integer from ended_partnerships),
    (select count(distinct partner_id)::integer from supported),
    (select count(*)::integer from supported),
    (select count(distinct match_id)::integer from matches),
    (select count(distinct m.match_id)::integer from matches m join public.declared_fit_mutual_contexts c on c.match_id = m.match_id where c.fit_class in ('one-way','two-way')),
    (select max(ended_at) from ended_partnerships);
end;
$$;

revoke all on function public.community_intent_keys_valid(text[]) from public;
revoke all on function public.create_community_partner(text,text,text) from public;
revoke all on function public.get_my_community_partners() from public;
revoke all on function public.invite_community_partner_to_event(uuid,text,text[]) from public;
revoke all on function public.respond_to_community_event_partnership(uuid,uuid,boolean) from public;
revoke all on function public.get_event_community_partnerships(uuid) from public;
revoke all on function public.create_community_event_invite_code(uuid,uuid,integer,integer) from public;
revoke all on function public.claim_event_community_affiliation(uuid,text,text,boolean) from public;
revoke all on function public.set_my_event_community_affiliation(uuid,uuid,text,boolean) from public;
revoke all on function public.get_my_event_community_affiliations(uuid) from public;
revoke all on function public.propose_community_exchange(uuid,uuid,uuid,text[]) from public;
revoke all on function public.respond_to_community_exchange(uuid,boolean) from public;
revoke all on function public.get_event_community_exchanges(uuid) from public;
revoke all on function public.get_live_community_bridges(uuid,uuid[]) from public;
revoke all on function public.get_community_exchange_summary(uuid) from public;
revoke all on function public.get_my_community_exchange_portfolio(uuid) from public;

grant execute on function public.create_community_partner(text,text,text) to authenticated;
grant execute on function public.get_my_community_partners() to authenticated;
grant execute on function public.invite_community_partner_to_event(uuid,text,text[]) to authenticated;
grant execute on function public.respond_to_community_event_partnership(uuid,uuid,boolean) to authenticated;
grant execute on function public.get_event_community_partnerships(uuid) to authenticated;
grant execute on function public.create_community_event_invite_code(uuid,uuid,integer,integer) to authenticated;
grant execute on function public.claim_event_community_affiliation(uuid,text,text,boolean) to authenticated;
grant execute on function public.set_my_event_community_affiliation(uuid,uuid,text,boolean) to authenticated;
grant execute on function public.get_my_event_community_affiliations(uuid) to authenticated;
grant execute on function public.propose_community_exchange(uuid,uuid,uuid,text[]) to authenticated;
grant execute on function public.respond_to_community_exchange(uuid,boolean) to authenticated;
grant execute on function public.get_event_community_exchanges(uuid) to authenticated;
grant execute on function public.get_live_community_bridges(uuid,uuid[]) to authenticated;
grant execute on function public.get_community_exchange_summary(uuid) to authenticated;
grant execute on function public.get_my_community_exchange_portfolio(uuid) to authenticated;

comment on table public.community_partners is
  'Partner-managed professional communities. Ownership grants partnership administration, not access to participant behavior or cross-community member graphs.';
comment on table public.participant_event_community_affiliations is
  'Participant-owned, event-scoped verified community affiliation. Badge visibility and cross-community exchange are independent explicit choices.';
comment on table public.community_exchange_agreements is
  'Bilateral community exchange contract. Both community owners must approve before participant bridge context can become active.';
comment on function public.get_live_community_bridges(uuid,uuid[]) is
  'Returns community bridge context only for caller-supplied live targets where both participants opted into exchange, the target opted to show a badge, an active bilateral community exchange exists, and a real declared-fit domain intersects the exchange.';
comment on function public.get_community_exchange_summary(uuid) is
  'Cohort-gated cross-community outcome composition for the event host and the two community owners. It never returns participant identities or the underlying relationship graph.';
comment on function public.get_my_community_exchange_portfolio(uuid) is
  'Owner-private longitudinal evidence for one community across ended Beacon events. Historical evidence is descriptive and does not authorize future participant targeting.';
