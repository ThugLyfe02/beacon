-- =============================================================================
-- 048_internal_bridge_feedback_hardening.sql
-- Hardens the bridge-watch loop added in 047.
--
-- * global watches become idempotent despite NULL event_id semantics;
-- * no downstream evidence remains stage `none` rather than inheriting the last
--   aggregate query's constant label;
-- * blocked-pair watches are purged if a block is created after the watch.
-- =============================================================================

alter table public.internal_graph_bridge_watches
  add column if not exists event_scope text
  generated always as (coalesce(event_id::text, 'global')) stored;

alter table public.internal_graph_bridge_watches
  drop constraint if exists internal_graph_bridge_watches_source_alias_target_alias_via_node_key_event_id_key;

alter table public.internal_graph_bridge_watches
  add constraint internal_graph_bridge_watches_scope_unique
  unique (source_alias, target_alias, via_node_key, event_scope);

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
  v_scope text := coalesce(p_event_id::text, 'global');
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
  on conflict (source_alias, target_alias, via_node_key, event_scope) do update
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
    jsonb_build_object('watchId', v_watch_id, 'viaNodeKey', p_via_node_key, 'scope', v_scope)
  );

  return v_watch_id;
end;
$$;
revoke all on function public.watch_internal_graph_bridge(uuid, uuid, text, uuid, numeric, jsonb) from public;
grant execute on function public.watch_internal_graph_bridge(uuid, uuid, text, uuid, numeric, jsonb) to authenticated;

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

  -- A block created after the watch is a hard invalidation boundary. Delete the
  -- watch rather than retaining a hidden historical bridge recommendation.
  delete from public.internal_graph_bridge_watches w
  using public.internal_graph_subject_aliases source_alias,
        public.internal_graph_subject_aliases target_alias,
        public.user_blocks b
  where source_alias.alias = w.source_alias
    and target_alias.alias = w.target_alias
    and (
      (b.blocker_id = source_alias.user_id and b.blocked_id = target_alias.user_id)
      or (b.blocker_id = target_alias.user_id and b.blocked_id = source_alias.user_id)
    );

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

    select min(coalesce(h.completed_at, h.aligned_at, h.created_at))
    into v_observed_at
    from public.outcome_handshakes h
    where h.status = 'completed'
      and h.created_at >= r.created_at
      and ((h.user_a_id = v_source_user_id and h.user_b_id = v_target_user_id)
        or (h.user_a_id = v_target_user_id and h.user_b_id = v_source_user_id));
    if v_observed_at is not null then
      v_stage := 'outcome_completed';
    end if;

    if v_observed_at is null then
      select min(coalesce(h.aligned_at, h.created_at))
      into v_observed_at
      from public.outcome_handshakes h
      where h.status in ('aligned', 'completed')
        and h.created_at >= r.created_at
        and ((h.user_a_id = v_source_user_id and h.user_b_id = v_target_user_id)
          or (h.user_a_id = v_target_user_id and h.user_b_id = v_source_user_id));
      if v_observed_at is not null then
        v_stage := 'outcome_aligned';
      end if;
    end if;

    if v_observed_at is null then
      select min(o.created_at)
      into v_observed_at
      from public.office_hours_requests o
      where o.created_at >= r.created_at
        and o.status in ('accepted', 'awaiting_escort', 'completed')
        and ((o.requester_id = v_source_user_id and o.recipient_id = v_target_user_id)
          or (o.requester_id = v_target_user_id and o.recipient_id = v_source_user_id));
      if v_observed_at is not null then
        v_stage := 'office_hours';
      end if;
    end if;

    if v_observed_at is null then
      select min(m.created_at)
      into v_observed_at
      from public.matches m
      where m.created_at >= r.created_at
        and ((m.user_a_id = v_source_user_id and m.user_b_id = v_target_user_id)
          or (m.user_a_id = v_target_user_id and m.user_b_id = v_source_user_id));
      if v_observed_at is not null then
        v_stage := 'mutual';
      else
        v_stage := 'none';
      end if;
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

comment on column public.internal_graph_bridge_watches.event_scope is
  'Generated global/event scope used to make bridge-watch idempotency explicit even when event_id is NULL.';
