-- Warm introductions
--
-- Adds a consent-gated, three-party introduction protocol to Beacon's live
-- event graph. A requester can ask for an introduction to a currently relevant
-- participant only when a third participant has a verified mutual with both
-- sides and has explicitly opted in to broker introductions for that event.
--
-- The requester never receives a list of connectors or a graph-degree score.
-- Beacon selects one available connector deterministically, keeps that identity
-- private until the connector accepts, then gives the target the final decision.
-- No introduction automatically creates a match or connection request.

create table if not exists public.event_introduction_preferences (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  enabled boolean not null default false,
  max_active integer not null default 2 check (max_active between 1 and 4),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.event_introduction_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  connector_id uuid not null references public.users(id) on delete cascade,
  target_id uuid not null references public.users(id) on delete cascade,
  intent_key text not null check (intent_key in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  )),
  status text not null default 'connector-pending' check (status in (
    'connector-pending',
    'target-pending',
    'accepted',
    'declined',
    'cancelled',
    'expired',
    'matched'
  )),
  connector_responded_at timestamptz,
  connector_accepted_at timestamptz,
  target_responded_at timestamptz,
  target_accepted_at timestamptz,
  declined_at timestamptz,
  declined_by text check (declined_by is null or declined_by in ('connector','target')),
  cancelled_at timestamptz,
  accepted_at timestamptz,
  matched_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> connector_id),
  check (requester_id <> target_id),
  check (connector_id <> target_id),
  check (expires_at > created_at),
  check ((connector_accepted_at is null) or connector_responded_at is not null),
  check ((target_accepted_at is null) or target_responded_at is not null),
  check ((accepted_at is null) or target_accepted_at is not null),
  check ((matched_at is null) or accepted_at is not null)
);

create index if not exists event_introduction_preferences_enabled_idx
  on public.event_introduction_preferences (event_id, enabled, updated_at)
  where enabled = true;
create index if not exists event_introduction_requests_event_status_idx
  on public.event_introduction_requests (event_id, status, created_at desc);
create index if not exists event_introduction_requests_requester_idx
  on public.event_introduction_requests (event_id, requester_id, created_at desc);
create index if not exists event_introduction_requests_connector_idx
  on public.event_introduction_requests (event_id, connector_id, status, created_at desc);
create index if not exists event_introduction_requests_target_idx
  on public.event_introduction_requests (event_id, target_id, status, created_at desc);
create unique index if not exists event_introduction_requests_one_active_pair_idx
  on public.event_introduction_requests (event_id, requester_id, target_id)
  where status in ('connector-pending','target-pending','accepted');

alter table public.event_introduction_preferences enable row level security;
alter table public.event_introduction_requests enable row level security;

create policy "introduction_preferences_select_own"
on public.event_introduction_preferences for select
to authenticated
using (user_id = auth.uid());

-- Preferences and requests are written through scoped RPCs. Introduction rows
-- intentionally have no client SELECT policy because the raw record would reveal
-- the connector before the protocol has earned that disclosure.
revoke insert, update, delete on public.event_introduction_preferences from authenticated;
revoke all on public.event_introduction_preferences from anon;
revoke all on public.event_introduction_requests from authenticated, anon;

create or replace function public.event_introduction_pair_blocked(
  p_left_id uuid,
  p_right_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_left_id and b.blocked_id = p_right_id)
       or (b.blocker_id = p_right_id and b.blocked_id = p_left_id)
  );
$$;

create or replace function public.event_introduction_pair_matched(
  p_event_id uuid,
  p_left_id uuid,
  p_right_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    where m.event_id = p_event_id
      and (
        (m.user_a_id = p_left_id and m.user_b_id = p_right_id)
        or (m.user_a_id = p_right_id and m.user_b_id = p_left_id)
      )
  );
$$;

