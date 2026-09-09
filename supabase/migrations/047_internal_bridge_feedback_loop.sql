-- =============================================================================
-- 047_internal_bridge_feedback_loop.sql
-- Makes structural-hole suggestions safe and measurable without claiming causal
-- attribution. Blocked pairs are never eligible for bridge recommendations.
-- Operators can watch/mark an introduction and Beacon later observes whether the
-- pair independently produced a mutual, Office Hours, or two-party outcome.
-- =============================================================================

create type public.internal_bridge_disposition as enum (
  'watching',
  'introduced',
  'dismissed'
);

create type public.internal_bridge_observed_stage as enum (
  'none',
  'mutual',
  'office_hours',
  'outcome_aligned',
  'outcome_completed'
);

create table if not exists public.internal_graph_bridge_watches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.users(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  source_alias uuid not null references public.internal_graph_subject_aliases(alias) on delete cascade,
  target_alias uuid not null references public.internal_graph_subject_aliases(alias) on delete cascade,
  via_node_key text not null,
  initial_score numeric(8,4) not null default 0,
  rationale jsonb not null default '[]'::jsonb,
  disposition public.internal_bridge_disposition not null default 'watching',
  observed_stage public.internal_bridge_observed_stage not null default 'none',
  introduced_at timestamptz,
  dismissed_at timestamptz,
  first_observed_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  check (source_alias <> target_alias),
  check (char_length(via_node_key) between 3 and 220),
  check (initial_score >= 0 and initial_score <= 1000),
  unique (source_alias, target_alias, via_node_key, event_id)
);

create index if not exists internal_graph_bridge_watches_stage_idx
  on public.internal_graph_bridge_watches (observed_stage, updated_at desc);
create index if not exists internal_graph_bridge_watches_event_idx
  on public.internal_graph_bridge_watches (event_id, updated_at desc)
  where event_id is not null;

alter table public.internal_graph_bridge_watches enable row level security;
revoke all on table public.internal_graph_bridge_watches from anon, authenticated;

-- Returns only canonical alias-pair keys. This deliberately does not reveal who
-- blocked whom or the reason; it exists solely to prevent unsafe bridge output.
create or replace function public.get_internal_bridge_suppressions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_internal_operator_capability('graph_manage') then
      coalesce(array_agg(pair_key order by pair_key), array[]::text[])
    else array[]::text[]
  end
  from (
    select distinct
      case
        when left_alias.alias::text < right_alias.alias::text
          then 'person:' || left_alias.alias::text || '|person:' || right_alias.alias::text
        else 'person:' || right_alias.alias::text || '|person:' || left_alias.alias::text
      end as pair_key
    from public.user_blocks b
    join public.internal_graph_subject_aliases left_alias on left_alias.user_id = b.blocker_id
    join public.internal_graph_subject_aliases right_alias on right_alias.user_id = b.blocked_id
  ) suppressed;
$$;
revoke all on function public.get_internal_bridge_suppressions() from public;
grant execute on function public.get_internal_bridge_suppressions() to authenticated;

