-- =============================================================================
-- 031_atomic_event_finalization.sql
-- Ending a live Beacon must preserve the event's verified history.
--
-- Previous client behavior deleted the event row. Because most event intelligence
-- is intentionally event-scoped with ON DELETE CASCADE, that could erase matches,
-- outcome evidence, Vault context, and the observations required for world memory.
-- This RPC changes "end" into an atomic close + snapshot transaction.
-- =============================================================================

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

  -- Serialize finalization with concurrent host/event updates. Repeated calls are
  -- safe: an already-ended event remains ended and produces a fresh aggregate
  -- snapshot without deleting or duplicating the one-per-event world observation.
  select * into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.host_id <> auth.uid() then
    raise exception 'Only the event host can finalize this event';
  end if;

  update public.events
  set ends_at = least(coalesce(ends_at, now()), now())
  where id = p_event_id;

  -- This existing SECURITY DEFINER function independently verifies host identity,
  -- derives all metrics from database facts, and inserts event_outcome_snapshots.
  -- Migration 030's AFTER trigger then records/refreshes venue memory in the same
  -- transaction. Any failure rolls the entire finalization back.
  v_snapshot := public.capture_event_outcome_snapshot(p_event_id);

  return v_snapshot;
end;
$$;

revoke all on function public.finalize_hosted_event(uuid) from public;
grant execute on function public.finalize_hosted_event(uuid) to authenticated;

comment on function public.finalize_hosted_event(uuid) is
  'Atomically closes a hosted event and captures verified outcome intelligence without deleting event-scoped history.';
