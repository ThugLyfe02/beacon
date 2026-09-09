-- =============================================================================
-- 062_internal_graph_watchtower.sql
-- Event-driven internal monitoring over aggregate/canonical graph conditions.
--
-- Watchtower is NOT a people watchlist. Rules cannot target person node ids,
-- contact identifiers, free-form ecosystem text, or external endpoints. They
-- monitor aggregate topology / motif metrics and private Machine result digests.
-- Triggers create internal review events only; no social action is executed.
-- =============================================================================

create table if not exists public.internal_graph_watch_rules (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  event_id uuid references public.events(id) on delete set null,
  rule_kind text not null check (rule_kind in (
    'metric_threshold', 'metric_delta', 'motif_threshold', 'machine_digest_changed'
  )),
  metric_key text check (metric_key is null or metric_key in (
    'node_count', 'edge_count', 'community_count', 'articulation_count',
    'critical_bridge_count', 'structural_dependence', 'broker_count', 'new_broker_count'
  )),
  motif_key text check (motif_key is null or motif_key in (
    'triadic_closure', 'cross_community_context_bridge', 'relationship_outcome_ladder',
    'repeated_cross_community_edge', 'articulation_dependence', 'multi_community_broker'
  )),
  recipe_id uuid references public.internal_graph_machine_recipes(id) on delete cascade,
  comparator text check (comparator is null or comparator in ('gte', 'lte')),
  threshold numeric(14,6),
  enabled boolean not null default true,
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 5 and 10080),
  last_value numeric(14,6),
  last_result_digest text check (last_result_digest is null or char_length(last_result_digest) = 64),
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days')
);
create index if not exists internal_graph_watch_rules_owner_idx
  on public.internal_graph_watch_rules(created_by, enabled, updated_at desc);
create index if not exists internal_graph_watch_rules_recipe_idx
  on public.internal_graph_watch_rules(recipe_id) where recipe_id is not null;

create table if not exists public.internal_graph_watch_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.internal_graph_watch_rules(id) on delete cascade,
  operator_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  epoch_id uuid references public.internal_graph_epochs(id) on delete set null,
  manifest_id uuid references public.internal_graph_machine_run_manifests(id) on delete set null,
  condition_key text not null check (char_length(condition_key) between 1 and 100),
  observed_value numeric(14,6),
  previous_value numeric(14,6),
  evidence_digest text not null check (char_length(evidence_digest) = 64),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  expires_at timestamptz not null default (now() + interval '180 days')
);
create index if not exists internal_graph_watch_events_owner_idx
  on public.internal_graph_watch_events(operator_id, acknowledged_at, created_at desc);

alter table public.internal_graph_watch_rules enable row level security;
alter table public.internal_graph_watch_events enable row level security;
revoke all on table public.internal_graph_watch_rules from anon, authenticated;
revoke all on table public.internal_graph_watch_events from anon, authenticated;

