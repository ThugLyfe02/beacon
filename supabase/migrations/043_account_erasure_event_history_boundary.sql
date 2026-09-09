-- =============================================================================
-- 043_account_erasure_event_history_boundary.sql
-- Separates account erasure from event/aggregate-history deletion.
--
-- A host deleting their account must not cascade-delete the entire event container
-- (which would erase other participants' history), nor leave an endless live event.
-- Personal/user-linked rows may still follow their own ON DELETE semantics. The
-- event shell and privacy-safe aggregate snapshots survive with host_id = NULL.
-- =============================================================================

-- Seal any hosted event before the user row is removed. This is intentionally a
-- lifecycle seal, not a synthetic outcome snapshot: account erasure must not
-- manufacture analytics. Existing snapshots remain preserved if they already exist.
create or replace function public.seal_hosted_events_before_account_erasure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove dormant bypass secrets while the host relationship is still known.
  delete from public.event_access_secrets secret
  using public.events e
  where secret.event_id = e.id
    and e.host_id = old.id;

  update public.events e
  set ends_at = least(coalesce(e.ends_at, now()), now()),
      finalized_at = coalesce(e.finalized_at, now())
  where e.host_id = old.id
    and e.finalized_at is null;

  return old;
end;
$$;

revoke all on function public.seal_hosted_events_before_account_erasure() from public;

drop trigger if exists seal_hosted_events_before_account_erasure on public.users;
create trigger seal_hosted_events_before_account_erasure
before delete on public.users
for each row execute function public.seal_hosted_events_before_account_erasure();

-- Event ownership becomes nullable archival provenance rather than a cascade
-- delete vector. Active host checks already fail closed when host_id is NULL.
alter table public.events
  alter column host_id drop not null;

alter table public.events
  drop constraint if exists events_host_id_fkey;

alter table public.events
  add constraint events_host_id_fkey
  foreign key (host_id) references public.users(id) on delete set null;

-- Outcome snapshots are aggregate event evidence. Preserve them after host erasure
-- while removing the personal host reference. Organizer-learning memory remains
-- host-owned and may continue cascading with the deleted account.
alter table public.event_outcome_snapshots
  alter column host_id drop not null;

alter table public.event_outcome_snapshots
  drop constraint if exists event_outcome_snapshots_host_id_fkey;

alter table public.event_outcome_snapshots
  add constraint event_outcome_snapshots_host_id_fkey
  foreign key (host_id) references public.users(id) on delete set null;

comment on function public.seal_hosted_events_before_account_erasure() is
  'Seals unfinalized hosted events and removes access secrets before account erasure, preserving only the event container and existing privacy-safe aggregate snapshots.';