create or replace function public.watch_internal_graph_bridge(
  p_source_user_id uuid,
  p_target_user_id uuid,
  p_via_node_key text,
  p_event_id uuid default null,
  p_initial_score numeric default 0,
  p_rationale jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_alias uuid;
  v_target_alias uuid;
  v_swap uuid;
  v_watch_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_source_user_id is null or p_target_user_id is null or p_source_user_id = p_target_user_id then
    raise exception 'Bridge watch requires two distinct current Beacon users';
  end if;
  if not exists (select 1 from public.internal_graph_node_memory where node_key = p_via_node_key) then
    raise exception 'Bridge connector is not present in current graph memory';
  end if;
  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Unknown event scope';
  end if;

  -- A block is a hard bridge-suppression boundary regardless of whether the
  -- operator currently has restricted topology visible.
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_source_user_id and b.blocked_id = p_target_user_id)
       or (b.blocker_id = p_target_user_id and b.blocked_id = p_source_user_id)
  ) then
    raise exception 'This pair is not eligible for internal bridge tracking';
  end if;

  v_source_alias := public.ensure_internal_graph_alias(p_source_user_id);
  v_target_alias := public.ensure_internal_graph_alias(p_target_user_id);
  if v_source_alias is null or v_target_alias is null then
    raise exception 'Bridge subjects are unavailable';
  end if;

  if v_source_alias::text > v_target_alias::text then
    v_swap := v_source_alias;
    v_source_alias := v_target_alias;
    v_target_alias := v_swap;
  end if;

  insert into public.internal_graph_bridge_watches (
    created_by, event_id, source_alias, target_alias, via_node_key,
    initial_score, rationale
  ) values (
    auth.uid(), p_event_id, v_source_alias, v_target_alias, p_via_node_key,
    least(1000::numeric, greatest(0::numeric, coalesce(p_initial_score, 0))),
    coalesce(p_rationale, '[]'::jsonb)
  )
  on conflict (source_alias, target_alias, via_node_key, event_id) do update
    set initial_score = greatest(internal_graph_bridge_watches.initial_score, excluded.initial_score),
        rationale = excluded.rationale,
        disposition = case
          when internal_graph_bridge_watches.disposition = 'dismissed' then 'watching'::public.internal_bridge_disposition
          else internal_graph_bridge_watches.disposition
        end,
        dismissed_at = null,
        expires_at = greatest(internal_graph_bridge_watches.expires_at, now() + interval '365 days'),
        updated_at = now()
  returning id into v_watch_id;

  insert into public.internal_graph_audit_log (actor_id, action, event_id, metadata)
  values (
    auth.uid(),
    'bridge_watch_created',
    p_event_id,
    jsonb_build_object('watchId', v_watch_id, 'viaNodeKey', p_via_node_key)
  );

  return v_watch_id;
end;
$$;
revoke all on function public.watch_internal_graph_bridge(uuid, uuid, text, uuid, numeric, jsonb) from public;
grant execute on function public.watch_internal_graph_bridge(uuid, uuid, text, uuid, numeric, jsonb) to authenticated;

