-- =============================================================================
-- 026_outcome_conversion_metrics.sql
-- Adds a defensible outcome metric: how often mutual discovery becomes a
-- mutually aligned and then completed real-world next step.
-- =============================================================================

alter table public.event_outcome_snapshots
  add column if not exists outcome_handshakes_aligned integer not null default 0
    check (outcome_handshakes_aligned >= 0),
  add column if not exists outcome_handshakes_completed integer not null default 0
    check (outcome_handshakes_completed >= 0),
  add column if not exists mutual_to_outcome_rate numeric(6,5) not null default 0
    check (mutual_to_outcome_rate between 0 and 1);

create or replace function public.populate_outcome_conversion_metrics()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_aligned integer;
  v_completed integer;
begin
  select
    count(*) filter (where oh.status in ('aligned', 'completed')),
    count(*) filter (where oh.status = 'completed')
  into v_aligned, v_completed
  from public.outcome_handshakes oh
  where oh.event_id = new.event_id;

  new.outcome_handshakes_aligned := coalesce(v_aligned, 0);
  new.outcome_handshakes_completed := coalesce(v_completed, 0);
  new.mutual_to_outcome_rate := public.safe_ratio(
    coalesce(v_completed, 0),
    greatest(new.mutuals_formed, 0)
  );

  return new;
end;
$$;

drop trigger if exists event_snapshot_outcome_conversion
  on public.event_outcome_snapshots;

create trigger event_snapshot_outcome_conversion
before insert or update on public.event_outcome_snapshots
for each row execute function public.populate_outcome_conversion_metrics();

comment on column public.event_outcome_snapshots.mutual_to_outcome_rate is
  'Private organizer metric: completed outcome handshakes divided by mutuals formed.';
