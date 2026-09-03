-- Offline event continuity: explicit physical handshakes
--
-- Beacon's networking loop must survive venue connectivity failure without
-- degrading into passive encounter logging. This migration introduces a
-- short-lived, server-minted capability plus a two-device acknowledgement
-- protocol. The capability contains no reusable participant identifier; the
-- database resolves it back to the authenticated initiator. Both devices must
-- explicitly confirm the same acknowledgement nonce before immutable evidence
-- can be created.
--
-- IMPORTANT TRUST BOUNDARY
-- Offline confirmation establishes an explicit bilateral attestation under a
-- short-lived event capability. It is not cryptographic distance bounding and
-- does not prove centimeter-level physical co-presence. Client clocks are used
-- only as bounded claims. The server re-checks authorization, safety state,
-- replay state, event scope, and reconciliation grace before verification.

create table if not exists public.event_handshake_capabilities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  initiator_id uuid not null references public.users(id) on delete cascade,
  protocol_version smallint not null default 1 check (protocol_version = 1),
  offer_token_hash text not null unique,
  manual_code_hash text not null unique,
  valid_from timestamptz not null,
  expires_at timestamptz not null,
  reconcile_until timestamptz not null,
  state text not null default 'prepared' check (state in (
    'prepared',
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
  )),
  issued_at timestamptz not null default now(),
  presented_at timestamptz,
  consumed_at timestamptz,
  terminal_at timestamptz,
  check (expires_at > valid_from),
  check (expires_at <= valid_from + interval '25 minutes'),
  check (reconcile_until > expires_at),
  check (reconcile_until <= expires_at + interval '6 hours 5 minutes'),
  check ((state <> 'server-verified') or consumed_at is not null),
  check ((state not in ('server-verified','expired','replay-rejected','authorization-invalidated','blocked','conflict','cancelled')) or terminal_at is not null)
);

create table if not exists public.event_handshake_confirmations (
  capability_id uuid not null references public.event_handshake_capabilities(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('initiator','responder')),
  ack_hash text not null,
  transport text not null check (transport in ('qr','manual','nfc','ble')),
  client_claimed_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (capability_id, role)
);