create or replace function public.set_internal_bridge_disposition(
  p_watch_id uuid,
  p_disposition public.internal_bridge_disposition
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  update public.internal_graph_bridge_watches
  set disposition = p_disposition,
      introduced_at = case
        when p_disposition = 'introduced' then coalesce(introduced_at, now())
        else introduced_at
      end,
      dismissed_at = case
        when p_disposition = 'dismissed' then now()
        else null
      end,
      updated_at = now()
  where id = p_watch_id;

  if found then
    insert into public.internal_graph_audit_log (actor_id, action, metadata)
    values (
      auth.uid(),
      'bridge_disposition_changed',
      jsonb_build_object('watchId', p_watch_id, 'disposition', p_disposition)
    );
  end if;
  return found;
end;
$$;
revoke all on function public.set_internal_bridge_disposition(uuid, public.internal_bridge_disposition) from public;
grant execute on function public.set_internal_bridge_disposition(uuid, public.internal_bridge_disposition) to authenticated;

-- Observe downstream evidence without claiming that the operator action caused it.
-- Stages are monotonic and based entirely on existing first-party records.
create or replace function public.refresh_internal_bridge_watch_outcomes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_source_user_id uuid;
  v_target_user_id uuid;
  v_stage public.internal_bridge_observed_stage;
  v_observed_at timestamptz;
  v_updated integer := 0;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  for r in
    select * from public.internal_graph_bridge_watches
    where disposition <> 'dismissed' and expires_at > now()
  loop
    select user_id into v_source_user_id
    from public.internal_graph_subject_aliases where alias = r.source_alias;
    select user_id into v_target_user_id
    from public.internal_graph_subject_aliases where alias = r.target_alias;
    if v_source_user_id is null or v_target_user_id is null then continue; end if;

    v_stage := 'none';
    v_observed_at := null;

    select 'outcome_completed'::public.internal_bridge_observed_stage,
           min(coalesce(h.completed_at, h.aligned_at, h.created_at))
    into v_stage, v_observed_at
    from public.outcome_handshakes h
    where h.status = 'completed'
      and h.created_at >= r.created_at
      and ((h.user_a_id = v_source_user_id and h.user_b_id = v_target_user_id)
        or (h.user_a_id = v_target_user_id and h.user_b_id = v_source_user_id));

    if v_observed_at is null then
      select 'outcome_aligned'::public.internal_bridge_observed_stage,
             min(coalesce(h.aligned_at, h.created_at))
      into v_stage, v_observed_at
      from public.outcome_handshakes h
      where h.status in ('aligned', 'completed')
        and h.created_at >= r.created_at
        and ((h.user_a_id = v_source_user_id and h.user_b_id = v_target_user_id)
          or (h.user_a_id = v_target_user_id and h.user_b_id = v_source_user_id));
    end if;

    if v_observed_at is null then
      select 'office_hours'::public.internal_bridge_observed_stage,
             min(o.created_at)
      into v_stage, v_observed_at
      from public.office_hours_requests o
      where o.created_at >= r.created_at
        and o.status in ('accepted', 'awaiting_escort', 'completed')
        and ((o.requester_id = v_source_user_id and o.recipient_id = v_target_user_id)
          or (o.requester_id = v_target_user_id and o.recipient_id = v_source_user_id));
    end if;

    if v_observed_at is null then
      select 'mutual'::public.internal_bridge_observed_stage,
             min(m.created_at)
      into v_stage, v_observed_at
      from public.matches m
      where m.created_at >= r.created_at
        and ((m.user_a_id = v_source_user_id and m.user_b_id = v_target_user_id)
          or (m.user_a_id = v_target_user_id and m.user_b_id = v_source_user_id));
    end if;

    update public.internal_graph_bridge_watches
    set observed_stage = case
          when observed_stage = 'outcome_completed' then observed_stage
          when observed_stage = 'outcome_aligned' and v_stage in ('none', 'mutual', 'office_hours') then observed_stage
          when observed_stage = 'office_hours' and v_stage in ('none', 'mutual') then observed_stage
          when observed_stage = 'mutual' and v_stage = 'none' then observed_stage
          else v_stage
        end,
        first_observed_at = coalesce(first_observed_at, v_observed_at),
        last_evaluated_at = now(),
        updated_at = case when v_observed_at is not null then now() else updated_at end
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;

  return v_updated;
end;
$$;
revoke all on function public.refresh_internal_bridge_watch_outcomes() from public;
grant execute on function public.refresh_internal_bridge_watch_outcomes() to authenticated;

create or replace function public.get_internal_bridge_watch_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_watches jsonb;
  v_calibration jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  perform public.refresh_internal_bridge_watch_outcomes();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', w.id,
    'eventId', w.event_id,
    'sourceNodeId', 'person:' || w.source_alias::text,
    'targetNodeId', 'person:' || w.target_alias::text,
    'viaNodeId', w.via_node_key,
    'initialScore', w.initial_score,
    'rationale', w.rationale,
    'disposition', w.disposition,
    'observedStage', w.observed_stage,
    'introducedAt', w.introduced_at,
    'firstObservedAt', w.first_observed_at,
    'createdAt', w.created_at
  ) order by w.updated_at desc), '[]'::jsonb)
  into v_watches
  from public.internal_graph_bridge_watches w
  where w.expires_at > now();

  select jsonb_build_object(
    'total', count(*),
    'introduced', count(*) filter (where disposition = 'introduced'),
    'mutualOrBetter', count(*) filter (where observed_stage <> 'none'),
    'officeHoursOrBetter', count(*) filter (where observed_stage in ('office_hours', 'outcome_aligned', 'outcome_completed')),
    'outcomeAlignedOrBetter', count(*) filter (where observed_stage in ('outcome_aligned', 'outcome_completed')),
    'outcomeCompleted', count(*) filter (where observed_stage = 'outcome_completed')
  )
  into v_calibration
  from public.internal_graph_bridge_watches
  where expires_at > now() and disposition <> 'dismissed';

  return jsonb_build_object(
    'generatedAt', now(),
    'watches', v_watches,
    'calibration', v_calibration,
    'attributionNote', 'Observed downstream evidence is correlation after a watch/introduction timestamp, not proof that the operator action caused the relationship.'
  );
end;
$$;
revoke all on function public.get_internal_bridge_watch_summary() from public;
grant execute on function public.get_internal_bridge_watch_summary() to authenticated;

comment on table public.internal_graph_bridge_watches is
  'Operator bridge-watch ledger. Observed downstream stages are evidence chronology only and must not be described as causal attribution.';