create or replace function public.event_introduction_domains(
  p_event_id uuid,
  p_requester_id uuid,
  p_target_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with requester as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    where i.event_id = p_event_id
      and i.user_id = p_requester_id
      and i.enabled = true
  ), target as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    where i.event_id = p_event_id
      and i.user_id = p_target_id
      and i.enabled = true
  ), overlap as (
    select key
    from requester r
    cross join target t
    cross join lateral unnest(r.seeking) as key
    where key = any(t.offering)
    union
    select key
    from requester r
    cross join target t
    cross join lateral unnest(r.offering) as key
    where key = any(t.seeking)
  )
  select coalesce(array_agg(key order by key), '{}'::text[])
  from overlap;
$$;

create or replace function public.set_my_introduction_preference(
  p_event_id uuid,
  p_enabled boolean,
  p_max_active integer default 2
)
returns table (
  event_id uuid,
  user_id uuid,
  enabled boolean,
  max_active integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'introduction preference can be changed only while the event is operational';
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

  insert into public.event_introduction_preferences (
    event_id,
    user_id,
    enabled,
    max_active,
    updated_at
  ) values (
    p_event_id,
    auth.uid(),
    coalesce(p_enabled, false),
    greatest(1, least(coalesce(p_max_active, 2), 4)),
    now()
  )
  on conflict (event_id, user_id) do update
  set
    enabled = excluded.enabled,
    max_active = excluded.max_active,
    updated_at = now();

  return query
  select
    p.event_id,
    p.user_id,
    p.enabled,
    p.max_active,
    p.updated_at
  from public.event_introduction_preferences p
  where p.event_id = p_event_id
    and p.user_id = auth.uid();
end;
$$;

create or replace function public.get_my_introduction_preference(p_event_id uuid)
returns table (
  event_id uuid,
  user_id uuid,
  enabled boolean,
  max_active integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.event_id,
    p.user_id,
    p.enabled,
    p.max_active,
    p.updated_at
  from public.event_introduction_preferences p
  where p.event_id = p_event_id
    and p.user_id = auth.uid()
    and exists (
      select 1
      from public.event_participants ep
      where ep.event_id = p.event_id
        and ep.user_id = auth.uid()
        and ep.status = 'approved'
    );
$$;

create or replace function public.find_event_introduction_connector(
  p_event_id uuid,
  p_requester_id uuid,
  p_target_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pref.user_id
  from public.event_introduction_preferences pref
  join public.event_participants ep
    on ep.event_id = pref.event_id
   and ep.user_id = pref.user_id
   and ep.status = 'approved'
  join public.users connector on connector.id = pref.user_id
  cross join lateral (
    select count(*)::integer as active_count
    from public.event_introduction_requests active
    where active.event_id = p_event_id
      and active.connector_id = pref.user_id
      and active.status in ('connector-pending','target-pending')
      and active.expires_at > now()
  ) load
  where pref.event_id = p_event_id
    and pref.enabled = true
    and pref.user_id not in (p_requester_id, p_target_id)
    and coalesce(connector.is_discoverable, false) = true
    and load.active_count < pref.max_active
    and public.event_introduction_pair_matched(p_event_id, p_requester_id, pref.user_id)
    and public.event_introduction_pair_matched(p_event_id, pref.user_id, p_target_id)
    and not public.event_introduction_pair_blocked(p_requester_id, pref.user_id)
    and not public.event_introduction_pair_blocked(pref.user_id, p_target_id)
  order by
    load.active_count,
    pref.updated_at,
    pref.user_id
  limit 1;
$$;

create or replace function public.get_warm_introduction_availability(
  p_event_id uuid,
  p_target_id uuid
)
returns table (
  available boolean,
  reason text,
  eligible_domains text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_domains text[] := '{}';
  v_connector_id uuid;
  v_active_count integer;
  v_total_count integer;
begin
  if auth.uid() is null then
    return query select false, 'authentication-required'::text, '{}'::text[];
    return;
  end if;
  if not public.is_event_operational(p_event_id) then
    return query select false, 'event-closed'::text, '{}'::text[];
    return;
  end if;
  if p_target_id is null or p_target_id = auth.uid() then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if not exists (
    select 1
    from public.event_participants me
    where me.event_id = p_event_id
      and me.user_id = auth.uid()
      and me.status = 'approved'
  ) or not exists (
    select 1
    from public.event_participants target_ep
    join public.users target_user on target_user.id = target_ep.user_id
    where target_ep.event_id = p_event_id
      and target_ep.user_id = p_target_id
      and target_ep.status = 'approved'
      and coalesce(target_user.is_discoverable, false) = true
  ) then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if public.event_introduction_pair_blocked(auth.uid(), p_target_id) then
    return query select false, 'target-unavailable'::text, '{}'::text[];
    return;
  end if;
  if public.event_introduction_pair_matched(p_event_id, auth.uid(), p_target_id) then
    return query select false, 'already-connected'::text, '{}'::text[];
    return;
  end if;

  v_domains := public.event_introduction_domains(p_event_id, auth.uid(), p_target_id);
  if cardinality(v_domains) = 0 then
    return query select false, 'no-declared-fit'::text, '{}'::text[];
    return;
  end if;

  if exists (
    select 1
    from public.event_introduction_requests r
    where r.event_id = p_event_id
      and r.requester_id = auth.uid()
      and r.target_id = p_target_id
      and r.status in ('connector-pending','target-pending','accepted')
  ) then
    return query select false, 'already-requested'::text, v_domains;
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid()
    and r.status in ('connector-pending','target-pending','accepted');

  select count(*)::integer into v_total_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid();

  if v_active_count >= 3 or v_total_count >= 6 then
    return query select false, 'request-limit'::text, v_domains;
    return;
  end if;

  v_connector_id := public.find_event_introduction_connector(
    p_event_id,
    auth.uid(),
    p_target_id
  );

  if v_connector_id is null then
    return query select false, 'no-opted-in-connector'::text, v_domains;
    return;
  end if;

  return query select true, 'connector-available'::text, v_domains;
end;
$$;

create or replace function public.request_warm_introduction(
  p_event_id uuid,
  p_target_id uuid,
  p_intent_key text
)
returns table (
  request_id uuid,
  request_status text,
  intent_key text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent_key text;
  v_domains text[] := '{}';
  v_connector_id uuid;
  v_preference public.event_introduction_preferences;
  v_active_connector_count integer;
  v_active_requester_count integer;
  v_total_requester_count integer;
  v_target_pending_count integer;
  v_expires_at timestamptz;
  v_request public.event_introduction_requests;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'warm introductions are available only while the event is operational';
  end if;
  if p_target_id is null or p_target_id = auth.uid() then
    raise exception 'a different target participant is required';
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
  if not exists (
    select 1
    from public.event_participants ep
    join public.users u on u.id = ep.user_id
    where ep.event_id = p_event_id
      and ep.user_id = p_target_id
      and ep.status = 'approved'
      and coalesce(u.is_discoverable, false) = true
  ) then
    raise exception 'target is not available for this event';
  end if;
  if public.event_introduction_pair_blocked(auth.uid(), p_target_id) then
    raise exception 'target is not available for this event';
  end if;
  if public.event_introduction_pair_matched(p_event_id, auth.uid(), p_target_id) then
    raise exception 'you already have a verified mutual with this participant';
  end if;

  v_intent_key := lower(trim(coalesce(p_intent_key, '')));
  v_domains := public.event_introduction_domains(p_event_id, auth.uid(), p_target_id);
  if cardinality(v_domains) = 0 or not (v_intent_key = any(v_domains)) then
    raise exception 'the introduction reason must be part of the current explicit pairwise fit';
  end if;

  if exists (
    select 1
    from public.event_introduction_requests r
    where r.event_id = p_event_id
      and r.requester_id = auth.uid()
      and r.target_id = p_target_id
      and r.status in ('connector-pending','target-pending','accepted')
  ) then
    raise exception 'an introduction request is already active for this participant';
  end if;

  select count(*)::integer into v_active_requester_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid()
    and r.status in ('connector-pending','target-pending','accepted');

  select count(*)::integer into v_total_requester_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.requester_id = auth.uid();

  select count(*)::integer into v_target_pending_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.target_id = p_target_id
    and r.status = 'target-pending'
    and r.expires_at > now();

  if v_active_requester_count >= 3 then
    raise exception 'finish or close an active introduction before requesting another';
  end if;
  if v_total_requester_count >= 6 then
    raise exception 'event introduction request limit reached';
  end if;
  if v_target_pending_count >= 6 then
    raise exception 'this participant already has too many introduction decisions waiting';
  end if;

  v_connector_id := public.find_event_introduction_connector(
    p_event_id,
    auth.uid(),
    p_target_id
  );
  if v_connector_id is null then
    raise exception 'no opted-in mutual connector is available right now';
  end if;

  select * into v_preference
  from public.event_introduction_preferences pref
  where pref.event_id = p_event_id
    and pref.user_id = v_connector_id
    and pref.enabled = true
  for update;

  if v_preference.user_id is null then
    raise exception 'the selected connector is no longer available';
  end if;

  select count(*)::integer into v_active_connector_count
  from public.event_introduction_requests r
  where r.event_id = p_event_id
    and r.connector_id = v_connector_id
    and r.status in ('connector-pending','target-pending')
    and r.expires_at > now();

  if v_active_connector_count >= v_preference.max_active then
    raise exception 'no opted-in mutual connector is available right now';
  end if;

  select least(
    coalesce(e.ends_at, now() + interval '45 minutes'),
    now() + interval '45 minutes'
  ) into v_expires_at
  from public.events e
  where e.id = p_event_id;

  if v_expires_at is null or v_expires_at <= now() + interval '5 minutes' then
    raise exception 'the event is too close to ending for a new introduction request';
  end if;

  begin
    insert into public.event_introduction_requests (
      event_id,
      requester_id,
      connector_id,
      target_id,
      intent_key,
      status,
      expires_at
    ) values (
      p_event_id,
      auth.uid(),
      v_connector_id,
      p_target_id,
      v_intent_key,
      'connector-pending',
      v_expires_at
    )
    returning * into v_request;
  exception
    when unique_violation then
      raise exception 'an introduction request is already active for this participant';
  end;

  return query select
    v_request.id,
    v_request.status,
    v_request.intent_key,
    v_request.expires_at;
end;
$$;

create or replace function public.get_my_event_introductions(p_event_id uuid)
returns table (
  request_id uuid,
  event_id uuid,
  participant_role text,
  request_status text,
  intent_key text,
  requester_id uuid,
  requester_name text,
  requester_role text,
  requester_one_liner text,
  connector_id uuid,
  connector_name text,
  connector_role text,
  target_id uuid,
  target_name text,
  target_role text,
  target_one_liner text,
  created_at timestamptz,
  expires_at timestamptz,
  connector_accepted_at timestamptz,
  target_accepted_at timestamptz,
  matched_at timestamptz,
  can_accept boolean,
  can_decline boolean,
  can_cancel boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.event_introduction_requests r
  set
    status = 'expired',
    updated_at = now()
  where r.event_id = p_event_id
    and r.status in ('connector-pending','target-pending')
    and r.expires_at <= now();

  return query
  select
    r.id,
    r.event_id,
    case
      when auth.uid() = r.requester_id then 'requester'
      when auth.uid() = r.connector_id then 'connector'
      else 'target'
    end,
    r.status,
    r.intent_key,
    r.requester_id,
    requester.name,
    requester.role,
    requester.one_liner,
    case
      when auth.uid() = r.connector_id
        or r.status in ('target-pending','accepted','matched')
      then r.connector_id
      else null::uuid
    end,
    case
      when auth.uid() = r.connector_id
        or r.status in ('target-pending','accepted','matched')
      then connector.name
      else null::text
    end,
    case
      when auth.uid() = r.connector_id
        or r.status in ('target-pending','accepted','matched')
      then connector.role
      else null::text
    end,
    r.target_id,
    target.name,
    target.role,
    target.one_liner,
    r.created_at,
    r.expires_at,
    r.connector_accepted_at,
    r.target_accepted_at,
    r.matched_at,
    (auth.uid() = r.connector_id and r.status = 'connector-pending')
      or (auth.uid() = r.target_id and r.status = 'target-pending'),
    (auth.uid() = r.connector_id and r.status = 'connector-pending')
      or (auth.uid() = r.target_id and r.status = 'target-pending'),
    auth.uid() = r.requester_id
      and r.status in ('connector-pending','target-pending')
  from public.event_introduction_requests r
  join public.users requester on requester.id = r.requester_id
  join public.users connector on connector.id = r.connector_id
  join public.users target on target.id = r.target_id
  where r.event_id = p_event_id
    and auth.uid() in (r.requester_id, r.connector_id, r.target_id)
    and not (auth.uid() = r.target_id and r.status = 'connector-pending')
    and not public.event_introduction_pair_blocked(r.requester_id, r.target_id)
    and not public.event_introduction_pair_blocked(r.requester_id, r.connector_id)
    and not public.event_introduction_pair_blocked(r.connector_id, r.target_id)
  order by
    case r.status
      when 'target-pending' then 0
      when 'connector-pending' then 1
      when 'accepted' then 2
      when 'matched' then 3
      else 4
    end,
    r.created_at desc,
    r.id
  limit 60;
end;
$$;

create or replace function public.respond_to_warm_introduction(
  p_request_id uuid,
  p_accept boolean
)
returns table (
  request_id uuid,
  request_status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.event_introduction_requests;
  v_extended_expiry timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into v_request
  from public.event_introduction_requests r
  where r.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'introduction request not found';
  end if;

  if v_request.expires_at <= now()
     and v_request.status in ('connector-pending','target-pending') then
    update public.event_introduction_requests r
    set status = 'expired', updated_at = now()
    where r.id = v_request.id
    returning * into v_request;
    return query select v_request.id, v_request.status, v_request.expires_at;
    return;
  end if;

  if not public.is_event_operational(v_request.event_id) then
    raise exception 'event is no longer operational';
  end if;

  if public.event_introduction_pair_blocked(v_request.requester_id, v_request.target_id)
     or public.event_introduction_pair_blocked(v_request.requester_id, v_request.connector_id)
     or public.event_introduction_pair_blocked(v_request.connector_id, v_request.target_id) then
    update public.event_introduction_requests r
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where r.id = v_request.id
    returning * into v_request;
    return query select v_request.id, v_request.status, v_request.expires_at;
    return;
  end if;

  if auth.uid() = v_request.connector_id then
    if v_request.status <> 'connector-pending' then
      raise exception 'connector decision is no longer available';
    end if;

    update public.event_introduction_requests r
    set
      status = case when coalesce(p_accept, false) then 'target-pending' else 'declined' end,
      connector_responded_at = now(),
      connector_accepted_at = case when coalesce(p_accept, false) then now() else null end,
      declined_at = case when coalesce(p_accept, false) then null else now() end,
      declined_by = case when coalesce(p_accept, false) then null else 'connector' end,
      updated_at = now()
    where r.id = v_request.id
    returning * into v_request;

    return query select v_request.id, v_request.status, v_request.expires_at;
    return;
  end if;

  if auth.uid() = v_request.target_id then
    if v_request.status <> 'target-pending' then
      raise exception 'target decision is no longer available';
    end if;

    if coalesce(p_accept, false) then
      select least(
        coalesce(e.ends_at, now() + interval '2 hours'),
        now() + interval '2 hours'
      ) into v_extended_expiry
      from public.events e
      where e.id = v_request.event_id;

      update public.event_introduction_requests r
      set
        status = 'accepted',
        target_responded_at = now(),
        target_accepted_at = now(),
        accepted_at = now(),
        expires_at = greatest(r.expires_at, v_extended_expiry),
        updated_at = now()
      where r.id = v_request.id
      returning * into v_request;

      insert into public.vault_entries (
        event_id,
        user_id,
        kind,
        source_id,
        subject_user_id,
        identity_revealed,
        title,
        detail,
        next_action,
        metadata,
        visible_until
      ) values
        (
          v_request.event_id,
          v_request.requester_id,
          'next_action',
          v_request.id,
          v_request.target_id,
          true,
          'Warm introduction accepted',
          'An opted-in mutual connector opened a consented introduction around ' || replace(v_request.intent_key, '-', ' ') || '.',
          'Open the introduction inbox and choose a real next step.',
          jsonb_build_object('origin', 'warm-introduction', 'intentKey', v_request.intent_key),
          now() + interval '7 days'
        ),
        (
          v_request.event_id,
          v_request.target_id,
          'next_action',
          v_request.id,
          v_request.requester_id,
          true,
          'Warm introduction accepted',
          'An opted-in mutual connector opened a consented introduction around ' || replace(v_request.intent_key, '-', ' ') || '.',
          'Open the introduction inbox and choose a real next step.',
          jsonb_build_object('origin', 'warm-introduction', 'intentKey', v_request.intent_key),
          now() + interval '7 days'
        )
      on conflict (user_id, event_id, kind, source_id) do update
      set
        subject_user_id = excluded.subject_user_id,
        identity_revealed = true,
        title = excluded.title,
        detail = excluded.detail,
        next_action = excluded.next_action,
        metadata = excluded.metadata,
        visible_until = excluded.visible_until,
        status = 'open',
        updated_at = now();
    else
      update public.event_introduction_requests r
      set
        status = 'declined',
        target_responded_at = now(),
        declined_at = now(),
        declined_by = 'target',
        updated_at = now()
      where r.id = v_request.id
      returning * into v_request;
    end if;

    return query select v_request.id, v_request.status, v_request.expires_at;
    return;
  end if;

  raise exception 'only the assigned connector or target may respond';
end;
$$;

create or replace function public.cancel_my_warm_introduction(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.event_introduction_requests r
  set
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
  where r.id = p_request_id
    and r.requester_id = auth.uid()
    and r.status in ('connector-pending','target-pending');

  return found;
end;
$$;

create or replace function public.mark_warm_introduction_matched()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_ids uuid[] := '{}';
begin
  with updated as (
    update public.event_introduction_requests r
    set
      status = 'matched',
      matched_at = coalesce(r.matched_at, coalesce(new.created_at, now())),
      updated_at = now()
    where r.event_id = new.event_id
      and r.status = 'accepted'
      and (
        (r.requester_id = new.user_a_id and r.target_id = new.user_b_id)
        or (r.requester_id = new.user_b_id and r.target_id = new.user_a_id)
      )
    returning r.id
  )
  select coalesce(array_agg(id), '{}'::uuid[])
    into v_request_ids
  from updated;

  if cardinality(v_request_ids) > 0 then
    update public.vault_entries v
    set status = 'completed', updated_at = now()
    where v.source_id = any(v_request_ids)
      and v.kind = 'next_action';
  end if;

  return new;
end;
$$;

drop trigger if exists mark_warm_introduction_after_match on public.matches;
create trigger mark_warm_introduction_after_match
after insert on public.matches
for each row execute function public.mark_warm_introduction_matched();

create or replace function public.expire_warm_introductions_on_event_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ended_at is null and new.ended_at is not null then
    update public.event_introduction_requests r
    set status = 'expired', updated_at = new.ended_at
    where r.event_id = new.id
      and r.status in ('connector-pending','target-pending');
  end if;
  return new;
end;
$$;

drop trigger if exists expire_warm_introductions_after_event_end on public.events;
create trigger expire_warm_introductions_after_event_end
after update of ended_at on public.events
for each row execute function public.expire_warm_introductions_on_event_end();

create or replace function public.get_event_introduction_summary(p_event_id uuid)
returns table (
  supported boolean,
  total_requests integer,
  connector_accepts integer,
  target_accepts integer,
  matched_introductions integer,
  connector_accept_rate numeric,
  target_accept_rate numeric,
  match_after_accept_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_connector_accepts integer;
  v_target_accepts integer;
  v_matched integer;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where r.connector_accepted_at is not null)::integer,
    count(*) filter (where r.target_accepted_at is not null)::integer,
    count(*) filter (where r.matched_at is not null)::integer
  into
    v_total,
    v_connector_accepts,
    v_target_accepts,
    v_matched
  from public.event_introduction_requests r
  where r.event_id = p_event_id;

  if coalesce(v_total, 0) < 5 then
    return query select
      false,
      null::integer,
      null::integer,
      null::integer,
      null::integer,
      null::numeric,
      null::numeric,
      null::numeric;
    return;
  end if;

  return query select
    true,
    v_total,
    v_connector_accepts,
    v_target_accepts,
    v_matched,
    v_connector_accepts::numeric / greatest(1, v_total),
    v_target_accepts::numeric / greatest(1, v_connector_accepts),
    v_matched::numeric / greatest(1, v_target_accepts);
end;
$$;

create or replace function public.get_event_introduction_domains(p_event_id uuid)
returns table (
  intent_key text,
  request_count integer,
  connector_accept_count integer,
  target_accept_count integer,
  matched_count integer,
  match_after_accept_rate numeric
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
  with grouped as (
    select
      r.intent_key,
      count(*)::integer as request_count,
      count(*) filter (where r.connector_accepted_at is not null)::integer as connector_accept_count,
      count(*) filter (where r.target_accepted_at is not null)::integer as target_accept_count,
      count(*) filter (where r.matched_at is not null)::integer as matched_count
    from public.event_introduction_requests r
    where r.event_id = p_event_id
    group by r.intent_key
  )
  select
    g.intent_key,
    g.request_count,
    g.connector_accept_count,
    g.target_accept_count,
    g.matched_count,
    g.matched_count::numeric / greatest(1, g.target_accept_count)
  from grouped g
  where g.request_count >= 5
  order by g.matched_count desc, g.target_accept_count desc, g.request_count desc, g.intent_key;
end;
$$;

revoke all on function public.event_introduction_pair_blocked(uuid,uuid) from public;
revoke all on function public.event_introduction_pair_matched(uuid,uuid,uuid) from public;
revoke all on function public.event_introduction_domains(uuid,uuid,uuid) from public;
revoke all on function public.find_event_introduction_connector(uuid,uuid,uuid) from public;
revoke all on function public.set_my_introduction_preference(uuid,boolean,integer) from public;
revoke all on function public.get_my_introduction_preference(uuid) from public;
revoke all on function public.get_warm_introduction_availability(uuid,uuid) from public;
revoke all on function public.request_warm_introduction(uuid,uuid,text) from public;
revoke all on function public.get_my_event_introductions(uuid) from public;
revoke all on function public.respond_to_warm_introduction(uuid,boolean) from public;
revoke all on function public.cancel_my_warm_introduction(uuid) from public;
revoke all on function public.mark_warm_introduction_matched() from public;
revoke all on function public.expire_warm_introductions_on_event_end() from public;
revoke all on function public.get_event_introduction_summary(uuid) from public;
revoke all on function public.get_event_introduction_domains(uuid) from public;

grant execute on function public.set_my_introduction_preference(uuid,boolean,integer) to authenticated;
grant execute on function public.get_my_introduction_preference(uuid) to authenticated;
grant execute on function public.get_warm_introduction_availability(uuid,uuid) to authenticated;
grant execute on function public.request_warm_introduction(uuid,uuid,text) to authenticated;
grant execute on function public.get_my_event_introductions(uuid) to authenticated;
grant execute on function public.respond_to_warm_introduction(uuid,boolean) to authenticated;
grant execute on function public.cancel_my_warm_introduction(uuid) to authenticated;
grant execute on function public.get_event_introduction_summary(uuid) to authenticated;
grant execute on function public.get_event_introduction_domains(uuid) to authenticated;

comment on table public.event_introduction_preferences is
  'Event-scoped participant choice to broker a bounded number of warm introductions. A preference never exposes the participant connection graph.';
comment on table public.event_introduction_requests is
  'Three-party, consent-gated introduction state. Requesters do not receive connector identity until connector acceptance, and target acceptance never auto-creates a match.';
comment on function public.request_warm_introduction(uuid,uuid,text) is
  'Creates one bounded request using a deterministic opted-in connector with verified mutual edges to both sides. No connector list, graph-degree score, free-text pitch, or automatic match is produced.';
comment on function public.get_event_introduction_summary(uuid) is
  'Host-only cohort-gated introduction funnel with real persisted denominators and no participant identities.';
