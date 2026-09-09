-- =============================================================================
-- 065_internal_watchtower_baseline_priming.sql
-- Prime new Watchtower rules from the latest retained evidence without emitting
-- an alert. A watch should alert on change after the operator starts watching,
-- not merely because the condition was already true before the rule existed.
-- =============================================================================

create or replace function public.prime_internal_graph_watch_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_epoch_id uuid;
  v_previous_epoch_id uuid;
  v_manifest public.internal_graph_machine_run_manifests;
  v_value numeric;
begin
  if not new.enabled then return new; end if;

  if new.rule_kind = 'machine_digest_changed' then
    select manifest.* into v_manifest
    from public.internal_graph_machine_run_manifests manifest
    where manifest.operator_id = new.created_by
      and manifest.recipe_id = new.recipe_id
      and (new.event_id is null or manifest.event_id = new.event_id)
      and manifest.expires_at > now()
    order by manifest.created_at desc, manifest.id desc
    limit 1;

    if v_manifest.id is not null then
      update public.internal_graph_watch_rules
      set last_result_digest = v_manifest.result_digest,
          last_evaluated_at = now(),
          updated_at = now()
      where id = new.id;
    end if;
    return new;
  end if;

  if new.event_id is null then
    select epoch.id into v_epoch_id
    from public.internal_graph_epochs epoch
    where epoch.expires_at > now()
    order by epoch.captured_at desc, epoch.id desc
    limit 1;
  else
    select epoch.id into v_epoch_id
    from public.internal_graph_epochs epoch
    where epoch.event_id = new.event_id
      and epoch.expires_at > now()
    order by epoch.captured_at desc, epoch.id desc
    limit 1;
  end if;

  if v_epoch_id is null then return new; end if;

  if new.event_id is null then
    select epoch.id into v_previous_epoch_id
    from public.internal_graph_epochs epoch
    where epoch.id <> v_epoch_id
      and epoch.captured_at < (select captured_at from public.internal_graph_epochs where id = v_epoch_id)
      and epoch.expires_at > now()
    order by epoch.captured_at desc, epoch.id desc
    limit 1;
  else
    select epoch.id into v_previous_epoch_id
    from public.internal_graph_epochs epoch
    where epoch.id <> v_epoch_id
      and epoch.event_id = new.event_id
      and epoch.captured_at < (select captured_at from public.internal_graph_epochs where id = v_epoch_id)
      and epoch.expires_at > now()
    order by epoch.captured_at desc, epoch.id desc
    limit 1;
  end if;

  if new.rule_kind = 'motif_threshold' then
    select coalesce(motif.observed_count, 0)::numeric into v_value
    from public.internal_graph_epoch_motifs motif
    where motif.epoch_id = v_epoch_id and motif.motif_key = new.motif_key;
    v_value := coalesce(v_value, 0);
  else
    v_value := public.internal_watchtower_metric_value(
      v_epoch_id,
      v_previous_epoch_id,
      new.metric_key
    );
  end if;

  if v_value is not null then
    update public.internal_graph_watch_rules
    set last_value = v_value,
        last_evaluated_at = now(),
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;
revoke all on function public.prime_internal_graph_watch_rule() from public;

drop trigger if exists prime_internal_graph_watch_rule_after_insert
  on public.internal_graph_watch_rules;
create trigger prime_internal_graph_watch_rule_after_insert
after insert on public.internal_graph_watch_rules
for each row execute function public.prime_internal_graph_watch_rule();

comment on function public.prime_internal_graph_watch_rule() is
  'Silently baselines a newly created Watchtower rule from the latest canonical Epoch or private Machine manifest so future alerts represent post-watch change.';
