-- Event focus windows
--
-- Turns cohort-gated declared event demand into a real, host-published place and
-- time that relevant participants can explicitly opt into. The host never gets
-- a list of people merely because they declared a domain. Identity enters the
-- window only through the participant's own opt-in, and host reads remain
-- aggregate-only. Window outcomes are observational and cohort-gated.

create table if not exists public.event_focus_windows (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  intent_key text not null check (intent_key in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  )),
  format text not null check (format in (
    'roundtable','office-hours','mentor-desk','open-circle'
  )),
  title text not null,
  location_label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 4 and 80),
  state text not null default 'published' check (state in (
    'published','closed','cancelled'
  )),
  closed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '90 minutes'),
  check (char_length(trim(title)) between 4 and 120),
  check (char_length(trim(location_label)) between 2 and 120),
  check ((state <> 'closed') or closed_at is not null),
  check ((state <> 'cancelled') or cancelled_at is not null)
);

create table if not exists public.event_focus_window_opt_ins (
  window_id uuid not null references public.event_focus_windows(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (window_id, user_id)
);

create index if not exists event_focus_windows_event_time_idx
  on public.event_focus_windows (event_id, starts_at, ends_at)
  where state = 'published';
create index if not exists event_focus_window_opt_ins_event_idx
  on public.event_focus_window_opt_ins (event_id, window_id);
create index if not exists event_focus_window_opt_ins_user_idx
  on public.event_focus_window_opt_ins (user_id, event_id);

alter table public.event_focus_windows enable row level security;
alter table public.event_focus_window_opt_ins enable row level security;

-- Neither table is a client-readable roster. All participant and host views are
-- purpose-built projections. This prevents a host from discovering who declared
-- a domain before those people explicitly opt into a published window.
revoke all on public.event_focus_windows from authenticated, anon;
revoke all on public.event_focus_window_opt_ins from authenticated, anon;

create or replace function public.create_event_focus_window(
  p_event_id uuid,
  p_intent_key text,
  p_format text,
  p_title text,
  p_location_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer
)
returns table (
  window_id uuid,
  event_id uuid,
  intent_key text,
  format text,
  title text,
  location_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  state text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_intent_key text;
  v_format text;
  v_supported_contributors integer;
  v_open_windows integer;
  v_window public.event_focus_windows;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'focus windows can be published only while the event is operational';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    raise exception 'event not found';
  end if;

  v_intent_key := lower(trim(coalesce(p_intent_key, '')));
  v_format := lower(trim(coalesce(p_format, '')));

  if v_intent_key not in (
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ) then
    raise exception 'unsupported event-focus domain';
  end if;
  if v_format not in ('roundtable','office-hours','mentor-desk','open-circle') then
    raise exception 'unsupported focus-window format';
  end if;
  if p_capacity not between 4 and 80 then
    raise exception 'capacity must be between 4 and 80';
  end if;
  if p_starts_at < now() - interval '2 minutes' then
    raise exception 'focus window cannot start materially in the past';
  end if;
  if p_ends_at <= p_starts_at + interval '10 minutes'
     or p_ends_at > p_starts_at + interval '90 minutes' then
    raise exception 'focus window duration must be greater than 10 and no more than 90 minutes';
  end if;
  if v_event.ends_at is not null and p_ends_at > v_event.ends_at then
    raise exception 'focus window must end before the event ends';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 4 and 120 then
    raise exception 'title must be between 4 and 120 characters';
  end if;
  if char_length(trim(coalesce(p_location_label, ''))) not between 2 and 120 then
    raise exception 'location label must be between 2 and 120 characters';
  end if;

  select count(*)::integer into v_supported_contributors
  from public.participant_event_intents i
  join public.event_participants ep
    on ep.event_id = i.event_id
   and ep.user_id = i.user_id
   and ep.status = 'approved'
  where i.event_id = p_event_id
    and i.enabled = true
    and (
      v_intent_key = any(i.seeking)
      or v_intent_key = any(i.offering)
    );

  if v_supported_contributors < 5 then
    raise exception 'focus window requires a released aggregate cohort of at least five declaring participants';
  end if;

  select count(*)::integer into v_open_windows
  from public.event_focus_windows w
  where w.event_id = p_event_id
    and w.state = 'published'
    and w.ends_at > now();

  if v_open_windows >= 12 then
    raise exception 'close or finish an existing focus window before publishing another';
  end if;

  insert into public.event_focus_windows (
    event_id,
    created_by,
    intent_key,
    format,
    title,
    location_label,
    starts_at,
    ends_at,
    capacity
  ) values (
    p_event_id,
    auth.uid(),
    v_intent_key,
    v_format,
    trim(p_title),
    trim(p_location_label),
    p_starts_at,
    p_ends_at,
    p_capacity
  )
  returning * into v_window;

  return query
  select
    v_window.id,
    v_window.event_id,
    v_window.intent_key,
    v_window.format,
    v_window.title,
    v_window.location_label,
    v_window.starts_at,
    v_window.ends_at,
    v_window.capacity,
    v_window.state,
    v_window.created_at;
end;
$$;

create or replace function public.get_my_event_focus_windows(p_event_id uuid)
returns table (
  window_id uuid,
  event_id uuid,
  intent_key text,
  format text,
  title text,
  location_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  joined_count integer,
  spots_remaining integer,
  is_joined boolean,
  relevance text,
  phase text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_operational(p_event_id) then
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

  return query
  with mine as (
    select i.seeking, i.offering
    from public.participant_event_intents i
    where i.event_id = p_event_id
      and i.user_id = auth.uid()
      and i.enabled = true
  ), counts as (
    select o.window_id, count(*)::integer as joined_count
    from public.event_focus_window_opt_ins o
    where o.event_id = p_event_id
    group by o.window_id
  )
  select
    w.id,
    w.event_id,
    w.intent_key,
    w.format,
    w.title,
    w.location_label,
    w.starts_at,
    w.ends_at,
    w.capacity,
    coalesce(c.joined_count, 0),
    greatest(0, w.capacity - coalesce(c.joined_count, 0)),
    exists (
      select 1
      from public.event_focus_window_opt_ins mine_opt_in
      where mine_opt_in.window_id = w.id
        and mine_opt_in.user_id = auth.uid()
    ),
    case
      when w.intent_key = any(m.seeking) and w.intent_key = any(m.offering) then 'both'
      when w.intent_key = any(m.seeking) then 'seeking'
      else 'offering'
    end,
    case when now() < w.starts_at then 'upcoming' else 'live' end
  from public.event_focus_windows w
  cross join mine m
  left join counts c on c.window_id = w.id
  where w.event_id = p_event_id
    and w.state = 'published'
    and w.ends_at > now()
    and (
      w.intent_key = any(m.seeking)
      or w.intent_key = any(m.offering)
    )
  order by
    case when now() between w.starts_at and w.ends_at then 0 else 1 end,
    w.starts_at,
    w.id
  limit 24;
end;
$$;

create or replace function public.set_my_event_focus_window_opt_in(
  p_window_id uuid,
  p_join boolean
)
returns table (
  window_id uuid,
  joined_count integer,
  spots_remaining integer,
  is_joined boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window public.event_focus_windows;
  v_joined_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.* into v_window
  from public.event_focus_windows w
  where w.id = p_window_id
  for update;

  if v_window.id is null then
    raise exception 'focus window not found';
  end if;
  if v_window.state <> 'published' or v_window.ends_at <= now() then
    raise exception 'focus window is no longer open';
  end if;
  if not public.is_event_operational(v_window.event_id) then
    raise exception 'event is no longer operational';
  end if;
  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = v_window.event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'approved event participation required';
  end if;
  if not exists (
    select 1
    from public.participant_event_intents i
    where i.event_id = v_window.event_id
      and i.user_id = auth.uid()
      and i.enabled = true
      and (
        v_window.intent_key = any(i.seeking)
        or v_window.intent_key = any(i.offering)
      )
  ) then
    raise exception 'this window is not part of your current explicit event focus';
  end if;

  if coalesce(p_join, false) then
    if not exists (
      select 1
      from public.event_focus_window_opt_ins o
      where o.window_id = v_window.id
        and o.user_id = auth.uid()
    ) then
      select count(*)::integer into v_joined_count
      from public.event_focus_window_opt_ins o
      where o.window_id = v_window.id;

      if v_joined_count >= v_window.capacity then
        raise exception 'focus window is at capacity';
      end if;

      insert into public.event_focus_window_opt_ins (
        window_id,
        event_id,
        user_id
      ) values (
        v_window.id,
        v_window.event_id,
        auth.uid()
      );
    end if;
  else
    delete from public.event_focus_window_opt_ins o
    where o.window_id = v_window.id
      and o.user_id = auth.uid();
  end if;

  select count(*)::integer into v_joined_count
  from public.event_focus_window_opt_ins o
  where o.window_id = v_window.id;

  return query
  select
    v_window.id,
    v_joined_count,
    greatest(0, v_window.capacity - v_joined_count),
    exists (
      select 1
      from public.event_focus_window_opt_ins mine
      where mine.window_id = v_window.id
        and mine.user_id = auth.uid()
    );
end;
$$;

create or replace function public.get_host_event_focus_windows(p_event_id uuid)
returns table (
  window_id uuid,
  event_id uuid,
  intent_key text,
  format text,
  title text,
  location_label text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  joined_count integer,
  state text,
  phase text,
  created_at timestamptz
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
  select
    w.id,
    w.event_id,
    w.intent_key,
    w.format,
    w.title,
    w.location_label,
    w.starts_at,
    w.ends_at,
    w.capacity,
    count(o.user_id)::integer,
    w.state,
    case
      when w.state = 'cancelled' then 'cancelled'
      when w.state = 'closed' then 'closed'
      when now() < w.starts_at then 'upcoming'
      when now() <= w.ends_at then 'live'
      else 'ended'
    end,
    w.created_at
  from public.event_focus_windows w
  left join public.event_focus_window_opt_ins o on o.window_id = w.id
  where w.event_id = p_event_id
  group by w.id
  order by w.starts_at desc, w.id
  limit 40;
end;
$$;

create or replace function public.set_host_event_focus_window_state(
  p_window_id uuid,
  p_state text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window public.event_focus_windows;
  v_state text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.* into v_window
  from public.event_focus_windows w
  where w.id = p_window_id
  for update;

  if v_window.id is null then
    raise exception 'focus window not found';
  end if;
  if not public.is_event_host(v_window.event_id, auth.uid()) then
    raise exception 'event host scope required';
  end if;

  v_state := lower(trim(coalesce(p_state, '')));
  if v_state not in ('closed','cancelled') then
    raise exception 'focus window can only be closed or cancelled';
  end if;
  if v_window.state <> 'published' then
    return true;
  end if;

  update public.event_focus_windows w
  set
    state = v_state,
    closed_at = case when v_state = 'closed' then now() else w.closed_at end,
    cancelled_at = case when v_state = 'cancelled' then now() else w.cancelled_at end,
    updated_at = now()
  where w.id = p_window_id;

  return true;
end;
$$;

create or replace function public.get_host_event_focus_window_outcomes(p_event_id uuid)
returns table (
  window_id uuid,
  supported boolean,
  opt_in_count integer,
  new_mutual_count integer,
  participants_with_new_mutuals integer,
  participant_outcome_share numeric,
  observation_ends_at timestamptz
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
  with windows as (
    select
      w.*,
      coalesce(w.closed_at, w.ends_at) + interval '30 minutes' as observation_ends_at
    from public.event_focus_windows w
    where w.event_id = p_event_id
      and w.state <> 'cancelled'
      and (w.state = 'closed' or w.ends_at <= now())
  ), opt_in_counts as (
    select
      w.id as window_id,
      count(o.user_id)::integer as opt_in_count
    from windows w
    left join public.event_focus_window_opt_ins o on o.window_id = w.id
    group by w.id
  ), qualifying_matches as (
    select distinct
      w.id as window_id,
      m.id as match_id,
      m.user_a_id,
      m.user_b_id
    from windows w
    join public.matches m
      on m.event_id = w.event_id
     and m.created_at >= w.starts_at
     and m.created_at <= w.observation_ends_at
    where exists (
      select 1
      from public.event_focus_window_opt_ins a
      where a.window_id = w.id
        and a.user_id = m.user_a_id
    )
      and exists (
        select 1
        from public.event_focus_window_opt_ins b
        where b.window_id = w.id
          and b.user_id = m.user_b_id
      )
  ), match_counts as (
    select q.window_id, count(distinct q.match_id)::integer as new_mutual_count
    from qualifying_matches q
    group by q.window_id
  ), participant_counts as (
    select p.window_id, count(distinct p.user_id)::integer as participants_with_new_mutuals
    from (
      select q.window_id, q.user_a_id as user_id from qualifying_matches q
      union all
      select q.window_id, q.user_b_id as user_id from qualifying_matches q
    ) p
    group by p.window_id
  )
  select
    w.id,
    c.opt_in_count >= 5,
    case when c.opt_in_count >= 5 then c.opt_in_count else null end,
    case when c.opt_in_count >= 5 then coalesce(mc.new_mutual_count, 0) else null end,
    case when c.opt_in_count >= 5 then coalesce(pc.participants_with_new_mutuals, 0) else null end,
    case
      when c.opt_in_count >= 5
      then round(coalesce(pc.participants_with_new_mutuals, 0)::numeric / greatest(1, c.opt_in_count), 4)
      else null
    end,
    w.observation_ends_at
  from windows w
  join opt_in_counts c on c.window_id = w.id
  left join match_counts mc on mc.window_id = w.id
  left join participant_counts pc on pc.window_id = w.id
  order by w.starts_at desc, w.id;
end;
$$;

create or replace function public.get_my_focus_window_playbook()
returns table (
  intent_key text,
  format text,
  supported_window_count integer,
  event_count integer,
  opt_in_count integer,
  participants_with_new_mutuals integer,
  participant_outcome_share numeric,
  evidence_weight numeric,
  latest_window_at timestamptz
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

  return query
  with hosted_windows as (
    select
      w.*,
      coalesce(w.closed_at, w.ends_at) + interval '30 minutes' as observation_ends_at
    from public.event_focus_windows w
    join public.events e on e.id = w.event_id
    where e.host_id = auth.uid()
      and e.ended_at is not null
      and w.state <> 'cancelled'
      and (w.state = 'closed' or w.ends_at <= now())
  ), window_counts as (
    select
      w.id,
      w.event_id,
      w.intent_key,
      w.format,
      w.starts_at,
      w.observation_ends_at,
      count(o.user_id)::integer as opt_in_count
    from hosted_windows w
    left join public.event_focus_window_opt_ins o on o.window_id = w.id
    group by w.id, w.event_id, w.intent_key, w.format, w.starts_at, w.observation_ends_at
  ), supported_windows as (
    select * from window_counts where opt_in_count >= 5
  ), qualifying_matches as (
    select distinct
      w.id as window_id,
      m.user_a_id,
      m.user_b_id
    from supported_windows w
    join public.matches m
      on m.event_id = w.event_id
     and m.created_at >= w.starts_at
     and m.created_at <= w.observation_ends_at
    where exists (
      select 1 from public.event_focus_window_opt_ins a
      where a.window_id = w.id and a.user_id = m.user_a_id
    )
      and exists (
        select 1 from public.event_focus_window_opt_ins b
        where b.window_id = w.id and b.user_id = m.user_b_id
      )
  ), participant_counts as (
    select x.window_id, count(distinct x.user_id)::integer as participant_count
    from (
      select q.window_id, q.user_a_id as user_id from qualifying_matches q
      union all
      select q.window_id, q.user_b_id as user_id from qualifying_matches q
    ) x
    group by x.window_id
  ), per_window as (
    select
      w.id,
      w.event_id,
      w.intent_key,
      w.format,
      w.starts_at,
      w.opt_in_count,
      coalesce(p.participant_count, 0) as participant_count
    from supported_windows w
    left join participant_counts p on p.window_id = w.id
  )
  select
    pw.intent_key,
    pw.format,
    count(*)::integer,
    count(distinct pw.event_id)::integer,
    sum(pw.opt_in_count)::integer,
    sum(pw.participant_count)::integer,
    round(sum(pw.participant_count)::numeric / greatest(1, sum(pw.opt_in_count)), 4),
    round(least(
      1::numeric,
      count(*)::numeric / 6
        + count(distinct pw.event_id)::numeric / 8
    ), 4),
    max(pw.starts_at)
  from per_window pw
  group by pw.intent_key, pw.format
  having count(*) >= 3
     and count(distinct pw.event_id) >= 2
  order by
    (sum(pw.participant_count)::numeric / greatest(1, sum(pw.opt_in_count))) desc,
    count(*) desc,
    pw.intent_key,
    pw.format;
end;
$$;

revoke all on function public.create_event_focus_window(uuid,text,text,text,text,timestamptz,timestamptz,integer) from public;
revoke all on function public.get_my_event_focus_windows(uuid) from public;
revoke all on function public.set_my_event_focus_window_opt_in(uuid,boolean) from public;
revoke all on function public.get_host_event_focus_windows(uuid) from public;
revoke all on function public.set_host_event_focus_window_state(uuid,text) from public;
revoke all on function public.get_host_event_focus_window_outcomes(uuid) from public;
revoke all on function public.get_my_focus_window_playbook() from public;

grant execute on function public.create_event_focus_window(uuid,text,text,text,text,timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.get_my_event_focus_windows(uuid) to authenticated;
grant execute on function public.set_my_event_focus_window_opt_in(uuid,boolean) to authenticated;
grant execute on function public.get_host_event_focus_windows(uuid) to authenticated;
grant execute on function public.set_host_event_focus_window_state(uuid,text) to authenticated;
grant execute on function public.get_host_event_focus_window_outcomes(uuid) to authenticated;
grant execute on function public.get_my_focus_window_playbook() to authenticated;

comment on table public.event_focus_windows is
  'Host-published, domain-scoped, time-bounded event programming. Publication requires a cohort-gated declared domain; no participant is targeted by identity.';
comment on table public.event_focus_window_opt_ins is
  'Private participant opt-ins. Hosts receive aggregate counts and cohort-gated outcomes, never a pre-opt-in declared-intent roster.';
comment on function public.get_host_event_focus_window_outcomes(uuid) is
  'Returns cohort-gated observational outcomes for real focus windows. It is not causal proof that the window created the mutual outcomes.';
comment on function public.get_my_focus_window_playbook() is
  'Host-private repeat-event focus-window evidence. Requires at least three supported windows across two ended events and cannot auto-publish future programming.';