create table if not exists public.event_handshake_verifications (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null unique references public.event_handshake_capabilities(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete cascade,
  initiator_id uuid not null references public.users(id) on delete restrict,
  responder_id uuid not null references public.users(id) on delete restrict,
  evidence_class text not null check (evidence_class in (
    'explicit-local-handshake',
    'server-live-handshake'
  )),
  interaction_window_start timestamptz not null,
  interaction_window_end timestamptz not null,
  verified_at timestamptz not null default now(),
  check (initiator_id <> responder_id),
  check (interaction_window_end > interaction_window_start)
);

-- Append-only protocol audit. No raw token, acknowledgement nonce, device ID,
-- profile information, or pair identity is stored here. It exists so operators
-- can debug protocol health without creating a social-interaction dossier.
create table if not exists public.event_handshake_audit (
  id bigint generated always as identity primary key,
  capability_id uuid not null references public.event_handshake_capabilities(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  event_type text not null check (event_type in (
    'capability-issued',
    'presented',
    'initiator-confirmed',
    'responder-confirmed',
    'verified',
    'expired',
    'cancelled',
    'replay-rejected',
    'authorization-invalidated',
    'blocked',
    'conflict'
  )),
  reason_code text,
  recorded_at timestamptz not null default now()
);

create index if not exists event_handshake_capabilities_event_user_idx
  on public.event_handshake_capabilities (event_id, initiator_id, issued_at desc);
create index if not exists event_handshake_capabilities_reconcile_idx
  on public.event_handshake_capabilities (reconcile_until, state);
create index if not exists event_handshake_confirmations_event_participant_idx
  on public.event_handshake_confirmations (event_id, participant_id, received_at desc);
create index if not exists event_handshake_verifications_event_idx
  on public.event_handshake_verifications (event_id, verified_at desc);
create index if not exists event_handshake_verifications_participants_idx
  on public.event_handshake_verifications (event_id, initiator_id, responder_id);
create index if not exists event_handshake_audit_event_time_idx
  on public.event_handshake_audit (event_id, recorded_at desc);

alter table public.event_handshake_capabilities enable row level security;
alter table public.event_handshake_confirmations enable row level security;
alter table public.event_handshake_verifications enable row level security;
alter table public.event_handshake_audit enable row level security;

-- All raw state is RPC-only. In particular, a client must never be able to read
-- a token digest, enumerate pending counterparties, or inspect another person's
-- confirmation record.
revoke all on public.event_handshake_capabilities from authenticated, anon;
revoke all on public.event_handshake_confirmations from authenticated, anon;
revoke all on public.event_handshake_verifications from authenticated, anon;
revoke all on public.event_handshake_audit from authenticated, anon;

create or replace function public.event_handshake_pair_safety_hold(
  p_event_id uuid,
  p_left_id uuid,
  p_right_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = p_left_id and b.blocked_id = p_right_id)
         or (b.blocker_id = p_right_id and b.blocked_id = p_left_id)
    )
    or exists (
      select 1
      from public.abuse_reports r
      where (
        (r.reporter_id = p_left_id and r.target_id = p_right_id)
        or (r.reporter_id = p_right_id and r.target_id = p_left_id)
      )
        and (r.event_id is null or r.event_id = p_event_id)
    );
$$;

create or replace function public.event_handshake_participant_authorized(
  p_event_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = p_user_id
      and ep.status = 'approved'
  );
$$;

create or replace function public.event_handshake_effective_reconcile_until(
  p_capability_id uuid
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select least(
    c.reconcile_until,
    coalesce(e.ended_at, e.ends_at, c.expires_at) + interval '6 hours'
  )
  from public.event_handshake_capabilities c
  join public.events e on e.id = c.event_id
  where c.id = p_capability_id;
$$;

create or replace function public.event_handshake_result(
  p_capability_id uuid,
  p_viewer_id uuid
)
returns table (
  handshake_state text,
  verification_id uuid,
  evidence_class text,
  other_user_id uuid,
  other_name text,
  other_role text,
  reason_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.state,
    v.id,
    v.evidence_class,
    case
      when v.initiator_id = p_viewer_id then v.responder_id
      when v.responder_id = p_viewer_id then v.initiator_id
      else null
    end,
    u.name,
    u.role,
    case
      when c.state = 'expired' then 'reconciliation-window-expired'
      when c.state = 'blocked' then 'safety-boundary-active'
      when c.state = 'authorization-invalidated' then 'participant-authorization-invalid'
      when c.state = 'replay-rejected' then 'replay-rejected'
      when c.state = 'conflict' then 'confirmation-conflict'
      when c.state = 'cancelled' then 'cancelled-by-initiator'
      else null
    end
  from public.event_handshake_capabilities c
  left join public.event_handshake_verifications v on v.capability_id = c.id
  left join public.users u on u.id = case
    when v.initiator_id = p_viewer_id then v.responder_id
    when v.responder_id = p_viewer_id then v.initiator_id
    else null
  end
  where c.id = p_capability_id
    and (
      c.initiator_id = p_viewer_id
      or exists (
        select 1
        from public.event_handshake_confirmations hc
        where hc.capability_id = c.id
          and hc.participant_id = p_viewer_id
      )
    );
$$;

-- Internal finalizer. It is called after either role reconciles. A capability is
-- locked transactionally so simultaneous reconnects converge on one immutable
-- verification rather than racing two outcomes into existence.
create or replace function public.finalize_event_handshake(p_capability_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capability public.event_handshake_capabilities%rowtype;
  v_initiator public.event_handshake_confirmations%rowtype;
  v_responder public.event_handshake_confirmations%rowtype;
  v_effective_until timestamptz;
  v_evidence_class text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_capability_id::text, 0));

  select * into v_capability
  from public.event_handshake_capabilities c
  where c.id = p_capability_id
  for update;

  if not found then
    return;
  end if;

  if v_capability.state in (
    'server-verified','expired','replay-rejected','authorization-invalidated',
    'blocked','conflict','cancelled'
  ) then
    return;
  end if;

  select * into v_initiator
  from public.event_handshake_confirmations hc
  where hc.capability_id = p_capability_id
    and hc.role = 'initiator';

  if not found then
    return;
  end if;

  select * into v_responder
  from public.event_handshake_confirmations hc
  where hc.capability_id = p_capability_id
    and hc.role = 'responder';

  if not found then
    return;
  end if;

  v_effective_until := public.event_handshake_effective_reconcile_until(p_capability_id);
  if v_effective_until is null or now() > v_effective_until then
    update public.event_handshake_capabilities
    set state = 'expired', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'expired', 'reconciliation-window-expired');
    return;
  end if;

  if v_initiator.participant_id <> v_capability.initiator_id
     or v_responder.participant_id = v_capability.initiator_id then
    update public.event_handshake_capabilities
    set state = 'authorization-invalidated', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'authorization-invalidated', 'role-identity-invalid');
    return;
  end if;

  if not public.event_handshake_participant_authorized(v_capability.event_id, v_capability.initiator_id)
     or not public.event_handshake_participant_authorized(v_capability.event_id, v_responder.participant_id) then
    update public.event_handshake_capabilities
    set state = 'authorization-invalidated', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'authorization-invalidated', 'participant-no-longer-approved');
    return;
  end if;

  if public.event_handshake_pair_safety_hold(
    v_capability.event_id,
    v_capability.initiator_id,
    v_responder.participant_id
  ) then
    update public.event_handshake_capabilities
    set state = 'blocked', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'blocked', 'safety-boundary-active');
    return;
  end if;

  if v_initiator.ack_hash <> v_responder.ack_hash then
    update public.event_handshake_capabilities
    set state = 'conflict', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'conflict', 'acknowledgement-mismatch');
    return;
  end if;

  -- Client timestamps are explicitly non-authoritative. They are bounded only to
  -- reject obviously stale/mutated records and to ensure the two explicit taps
  -- describe approximately the same local interaction.
  if v_initiator.client_claimed_at < v_capability.valid_from - interval '5 minutes'
     or v_initiator.client_claimed_at > v_capability.expires_at + interval '5 minutes'
     or v_responder.client_claimed_at < v_capability.valid_from - interval '5 minutes'
     or v_responder.client_claimed_at > v_capability.expires_at + interval '5 minutes'
     or abs(extract(epoch from (v_initiator.client_claimed_at - v_responder.client_claimed_at))) > 600 then
    update public.event_handshake_capabilities
    set state = 'conflict', terminal_at = now()
    where id = p_capability_id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (p_capability_id, v_capability.event_id, 'conflict', 'claimed-time-window-conflict');
    return;
  end if;

  v_evidence_class := case
    when v_initiator.received_at <= v_capability.expires_at + interval '30 seconds'
     and v_responder.received_at <= v_capability.expires_at + interval '30 seconds'
     and public.is_event_operational(v_capability.event_id)
      then 'server-live-handshake'
    else 'explicit-local-handshake'
  end;

  insert into public.event_handshake_verifications (
    capability_id,
    event_id,
    initiator_id,
    responder_id,
    evidence_class,
    interaction_window_start,
    interaction_window_end
  ) values (
    p_capability_id,
    v_capability.event_id,
    v_capability.initiator_id,
    v_responder.participant_id,
    v_evidence_class,
    v_capability.valid_from,
    v_capability.expires_at
  )
  on conflict (capability_id) do nothing;

  update public.event_handshake_capabilities
  set state = 'server-verified', consumed_at = now(), terminal_at = now()
  where id = p_capability_id;

  insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
  values (p_capability_id, v_capability.event_id, 'verified', v_evidence_class);
