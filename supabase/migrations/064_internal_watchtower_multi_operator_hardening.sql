-- =============================================================================
-- 064_internal_watchtower_multi_operator_hardening.sql
-- Make Watchtower evaluation independent of which authorized operator happened
-- to seal an Epoch. Every active rule owner with an exact graph_manage grant is
-- evaluated against the new canonical epoch; alerts remain private to that owner.
-- =============================================================================

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
  begin
    v_epoch_id := (new.metadata->>'epochId')::uuid;
  exception when others then
    return new;
  end;

  select * into v_epoch
  from public.internal_graph_epochs
  where id = v_epoch_id;
  if v_epoch.id is null then return new; end if;

  for v_rule in
    select rule.*
    from public.internal_graph_watch_rules rule
    join public.internal_operator_access access
      on access.user_id = rule.created_by
    where rule.enabled
      and rule.expires_at > v_now
      and (access.expires_at is null or access.expires_at > v_now)
      and 'graph_manage' = any(access.capabilities)
      and rule.rule_kind in ('metric_threshold', 'metric_delta', 'motif_threshold')
      and (rule.event_id is null or rule.event_id = v_epoch.event_id)
    order by rule.id
  loop
    v_previous_epoch_id := null;
    if v_rule.event_id is null then
      select id into v_previous_epoch_id
      from public.internal_graph_epochs
      where id <> v_epoch.id
        and captured_at < v_epoch.captured_at
      order by captured_at desc, id desc
      limit 1;
    else
      select id into v_previous_epoch_id
      from public.internal_graph_epochs
      where id <> v_epoch.id
        and event_id = v_epoch.event_id
        and captured_at < v_epoch.captured_at
      order by captured_at desc, id desc
      limit 1;
    end if;

    if v_rule.rule_kind = 'motif_threshold' then
      select coalesce(observed_count, 0)::numeric into v_value
      from public.internal_graph_epoch_motifs
      where epoch_id = v_epoch.id and motif_key = v_rule.motif_key;
      v_value := coalesce(v_value, 0);
      v_condition_key := 'motif:' || v_rule.motif_key;
    else
      v_value := public.internal_watchtower_metric_value(
        v_epoch.id,
        v_previous_epoch_id,
        v_rule.metric_key
      );
      v_condition_key := 'metric:' || v_rule.metric_key;
    end if;

    if v_value is null then
      update public.internal_graph_watch_rules
      set last_evaluated_at = v_now, updated_at = v_now
      where id = v_rule.id;
      continue;
    end if;

    v_previous := v_rule.last_value;
    v_should_trigger := false;

    if v_rule.rule_kind in ('metric_threshold', 'motif_threshold') then
      if v_rule.comparator = 'gte' then
        v_should_trigger := v_value >= v_rule.threshold
          and (v_previous is null or v_previous < v_rule.threshold);
      else
        v_should_trigger := v_value <= v_rule.threshold
          and (v_previous is null or v_previous > v_rule.threshold);
      end if;
    elsif v_rule.rule_kind = 'metric_delta' then
      v_should_trigger := v_previous is not null
        and abs(v_value - v_previous) >= v_rule.threshold;
    end if;

    if v_should_trigger
       and (
         v_rule.last_triggered_at is null
         or v_rule.last_triggered_at <= v_now - make_interval(mins => v_rule.cooldown_minutes)
       ) then
      v_digest := encode(digest(
        v_rule.id::text
        || '|' || v_epoch.topology_digest
        || '|' || coalesce(v_value::text, '')
        || '|' || coalesce(v_previous::text, ''),
        'sha256'
      ), 'hex');

      if not exists (
        select 1
        from public.internal_graph_watch_events existing
        where existing.rule_id = v_rule.id
          and existing.evidence_digest = v_digest
          and existing.expires_at > v_now
      ) then
        insert into public.internal_graph_watch_events(
          rule_id, operator_id, event_id, epoch_id, condition_key,
          observed_value, previous_value, evidence_digest
        ) values (
          v_rule.id, v_rule.created_by, v_epoch.event_id, v_epoch.id,
          v_condition_key, v_value, v_previous, v_digest
        );
      end if;

      update public.internal_graph_watch_rules
      set last_triggered_at = v_now
      where id = v_rule.id;
    end if;

    update public.internal_graph_watch_rules
    set last_value = v_value,
        last_evaluated_at = v_now,
        updated_at = v_now
    where id = v_rule.id;
  end loop;

  return new;
end;
$$;
revoke all on function public.evaluate_internal_watchtower_epoch() from public;

-- Machine-result watches are private to the recipe owner, but execution must also
-- stop immediately when that operator loses the exact graph_manage capability.
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
    select rule.*
    from public.internal_graph_watch_rules rule
    join public.internal_operator_access access
      on access.user_id = rule.created_by
    where rule.created_by = new.operator_id
      and rule.enabled
      and rule.expires_at > v_now
      and (access.expires_at is null or access.expires_at > v_now)
      and 'graph_manage' = any(access.capabilities)
      and rule.rule_kind = 'machine_digest_changed'
      and rule.recipe_id = new.recipe_id
      and (rule.event_id is null or rule.event_id = new.event_id)
    order by rule.id
  loop
    if v_rule.last_result_digest is not null
       and v_rule.last_result_digest <> new.result_digest
       and (
         v_rule.last_triggered_at is null
         or v_rule.last_triggered_at <= v_now - make_interval(mins => v_rule.cooldown_minutes)
       ) then
      v_digest := encode(digest(
        v_rule.id::text || '|' || v_rule.last_result_digest || '|' || new.result_digest,
        'sha256'
      ), 'hex');

      if not exists (
        select 1 from public.internal_graph_watch_events existing
        where existing.rule_id = v_rule.id
          and existing.evidence_digest = v_digest
          and existing.expires_at > v_now
      ) then
        insert into public.internal_graph_watch_events(
          rule_id, operator_id, event_id, manifest_id, condition_key, evidence_digest
        ) values (
          v_rule.id, v_rule.created_by, new.event_id, new.id,
          'machine_result_changed', v_digest
        );
      end if;

      update public.internal_graph_watch_rules
      set last_triggered_at = v_now
      where id = v_rule.id;
    end if;

    update public.internal_graph_watch_rules
    set last_result_digest = new.result_digest,
        last_evaluated_at = v_now,
        updated_at = v_now
    where id = v_rule.id;
  end loop;

  return new;
end;
$$;
revoke all on function public.evaluate_internal_watchtower_machine() from public;

comment on function public.evaluate_internal_watchtower_epoch() is
  'Evaluates every active graph-manage operator structural watch when a canonical Epoch is sealed; rule outputs remain private to each owner.';
comment on function public.evaluate_internal_watchtower_machine() is
  'Evaluates private Machine digest watches only while the recipe owner retains an exact graph_manage capability.';
