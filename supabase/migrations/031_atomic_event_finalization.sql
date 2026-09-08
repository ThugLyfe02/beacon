-- =============================================================================
-- 031_atomic_event_finalization.sql
-- Ending a live Beacon must preserve the event's verified history.
--
-- Previous client behavior deleted the event row. Because most event intelligence
-- is intentionally event-scoped with ON DELETE CASCADE, that could erase matches,
-- outcome evidence, Vault context, and the observations required for world memory.
-- This migration separates the live-window end from durable finalization and turns
-- "end" into an idempotent close + snapshot transaction.
-- =============================================================================

alter table public.events
  add column if not exists finalized_at timestamptz;

comment on column public.events.finalized_at is
  'When the host atomically sealed the event outcome record. Distinct from ends_at, which only marks the scheduled/live-window boundary.';

create index if not exists idx_events_host_unfinalized_created
  on public.events (host_id, created_at desc)
  where finalized_at is null;

create or replace function public.finalize_hosted_event(p_event_id uuid)
returns public.event_outcome_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_snapshot public.event_outcome_snapshots;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  -- Serialize finalization with concurrent host/event updates. A scheduled event
  -- may already be past ends_at but still be unfinalized; finalized_at is the
  -- durable lifecycle marker rather than inferring archival state from the clock.
  select * into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.host_id <> auth.uid() then
    raise exception 'Only the event host can finalize this event';
  end if;

  -- Idempotent retry semantics: once sealed, return the newest verified snapshot
  -- instead of creating duplicate final snapshots or re-training world memory.
  if v_event.finalized_at is not null then
    select * into v_snapshot
    from public.event_outcome_snapshots s
    where s.event_id = p_event_id
    order by s.captured_at desc
    limit 1;

    if v_snapshot.id is not null then
      return v_snapshot;
    end if;
    -- Defensive recovery for an impossible/legacy partial state: if finalized_at
    -- exists without a snapshot, continue and reconstruct from database facts.
  end if;

  update public.events
  set
    ends_at = least(coalesce(ends_at, now()), now()),
    finalized_at = now()
  where id = p_event_id;

  -- This existing SECURITY DEFINER function independently verifies host identity,
  -- derives all metrics from database facts, and inserts event_outcome_snapshots.
  -- Migration 030's AFTER trigger then records/refreshes venue memory in the same
  -- transaction. Any failure rolls back ends_at, finalized_at and the snapshot.
  v_snapshot := public.capture_event_outcome_snapshot(p_event_id);

  return v_snapshot;
end;
$$;

revoke all on function public.finalize_hosted_event(uuid) from public;
grant execute on function public.finalize_hosted_event(uuid) to authenticated;

comment on function public.finalize_hosted_event(uuid) is
  'Idempotently seals a hosted event and captures verified outcome intelligence without deleting event-scoped history.';