end;
$$;

create or replace function public.prepare_event_handshake_capabilities(
  p_event_id uuid,
  p_count integer default 8
)
returns table (
  capability_id uuid,
  event_id uuid,
  offer_token text,
  manual_code text,
  protocol_version smallint,
  valid_from timestamptz,
  expires_at timestamptz,
  reconcile_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := greatest(1, least(coalesce(p_count, 8), 8));
  v_recent_count integer;
  v_event_end timestamptz;
  v_valid_from timestamptz;
  v_expires_at timestamptz;
  v_reconcile_until timestamptz;
  v_offer_token text;
  v_manual_code text;
  v_id uuid;
  i integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'event is not operational';
  end if;
  if not public.event_handshake_participant_authorized(p_event_id, auth.uid()) then
    raise exception 'approved event participation required';
  end if;

  select e.ends_at into v_event_end
  from public.events e
  where e.id = p_event_id;

  update public.event_handshake_capabilities c
  set state = 'expired', terminal_at = now()
  where c.event_id = p_event_id
    and c.initiator_id = auth.uid()
    and c.state in ('prepared','presented','pending-reconciliation','counterparty-confirmed')
    and c.reconcile_until < now();

  select count(*)::integer into v_recent_count
  from public.event_handshake_capabilities c
  where c.event_id = p_event_id
    and c.initiator_id = auth.uid()
    and c.issued_at >= now() - interval '30 minutes';

  if v_recent_count + v_count > 24 then
    raise exception 'offline handshake capability preparation is temporarily rate limited';
  end if;

  for i in 0..(v_count - 1) loop
    -- Overlapping 20 minute capabilities every ten minutes provide continuity
    -- for roughly ninety minutes while keeping any one presented capability
    -- short-lived. The client refreshes the pool whenever connectivity returns.
    v_valid_from := now() + make_interval(mins => i * 10);
    v_expires_at := v_valid_from + interval '20 minutes';
    if v_event_end is not null then
      v_expires_at := least(v_expires_at, v_event_end);
    end if;
    exit when v_expires_at <= v_valid_from + interval '1 minute';

    v_reconcile_until := v_expires_at + interval '6 hours';
    if v_event_end is not null then
      v_reconcile_until := least(v_reconcile_until, v_event_end + interval '6 hours');
    end if;

    v_offer_token := encode(gen_random_bytes(24), 'hex');
    v_manual_code := upper(encode(gen_random_bytes(8), 'hex'));

    insert into public.event_handshake_capabilities (
      event_id,
      initiator_id,
      offer_token_hash,
      manual_code_hash,
      valid_from,
      expires_at,
      reconcile_until
    ) values (
      p_event_id,
      auth.uid(),
      encode(digest(v_offer_token, 'sha256'), 'hex'),
      encode(digest(v_manual_code, 'sha256'), 'hex'),
      v_valid_from,
      v_expires_at,
      v_reconcile_until
    )
    returning id into v_id;

    insert into public.event_handshake_audit (capability_id, event_id, event_type)
    values (v_id, p_event_id, 'capability-issued');

    capability_id := v_id;
    event_id := p_event_id;
    offer_token := v_offer_token;
    manual_code := v_manual_code;
    protocol_version := 1;
    valid_from := v_valid_from;
    expires_at := v_expires_at;
    reconcile_until := v_reconcile_until;
    return next;
  end loop;
end;
$$;

create or replace function public.mark_my_handshake_presented(p_capability_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.event_handshake_capabilities c
  set
    state = case when c.state = 'prepared' then 'presented' else c.state end,
    presented_at = coalesce(c.presented_at, now())
  where c.id = p_capability_id
    and c.initiator_id = auth.uid()
    and c.state in ('prepared','presented')
    and now() between c.valid_from - interval '2 minutes' and c.expires_at;

  if found then
    insert into public.event_handshake_audit (capability_id, event_id, event_type)
    select c.id, c.event_id, 'presented'
    from public.event_handshake_capabilities c
    where c.id = p_capability_id
      and not exists (
        select 1 from public.event_handshake_audit a
        where a.capability_id = c.id and a.event_type = 'presented'
      );
  end if;

  return found;
end;
$$;

create or replace function public.submit_handshake_responder_confirmation(
  p_event_id uuid,
  p_capability_id uuid,
  p_offer_token text,
  p_manual_code text,
  p_ack_nonce text,
  p_transport text,
  p_claimed_confirmed_at timestamptz
)
returns table (
  handshake_state text,
  verification_id uuid,
  evidence_class text,
  other_user_id uuid,
  other_name text,
  other_role text,
  reason_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capability public.event_handshake_capabilities%rowtype;
  v_existing public.event_handshake_confirmations%rowtype;
  v_ack_hash text;
  v_offer_normalized text;
  v_manual_normalized text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_transport not in ('qr','manual','nfc','ble') then
    raise exception 'unsupported handshake transport';
  end if;
  if p_ack_nonce is null or p_ack_nonce !~ '^[0-9A-Fa-f]{20,64}$' then
    raise exception 'invalid acknowledgement nonce';
  end if;
  if p_claimed_confirmed_at is null then
    raise exception 'claimed confirmation time required';
  end if;

  v_offer_normalized := lower(trim(coalesce(p_offer_token, '')));
  v_manual_normalized := upper(regexp_replace(coalesce(p_manual_code, ''), '[^A-Fa-f0-9]', '', 'g'));

  if p_capability_id is not null and length(v_offer_normalized) > 0 then
    select * into v_capability
    from public.event_handshake_capabilities c
    where c.id = p_capability_id
      and c.event_id = p_event_id
      and c.offer_token_hash = encode(digest(v_offer_normalized, 'sha256'), 'hex')
    for update;
  elsif length(v_manual_normalized) > 0 then
    select * into v_capability
    from public.event_handshake_capabilities c
    where c.event_id = p_event_id
      and c.manual_code_hash = encode(digest(v_manual_normalized, 'sha256'), 'hex')
    for update;
  else
    raise exception 'handshake capability required';
  end if;

  if not found then
    raise exception 'handshake capability rejected';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_capability.id::text, 0));
  select * into v_capability
  from public.event_handshake_capabilities c
  where c.id = v_capability.id
  for update;

  if v_capability.state in ('server-verified','expired','authorization-invalidated','blocked','conflict','cancelled') then
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if now() > public.event_handshake_effective_reconcile_until(v_capability.id) then
    update public.event_handshake_capabilities
    set state = 'expired', terminal_at = now()
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (v_capability.id, p_event_id, 'expired', 'reconciliation-window-expired');
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if auth.uid() = v_capability.initiator_id
     or not public.event_handshake_participant_authorized(p_event_id, auth.uid())
     or not public.event_handshake_participant_authorized(p_event_id, v_capability.initiator_id) then
    raise exception 'handshake participant authorization rejected';
  end if;

  if public.event_handshake_pair_safety_hold(p_event_id, v_capability.initiator_id, auth.uid()) then
    update public.event_handshake_capabilities
    set state = 'blocked', terminal_at = now()
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (v_capability.id, p_event_id, 'blocked', 'safety-boundary-active');
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if p_claimed_confirmed_at < v_capability.valid_from - interval '5 minutes'
     or p_claimed_confirmed_at > v_capability.expires_at + interval '5 minutes' then
    raise exception 'handshake claimed time outside capability window';
  end if;

  v_ack_hash := encode(digest(lower(p_ack_nonce), 'sha256'), 'hex');

  select * into v_existing
  from public.event_handshake_confirmations hc
  where hc.capability_id = v_capability.id
    and hc.role = 'responder';

  if found then
    if v_existing.participant_id <> auth.uid() or v_existing.ack_hash <> v_ack_hash then
      insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
      values (v_capability.id, p_event_id, 'replay-rejected', 'different-responder-or-ack');
      handshake_state := 'replay-rejected';
      verification_id := null;
      evidence_class := null;
      other_user_id := null;
      other_name := null;
      other_role := null;
      reason_code := 'replay-rejected';
      return next;
      return;
    end if;
  else
    insert into public.event_handshake_confirmations (
      capability_id, event_id, participant_id, role, ack_hash, transport, client_claimed_at
    ) values (
      v_capability.id, p_event_id, auth.uid(), 'responder', v_ack_hash, p_transport, p_claimed_confirmed_at
    );
    update public.event_handshake_capabilities
    set state = case
      when state in ('prepared','presented') then 'counterparty-confirmed'
      else state
    end
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type)
    values (v_capability.id, p_event_id, 'responder-confirmed');
  end if;

  perform public.finalize_event_handshake(v_capability.id);
  return query select * from public.event_handshake_result(v_capability.id, auth.uid());