create or replace function public.save_internal_graph_watch_rule(
  p_title text,
  p_event_id uuid,
  p_rule_kind text,
  p_metric_key text default null,
  p_motif_key text default null,
  p_recipe_id uuid default null,
  p_comparator text default null,
  p_threshold numeric default null,
  p_cooldown_minutes integer default 60
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 120 then
    raise exception 'Invalid Watchtower title';
  end if;
  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Unknown event scope';
  end if;
  if p_rule_kind not in ('metric_threshold', 'metric_delta', 'motif_threshold', 'machine_digest_changed') then
    raise exception 'Unsupported Watchtower rule kind';
  end if;
  if coalesce(p_cooldown_minutes, 60) < 5 or coalesce(p_cooldown_minutes, 60) > 10080 then
    raise exception 'Watchtower cooldown must be between 5 minutes and 7 days';
  end if;

  if p_rule_kind in ('metric_threshold', 'metric_delta') then
    if p_metric_key not in (
      'node_count', 'edge_count', 'community_count', 'articulation_count',
      'critical_bridge_count', 'structural_dependence', 'broker_count', 'new_broker_count'
    ) then raise exception 'Unsupported Watchtower metric'; end if;
    if p_threshold is null or p_threshold < 0 then raise exception 'Watchtower metric threshold is required'; end if;
    if p_rule_kind = 'metric_threshold' and p_comparator not in ('gte', 'lte') then
      raise exception 'Threshold rule requires gte/lte comparator';
    end if;
  elsif p_rule_kind = 'motif_threshold' then
    if p_motif_key not in (
      'triadic_closure', 'cross_community_context_bridge', 'relationship_outcome_ladder',
      'repeated_cross_community_edge', 'articulation_dependence', 'multi_community_broker'
    ) then raise exception 'Unsupported Watchtower motif'; end if;
    if p_threshold is null or p_threshold < 0 then raise exception 'Watchtower motif threshold is required'; end if;
    if p_comparator not in ('gte', 'lte') then raise exception 'Motif rule requires gte/lte comparator'; end if;
  else
    if p_recipe_id is null or not exists (
      select 1 from public.internal_graph_machine_recipes recipe
      where recipe.id = p_recipe_id and recipe.created_by = auth.uid() and recipe.enabled and recipe.expires_at > now()
    ) then raise exception 'Machine digest watch requires an active private recipe owned by the operator'; end if;
  end if;

  insert into public.internal_graph_watch_rules(
    created_by, title, event_id, rule_kind, metric_key, motif_key, recipe_id,
    comparator, threshold, cooldown_minutes, expires_at
  ) values (
    auth.uid(), trim(p_title), p_event_id, p_rule_kind,
    case when p_rule_kind in ('metric_threshold', 'metric_delta') then p_metric_key else null end,
    case when p_rule_kind = 'motif_threshold' then p_motif_key else null end,
    case when p_rule_kind = 'machine_digest_changed' then p_recipe_id else null end,
    case when p_rule_kind in ('metric_threshold', 'motif_threshold') then p_comparator else null end,
    case when p_rule_kind <> 'machine_digest_changed' then p_threshold else null end,
    coalesce(p_cooldown_minutes, 60), now() + interval '365 days'
  ) returning id into v_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (auth.uid(), 'watchtower_rule_saved', p_event_id,
    jsonb_build_object('ruleId', v_id, 'ruleKind', p_rule_kind, 'metricKey', p_metric_key, 'motifKey', p_motif_key, 'recipeId', p_recipe_id));
  return v_id;
end;
$$;
revoke all on function public.save_internal_graph_watch_rule(text, uuid, text, text, text, uuid, text, numeric, integer) from public;
grant execute on function public.save_internal_graph_watch_rule(text, uuid, text, text, text, uuid, text, numeric, integer) to authenticated;

create or replace function public.set_internal_graph_watch_rule_enabled(p_rule_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  update public.internal_graph_watch_rules
  set enabled = p_enabled, updated_at = now()
  where id = p_rule_id and created_by = auth.uid() and expires_at > now();
  if not found then raise exception 'Watchtower rule not found'; end if;
  return true;
end;
$$;
revoke all on function public.set_internal_graph_watch_rule_enabled(uuid, boolean) from public;
grant execute on function public.set_internal_graph_watch_rule_enabled(uuid, boolean) to authenticated;

create or replace function public.acknowledge_internal_graph_watch_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;
  update public.internal_graph_watch_events
  set acknowledged_at = coalesce(acknowledged_at, now())
  where id = p_event_id and operator_id = auth.uid();
  if not found then raise exception 'Watchtower event not found'; end if;
  return true;
end;
$$;
revoke all on function public.acknowledge_internal_graph_watch_event(uuid) from public;
grant execute on function public.acknowledge_internal_graph_watch_event(uuid) to authenticated;

create or replace function public.get_internal_graph_watchtower()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_events jsonb;
begin
  if not public.has_internal_operator_capability('graph_manage') then raise exception 'Internal graph management capability required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rule.id, 'title', rule.title, 'eventId', rule.event_id,
    'ruleKind', rule.rule_kind, 'metricKey', rule.metric_key, 'motifKey', rule.motif_key,
    'recipeId', rule.recipe_id, 'comparator', rule.comparator, 'threshold', rule.threshold,
    'enabled', rule.enabled, 'cooldownMinutes', rule.cooldown_minutes,
    'lastValue', rule.last_value, 'lastEvaluatedAt', rule.last_evaluated_at,
    'lastTriggeredAt', rule.last_triggered_at, 'createdAt', rule.created_at, 'expiresAt', rule.expires_at
  ) order by rule.updated_at desc), '[]'::jsonb)
  into v_rules
  from public.internal_graph_watch_rules rule
  where rule.created_by = auth.uid() and rule.expires_at > now();

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', evt.id, 'ruleId', evt.rule_id, 'eventId', evt.event_id, 'epochId', evt.epoch_id,
    'manifestId', evt.manifest_id, 'conditionKey', evt.condition_key,
    'observedValue', evt.observed_value, 'previousValue', evt.previous_value,
    'evidenceDigest', evt.evidence_digest, 'createdAt', evt.created_at,
    'acknowledgedAt', evt.acknowledged_at, 'expiresAt', evt.expires_at
  ) order by evt.created_at desc), '[]'::jsonb)
  into v_events
  from (
    select * from public.internal_graph_watch_events
    where operator_id = auth.uid() and expires_at > now()
    order by created_at desc limit 200
  ) evt;

  return jsonb_build_object('generatedAt', now(), 'rules', v_rules, 'events', v_events,
    'operatingRule', 'Watchtower monitors aggregate topology and analytical-result conditions only. It never watches a person or performs social actions.');
