-- Offline handshake state-machine hardening
--
-- Migration 059 introduced the bilateral reconciliation protocol. This follow-up
-- makes its trust assumptions enforceable at the database boundary so future
-- SECURITY DEFINER code cannot accidentally jump capability states or rewrite
-- confirmation / verification evidence in place.

create or replace function public.enforce_event_handshake_capability_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allowed boolean := false;
begin
  -- Identity, protocol material, and validity windows are immutable after mint.
  if new.event_id is distinct from old.event_id
     or new.initiator_id is distinct from old.initiator_id
     or new.protocol_version is distinct from old.protocol_version
     or new.offer_token_hash is distinct from old.offer_token_hash
     or new.manual_code_hash is distinct from old.manual_code_hash
     or new.valid_from is distinct from old.valid_from
     or new.expires_at is distinct from old.expires_at
     or new.reconcile_until is distinct from old.reconcile_until
     or new.issued_at is distinct from old.issued_at then
    raise exception 'offline handshake capability identity or validity material is immutable';
  end if;

  -- Once recorded, presentation time is evidence and cannot be rewritten.
  if old.presented_at is not null and new.presented_at is distinct from old.presented_at then
    raise exception 'offline handshake presented_at is immutable once set';
  end if;

  -- Idempotent writes inside the same state remain legal so RPC retries can
  -- safely converge, but terminal metadata still cannot be cleared or changed.
  if new.state = old.state then
    if old.terminal_at is not null and new.terminal_at is distinct from old.terminal_at then
      raise exception 'offline handshake terminal_at is immutable';
    end if;
    if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
      raise exception 'offline handshake consumed_at is immutable';
    end if;
    return new;
  end if;

  -- Terminal states are absorbing. Reconciliation may be retried, but it may
  -- never resurrect a capability after verification, expiry, safety invalidation,
  -- replay rejection, conflict, or cancellation.
  if old.state in (
    'server-verified',
    'expired',
    'replay-rejected',
    'authorization-invalidated',
    'blocked',
    'conflict',
    'cancelled'
  ) then
    raise exception 'offline handshake terminal state % cannot transition to %', old.state, new.state;
  end if;

  v_allowed := case old.state
    when 'prepared' then new.state in (
      'presented',
      'pending-reconciliation',
      'counterparty-confirmed',
      'server-verified',
      'expired',
      'replay-rejected',
      'authorization-invalidated',
      'blocked',
      'conflict',
      'cancelled'
    )
    when 'presented' then new.state in (
      'pending-reconciliation',
      'counterparty-confirmed',
      'server-verified',
      'expired',
      'replay-rejected',
      'authorization-invalidated',
      'blocked',
      'conflict',
      'cancelled'
    )
    when 'pending-reconciliation' then new.state in (
      'server-verified',
      'expired',
      'replay-rejected',
      'authorization-invalidated',
      'blocked',
      'conflict',
      'cancelled'
    )
    when 'counterparty-confirmed' then new.state in (
      'server-verified',
      'expired',
      'replay-rejected',
      'authorization-invalidated',
      'blocked',
      'conflict',
      'cancelled'
    )
    else false
  end;

  if not v_allowed then
    raise exception 'illegal offline handshake transition: % -> %', old.state, new.state;
  end if;

  if new.state in (
    'server-verified',
    'expired',
    'replay-rejected',
    'authorization-invalidated',
    'blocked',
    'conflict',
    'cancelled'
  ) and new.terminal_at is null then
    raise exception 'terminal offline handshake state requires terminal_at';
  end if;

  if new.state = 'server-verified' and new.consumed_at is null then
    raise exception 'server-verified offline handshake requires consumed_at';
  end if;

  return new;
end;
$$;

drop trigger if exists event_handshake_capability_transition_guard
  on public.event_handshake_capabilities;
create trigger event_handshake_capability_transition_guard
before update on public.event_handshake_capabilities
for each row
execute function public.enforce_event_handshake_capability_transition();

-- Confirmation and verification rows represent already-submitted evidence.
-- They may disappear only through existing privileged lifecycle/cascade behavior;
-- in-place mutation is forbidden so audit semantics cannot be silently rewritten.
create or replace function public.reject_event_handshake_evidence_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'offline handshake evidence rows are immutable';
end;
$$;

drop trigger if exists event_handshake_confirmation_update_guard
  on public.event_handshake_confirmations;
create trigger event_handshake_confirmation_update_guard
before update on public.event_handshake_confirmations
for each row
execute function public.reject_event_handshake_evidence_update();

drop trigger if exists event_handshake_verification_update_guard
  on public.event_handshake_verifications;
create trigger event_handshake_verification_update_guard
before update on public.event_handshake_verifications
for each row
execute function public.reject_event_handshake_evidence_update();

drop trigger if exists event_handshake_audit_update_guard
  on public.event_handshake_audit;
create trigger event_handshake_audit_update_guard
before update on public.event_handshake_audit
for each row
execute function public.reject_event_handshake_evidence_update();

comment on function public.enforce_event_handshake_capability_transition() is
  'Database-level offline handshake state-machine guard. Terminal states are absorbing and capability identity, validity, presentation, consumption, and terminal evidence cannot be rewritten.';

comment on function public.reject_event_handshake_evidence_update() is
  'Prevents in-place mutation of offline handshake confirmations, verifications, and protocol audit evidence.';