end;
$$;

create or replace function public.submit_handshake_initiator_confirmation(
  p_event_id uuid,
  p_capability_id uuid,
  p_offer_token text,
  p_manual_code text,
  p_ack_nonce text,
  p_transport text,
  p_claimed_confirmed_at timestamptz
)
returns table (
  handshake_state text,
  verification_id uuid,
  evidence_class text,
  other_user_id uuid,
  other_name text,
  other_role text,
  reason_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capability public.event_handshake_capabilities%rowtype;
  v_existing public.event_handshake_confirmations%rowtype;
  v_ack_hash text;
  v_offer_normalized text;
  v_manual_normalized text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_transport not in ('qr','manual','nfc','ble') then
    raise exception 'unsupported handshake transport';
  end if;
  if p_ack_nonce is null or p_ack_nonce !~ '^[0-9A-Fa-f]{20,64}$' then
    raise exception 'invalid acknowledgement nonce';
  end if;
  if p_claimed_confirmed_at is null then
    raise exception 'claimed confirmation time required';
  end if;

  v_offer_normalized := lower(trim(coalesce(p_offer_token, '')));
  v_manual_normalized := upper(regexp_replace(coalesce(p_manual_code, ''), '[^A-Fa-f0-9]', '', 'g'));

  if p_capability_id is not null and length(v_offer_normalized) > 0 then
    select * into v_capability
    from public.event_handshake_capabilities c
    where c.id = p_capability_id
      and c.event_id = p_event_id
      and c.offer_token_hash = encode(digest(v_offer_normalized, 'sha256'), 'hex')
    for update;
  elsif p_capability_id is not null and length(v_manual_normalized) > 0 then
    select * into v_capability
    from public.event_handshake_capabilities c
    where c.id = p_capability_id
      and c.event_id = p_event_id
      and c.manual_code_hash = encode(digest(v_manual_normalized, 'sha256'), 'hex')
    for update;
  else
    raise exception 'initiator capability required';
  end if;

  if not found or v_capability.initiator_id <> auth.uid() then
    raise exception 'initiator capability rejected';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_capability.id::text, 0));
  select * into v_capability
  from public.event_handshake_capabilities c
  where c.id = v_capability.id
  for update;

  if v_capability.state in ('server-verified','expired','authorization-invalidated','blocked','conflict','cancelled') then
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if now() > public.event_handshake_effective_reconcile_until(v_capability.id) then
    update public.event_handshake_capabilities
    set state = 'expired', terminal_at = now()
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (v_capability.id, p_event_id, 'expired', 'reconciliation-window-expired');
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if not public.event_handshake_participant_authorized(p_event_id, auth.uid()) then
    update public.event_handshake_capabilities
    set state = 'authorization-invalidated', terminal_at = now()
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    values (v_capability.id, p_event_id, 'authorization-invalidated', 'initiator-no-longer-approved');
    return query select * from public.event_handshake_result(v_capability.id, auth.uid());
    return;
  end if;

  if p_claimed_confirmed_at < v_capability.valid_from - interval '5 minutes'
     or p_claimed_confirmed_at > v_capability.expires_at + interval '5 minutes' then
    raise exception 'handshake claimed time outside capability window';
  end if;

  v_ack_hash := encode(digest(lower(p_ack_nonce), 'sha256'), 'hex');

  select * into v_existing
  from public.event_handshake_confirmations hc
  where hc.capability_id = v_capability.id
    and hc.role = 'initiator';

  if found then
    if v_existing.participant_id <> auth.uid() or v_existing.ack_hash <> v_ack_hash then
      insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
      values (v_capability.id, p_event_id, 'replay-rejected', 'initiator-ack-changed');
      handshake_state := 'replay-rejected';
      verification_id := null;
      evidence_class := null;
      other_user_id := null;
      other_name := null;
      other_role := null;
      reason_code := 'replay-rejected';
      return next;
      return;
    end if;
  else
    insert into public.event_handshake_confirmations (
      capability_id, event_id, participant_id, role, ack_hash, transport, client_claimed_at
    ) values (
      v_capability.id, p_event_id, auth.uid(), 'initiator', v_ack_hash, p_transport, p_claimed_confirmed_at
    );
    update public.event_handshake_capabilities
    set state = case
      when state in ('prepared','presented') then 'pending-reconciliation'
      else state
    end
    where id = v_capability.id;
    insert into public.event_handshake_audit (capability_id, event_id, event_type)
    values (v_capability.id, p_event_id, 'initiator-confirmed');
  end if;

  perform public.finalize_event_handshake(v_capability.id);
  return query select * from public.event_handshake_result(v_capability.id, auth.uid());