end;
$$;
revoke all on function public.get_internal_graph_watchtower() from public;
grant execute on function public.get_internal_graph_watchtower() to authenticated;

create or replace function public.internal_watchtower_metric_value(
  p_epoch_id uuid,
  p_previous_epoch_id uuid,
  p_metric_key text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_epoch public.internal_graph_epochs;
  v_value numeric := 0;
begin
  select * into v_epoch from public.internal_graph_epochs where id = p_epoch_id;
  if v_epoch.id is null then return null; end if;
  case p_metric_key
    when 'node_count' then v_value := v_epoch.node_count;
    when 'edge_count' then v_value := v_epoch.edge_count;
    when 'community_count' then v_value := v_epoch.community_count;
    when 'articulation_count' then v_value := v_epoch.articulation_count;
    when 'critical_bridge_count' then v_value := v_epoch.critical_bridge_count;
    when 'structural_dependence' then v_value := v_epoch.structural_dependence;
    when 'broker_count' then
      select count(*)::numeric into v_value from public.internal_graph_epoch_brokers where epoch_id = p_epoch_id;
    when 'new_broker_count' then
      if p_previous_epoch_id is null then return 0; end if;
      select count(*)::numeric into v_value
      from public.internal_graph_epoch_brokers current_broker
      where current_broker.epoch_id = p_epoch_id
        and not exists (
          select 1 from public.internal_graph_epoch_brokers previous_broker
          where previous_broker.epoch_id = p_previous_epoch_id
            and previous_broker.subject_alias = current_broker.subject_alias
        );
    else return null;
  end case;
  return v_value;
end;
$$;
revoke all on function public.internal_watchtower_metric_value(uuid, uuid, text) from public;

create or replace function public.evaluate_internal_watchtower_epoch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_epoch_id uuid;
  v_epoch public.internal_graph_epochs;
  v_previous_epoch_id uuid;
  v_rule public.internal_graph_watch_rules;
  v_value numeric;
  v_previous numeric;
  v_should_trigger boolean;
  v_condition_key text;
  v_digest text;
  v_now timestamptz := now();
begin
  if new.action <> 'graph_epoch_recorded' then return new; end if;
  begin v_epoch_id := (new.metadata->>'epochId')::uuid;
  exception when others then return new; end;
  select * into v_epoch from public.internal_graph_epochs where id = v_epoch_id;
  if v_epoch.id is null then return new; end if;

  for v_rule in
    select * from public.internal_graph_watch_rules
    where created_by = new.actor_id and enabled and expires_at > v_now
      and rule_kind in ('metric_threshold', 'metric_delta', 'motif_threshold')
      and (event_id is null or event_id = v_epoch.event_id)
  loop
    if v_rule.event_id is null then
      select id into v_previous_epoch_id from public.internal_graph_epochs
      where id <> v_epoch.id and captured_at < v_epoch.captured_at
      order by captured_at desc limit 1;
    else
      select id into v_previous_epoch_id from public.internal_graph_epochs
      where id <> v_epoch.id and event_id = v_epoch.event_id and captured_at < v_epoch.captured_at
      order by captured_at desc limit 1;
    end if;

    if v_rule.rule_kind = 'motif_threshold' then
      select coalesce(observed_count, 0)::numeric into v_value
      from public.internal_graph_epoch_motifs
      where epoch_id = v_epoch.id and motif_key = v_rule.motif_key;
      v_value := coalesce(v_value, 0);
      v_condition_key := 'motif:' || v_rule.motif_key;
    else
      v_value := public.internal_watchtower_metric_value(v_epoch.id, v_previous_epoch_id, v_rule.metric_key);
      v_condition_key := 'metric:' || v_rule.metric_key;
    end if;

    v_previous := v_rule.last_value;
    v_should_trigger := false;
    if v_rule.rule_kind in ('metric_threshold', 'motif_threshold') then
      if v_rule.comparator = 'gte' then
        v_should_trigger := v_value >= v_rule.threshold and (v_previous is null or v_previous < v_rule.threshold);
      else
        v_should_trigger := v_value <= v_rule.threshold and (v_previous is null or v_previous > v_rule.threshold);
      end if;
    elsif v_rule.rule_kind = 'metric_delta' then
      v_should_trigger := v_previous is not null and abs(v_value - v_previous) >= v_rule.threshold;
    end if;

    if v_should_trigger and (v_rule.last_triggered_at is null or v_rule.last_triggered_at <= v_now - make_interval(mins => v_rule.cooldown_minutes)) then
      v_digest := encode(digest(v_rule.id::text || '|' || v_epoch.topology_digest || '|' || coalesce(v_value::text, '') || '|' || coalesce(v_previous::text, ''), 'sha256'), 'hex');
      insert into public.internal_graph_watch_events(rule_id, operator_id, event_id, epoch_id, condition_key, observed_value, previous_value, evidence_digest)
      values (v_rule.id, v_rule.created_by, v_epoch.event_id, v_epoch.id, v_condition_key, v_value, v_previous, v_digest);
      update public.internal_graph_watch_rules set last_triggered_at = v_now where id = v_rule.id;
    end if;

    update public.internal_graph_watch_rules
    set last_value = v_value, last_evaluated_at = v_now, updated_at = v_now
    where id = v_rule.id;
  end loop;
  return new;
end;
$$;
revoke all on function public.evaluate_internal_watchtower_epoch() from public;

drop trigger if exists internal_watchtower_after_graph_epoch_audit on public.internal_graph_audit_log;
create trigger internal_watchtower_after_graph_epoch_audit
after insert on public.internal_graph_audit_log
for each row execute function public.evaluate_internal_watchtower_epoch();

create or replace function public.evaluate_internal_watchtower_machine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.internal_graph_watch_rules;
  v_now timestamptz := now();
  v_digest text;
begin
  if new.recipe_id is null then return new; end if;
  for v_rule in
    select * from public.internal_graph_watch_rules
    where created_by = new.operator_id and enabled and expires_at > v_now
      and rule_kind = 'machine_digest_changed'
      and recipe_id = new.recipe_id
      and (event_id is null or event_id = new.event_id)
  loop
    if v_rule.last_result_digest is not null
       and v_rule.last_result_digest <> new.result_digest
       and (v_rule.last_triggered_at is null or v_rule.last_triggered_at <= v_now - make_interval(mins => v_rule.cooldown_minutes)) then
      v_digest := encode(digest(v_rule.id::text || '|' || v_rule.last_result_digest || '|' || new.result_digest, 'sha256'), 'hex');
      insert into public.internal_graph_watch_events(rule_id, operator_id, event_id, manifest_id, condition_key, evidence_digest)
      values (v_rule.id, v_rule.created_by, new.event_id, new.id, 'machine_result_changed', v_digest);
      update public.internal_graph_watch_rules set last_triggered_at = v_now where id = v_rule.id;
    end if;
    update public.internal_graph_watch_rules
    set last_result_digest = new.result_digest, last_evaluated_at = v_now, updated_at = v_now
    where id = v_rule.id;
  end loop;
  return new;
end;
$$;
revoke all on function public.evaluate_internal_watchtower_machine() from public;

drop trigger if exists internal_watchtower_after_machine_manifest on public.internal_graph_machine_run_manifests;
create trigger internal_watchtower_after_machine_manifest
after insert on public.internal_graph_machine_run_manifests
for each row execute function public.evaluate_internal_watchtower_machine();

create or replace function public.prune_internal_graph_watchtower()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_events integer; v_rules integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_watch_events where expires_at <= now();
  get diagnostics v_events = row_count;
  delete from public.internal_graph_watch_rules where expires_at <= now();
  get diagnostics v_rules = row_count;
  return jsonb_build_object('prunedEvents', v_events, 'prunedRules', v_rules, 'prunedAt', now());
end;
$$;
revoke all on function public.prune_internal_graph_watchtower() from public;
grant execute on function public.prune_internal_graph_watchtower() to service_role;

comment on table public.internal_graph_watch_rules is
  'Operator-only structural watch conditions. No person identifiers, raw target text, contact data, or external endpoints are accepted.';
comment on table public.internal_graph_watch_events is
  'Bounded internal alerts created from canonical Epoch metrics or private Machine result-digest changes; review-only and non-social.';