end;
$$;

create or replace function public.cancel_my_handshake_capability(p_capability_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_capability_id::text, 0));

  update public.event_handshake_capabilities c
  set state = 'cancelled', terminal_at = now()
  where c.id = p_capability_id
    and c.initiator_id = auth.uid()
    and c.state in ('prepared','presented','pending-reconciliation','counterparty-confirmed');

  if found then
    insert into public.event_handshake_audit (capability_id, event_id, event_type)
    select c.id, c.event_id, 'cancelled'
    from public.event_handshake_capabilities c
    where c.id = p_capability_id;
  end if;

  return found;
end;
$$;

create or replace function public.get_my_verified_event_handshakes(p_event_id uuid)
returns table (
  verification_id uuid,
  capability_id uuid,
  event_id uuid,
  other_user_id uuid,
  other_name text,
  other_role text,
  evidence_class text,
  interaction_window_start timestamptz,
  interaction_window_end timestamptz,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.capability_id,
    v.event_id,
    case when v.initiator_id = auth.uid() then v.responder_id else v.initiator_id end as other_user_id,
    u.name,
    u.role,
    v.evidence_class,
    v.interaction_window_start,
    v.interaction_window_end,
    v.verified_at
  from public.event_handshake_verifications v
  join public.users u on u.id = case when v.initiator_id = auth.uid() then v.responder_id else v.initiator_id end
  where v.event_id = p_event_id
    and (v.initiator_id = auth.uid() or v.responder_id = auth.uid())
    and public.event_handshake_participant_authorized(p_event_id, auth.uid())
  order by v.verified_at desc
  limit 100;
$$;

-- Host-only, cohort-gated protocol health. This is operational telemetry, not a
-- leaderboard and not a participant outcome funnel.
create or replace function public.get_event_handshake_health(p_event_id uuid)
returns table (
  supported boolean,
  capability_count integer,
  verified_count integer,
  pending_count integer,
  expired_count integer,
  conflict_count integer,
  safety_block_count integer,
  offline_verified_count integer,
  server_live_verified_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capability_count integer;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then
    return;
  end if;

  select count(*)::integer into v_capability_count
  from public.event_handshake_capabilities c
  where c.event_id = p_event_id;

  if v_capability_count < 5 then
    return query select false, null::integer, null::integer, null::integer, null::integer,
      null::integer, null::integer, null::integer, null::integer;
    return;
  end if;

  return query
  select
    true,
    v_capability_count,
    count(*) filter (where c.state = 'server-verified')::integer,
    count(*) filter (where c.state in ('prepared','presented','pending-reconciliation','counterparty-confirmed'))::integer,
    count(*) filter (where c.state = 'expired')::integer,
    count(*) filter (where c.state in ('conflict','replay-rejected'))::integer,
    count(*) filter (where c.state = 'blocked')::integer,
    count(*) filter (where v.evidence_class = 'explicit-local-handshake')::integer,
    count(*) filter (where v.evidence_class = 'server-live-handshake')::integer
  from public.event_handshake_capabilities c
  left join public.event_handshake_verifications v on v.capability_id = c.id
  where c.event_id = p_event_id;
end;
$$;

create or replace function public.expire_stale_event_handshake_capabilities()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.event_handshake_capabilities c
    set state = 'expired', terminal_at = now()
    where c.state in ('prepared','presented','pending-reconciliation','counterparty-confirmed')
      and c.reconcile_until < now()
    returning c.id, c.event_id
  ), audit as (
    insert into public.event_handshake_audit (capability_id, event_id, event_type, reason_code)
    select e.id, e.event_id, 'expired', 'reconciliation-window-expired'
    from expired e
    returning 1
  )
  select count(*)::integer into v_count from expired;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.event_handshake_pair_safety_hold(uuid,uuid,uuid) from public;
revoke all on function public.event_handshake_participant_authorized(uuid,uuid) from public;
revoke all on function public.event_handshake_effective_reconcile_until(uuid) from public;
revoke all on function public.event_handshake_result(uuid,uuid) from public;
revoke all on function public.finalize_event_handshake(uuid) from public;
revoke all on function public.prepare_event_handshake_capabilities(uuid,integer) from public;
revoke all on function public.mark_my_handshake_presented(uuid) from public;
revoke all on function public.submit_handshake_responder_confirmation(uuid,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.submit_handshake_initiator_confirmation(uuid,uuid,text,text,text,text,timestamptz) from public;
revoke all on function public.cancel_my_handshake_capability(uuid) from public;
revoke all on function public.get_my_verified_event_handshakes(uuid) from public;
revoke all on function public.get_event_handshake_health(uuid) from public;
revoke all on function public.expire_stale_event_handshake_capabilities() from public;

grant execute on function public.prepare_event_handshake_capabilities(uuid,integer) to authenticated;
grant execute on function public.mark_my_handshake_presented(uuid) to authenticated;
grant execute on function public.submit_handshake_responder_confirmation(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.submit_handshake_initiator_confirmation(uuid,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.cancel_my_handshake_capability(uuid) to authenticated;
grant execute on function public.get_my_verified_event_handshakes(uuid) to authenticated;
grant execute on function public.get_event_handshake_health(uuid) to authenticated;

grant execute on function public.expire_stale_event_handshake_capabilities() to service_role;

comment on table public.event_handshake_capabilities is
  'Short-lived event-bound one-time capabilities. Plaintext offer material is returned once and never stored server-side.';
comment on table public.event_handshake_confirmations is
  'Server-private explicit role confirmations. Client timestamps are bounded claims, not authoritative clocks.';
comment on table public.event_handshake_verifications is
  'Immutable evidence that both authenticated participants reconciled the same acknowledgement under one event capability; it does not itself create a match.';
comment on function public.get_event_handshake_health(uuid) is
  'Host-only cohort-gated protocol health. No participant pair, token, device identifier, or raw confirmation is exposed.';
comment on function public.finalize_event_handshake(uuid) is
  'Internal transactional finalizer. Verification requires matching bilateral acknowledgement, current authorization, no safety hold, and an unexpired reconciliation window.';
