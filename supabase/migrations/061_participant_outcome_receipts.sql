-- Participant-owned outcome receipts
--
-- A mutual proves reciprocal connection intent. It does not prove what happened
-- afterward. This migration adds an append-only, participant-attested evidence
-- layer for bounded real-world next steps without inspecting messages, email,
-- calendars, response time, sentiment, movement, or private relationship state.
--
-- Trust language is intentionally narrow:
--   participant-attested       = one participant deliberately recorded a fact
--   counterpart-compatible     = both independently recorded compatible facts
--   bilaterally-confirmed      = both independently recorded the same fact
-- System context can strengthen provenance, but it never manufactures the
-- participant's semantic claim. A completed Office Hours row, for example, does
-- not automatically submit an "office hours occurred" receipt.

create type public.participant_outcome_receipt_type as enum (
  'spoke',
  'contact_exchanged',
  'follow_up_sent',
  'meeting_scheduled',
  'office_hours_occurred',
  'warm_introduction_completed',
  'hiring_conversation_continued',
  'partnership_conversation_continued',
  'mentor_session_occurred',
  'collaboration_continued',
  'feedback_received',
  'still_open',
  'no_further_action'
);

create table public.participant_outcome_receipt_streams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  participant_id uuid not null references public.users(id) on delete cascade,
  counterparty_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, participant_id),
  check (participant_id <> counterparty_id)
);

create table public.participant_outcome_receipt_events (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.participant_outcome_receipt_streams(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.users(id) on delete cascade,
  sequence_no integer not null check (sequence_no >= 1),
  event_type text not null check (event_type in ('submitted','withdrawn')),
  receipt_type public.participant_outcome_receipt_type,
  domains text[] not null default '{}',
  origin_context text not null check (origin_context in (
    'direct-mutual',
    'declared-fit-mutual',
    'explicit-physical-handshake',
    'focus-window',
    'office-hours',
    'warm-introduction',
    'community-exchange'
  )),
  system_evidence text[] not null default '{}',
  supersedes_event_id uuid references public.participant_outcome_receipt_events(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (stream_id, sequence_no),
  unique (participant_id, idempotency_key),
  check (char_length(idempotency_key) between 20 and 160),
  check ((event_type = 'submitted' and receipt_type is not null)
      or (event_type = 'withdrawn' and receipt_type is null)),
  check (domains <@ array[
    'capital','hiring','partnerships','customers','technical','product',
    'design','media','mentorship','community','research','operations'
  ]::text[]),
  check (cardinality(domains) <= 12),
  check (system_evidence <@ array[
    'verified-mutual',
    'declared-fit-mutual',
    'explicit-local-handshake',
    'server-live-handshake',
    'office-hours-completed',
    'warm-introduction-accepted',
    'focus-window-shared-opt-in',
    'community-exchange-context'
  ]::text[])
);

-- Context references are server-private provenance links. They let Beacon later
-- aggregate a receipt under an approved community exchange or explain that an
-- explicit handshake existed without putting pair-level context in a host view.
create table public.participant_outcome_receipt_context_links (
  id bigint generated always as identity primary key,
  receipt_event_id uuid not null references public.participant_outcome_receipt_events(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  context_kind text not null check (context_kind in (
    'verified-mutual',
    'declared-fit-mutual',
    'physical-handshake',
    'office-hours',
    'warm-introduction',
    'focus-window',
    'community-exchange'
  )),
  context_id uuid not null,
  evidence_class text not null check (evidence_class in (
    'verified-mutual',
    'declared-fit-mutual',
    'explicit-local-handshake',
    'server-live-handshake',
    'office-hours-completed',
    'warm-introduction-accepted',
    'focus-window-shared-opt-in',
    'community-exchange-context'
  )),
  recorded_at timestamptz not null default now(),
  unique (receipt_event_id, context_kind, context_id)
);

create index participant_outcome_receipt_streams_event_idx
  on public.participant_outcome_receipt_streams (event_id, match_id);
create index participant_outcome_receipt_events_stream_idx
  on public.participant_outcome_receipt_events (stream_id, sequence_no desc);
create index participant_outcome_receipt_events_event_idx
  on public.participant_outcome_receipt_events (event_id, created_at desc);
create index participant_outcome_receipt_context_event_idx
  on public.participant_outcome_receipt_context_links (event_id, context_kind, context_id);

alter table public.participant_outcome_receipt_streams enable row level security;
alter table public.participant_outcome_receipt_events enable row level security;
alter table public.participant_outcome_receipt_context_links enable row level security;

-- Raw history includes participant identity, revisions, and provenance links.
-- It is RPC-only. Hosts and community owners get cohort-gated aggregates only.
revoke all on public.participant_outcome_receipt_streams from authenticated, anon;
revoke all on public.participant_outcome_receipt_events from authenticated, anon;
revoke all on public.participant_outcome_receipt_context_links from authenticated, anon;

create or replace function public.reject_participant_outcome_receipt_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'participant outcome receipt evidence is append-only';
end;
$$;

create trigger participant_outcome_receipt_stream_update_guard
before update on public.participant_outcome_receipt_streams
for each row execute function public.reject_participant_outcome_receipt_update();

create trigger participant_outcome_receipt_event_update_guard
before update on public.participant_outcome_receipt_events
for each row execute function public.reject_participant_outcome_receipt_update();

create trigger participant_outcome_receipt_context_update_guard
before update on public.participant_outcome_receipt_context_links
for each row execute function public.reject_participant_outcome_receipt_update();

-- Compatibility is deliberately small and reviewable. Exact agreement is
-- stronger than semantic compatibility. We do not turn loosely related claims
-- such as "follow-up sent" and "meeting scheduled" into false confirmation.
create or replace function public.resolve_outcome_receipt_compatibility(
  p_left public.participant_outcome_receipt_type,
  p_right public.participant_outcome_receipt_type
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_left = p_right then 'exact'
    when (p_left, p_right) in (
      ('meeting_scheduled', 'office_hours_occurred'),
      ('office_hours_occurred', 'meeting_scheduled')
    ) then 'meeting-progression'
    when (p_left, p_right) in (
      ('mentor_session_occurred', 'office_hours_occurred'),
      ('office_hours_occurred', 'mentor_session_occurred')
    ) then 'session-occurred'
    when (p_left, p_right) in (
      ('spoke', 'office_hours_occurred'),
      ('office_hours_occurred', 'spoke')
    ) then 'conversation-occurred'
    when (p_left, p_right) in (
      ('partnership_conversation_continued', 'collaboration_continued'),
      ('collaboration_continued', 'partnership_conversation_continued')
    ) then 'continued-work'
    else null
  end;
$$;

create or replace function public.outcome_receipt_pair_blocked(
  p_left_id uuid,
  p_right_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = p_left_id and b.blocked_id = p_right_id)
       or (b.blocker_id = p_right_id and b.blocked_id = p_left_id)
  );
$$;

-- Snapshot only system facts Beacon already possesses. None of these facts submit
-- a receipt or establish its semantic truth. They are provenance for a separate
-- deliberate participant attestation.
create or replace function public.outcome_receipt_system_evidence(
  p_event_id uuid,
  p_match_id uuid,
  p_left_id uuid,
  p_right_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct evidence order by evidence), '{}'::text[])
  from (
    select 'verified-mutual'::text as evidence
    where exists (select 1 from public.matches m where m.id = p_match_id and m.event_id = p_event_id)

    union all
    select 'declared-fit-mutual'
    where exists (
      select 1 from public.declared_fit_mutual_contexts c
      where c.match_id = p_match_id and c.fit_class <> 'none'
    )

    union all
    select v.evidence_class
    from public.event_handshake_verifications v
    where v.event_id = p_event_id
      and ((v.initiator_id = p_left_id and v.responder_id = p_right_id)
        or (v.initiator_id = p_right_id and v.responder_id = p_left_id))

    union all
    select 'office-hours-completed'
    where exists (
      select 1 from public.office_hours_requests o
      where o.event_id = p_event_id and o.status = 'completed'
        and ((o.requester_id = p_left_id and o.recipient_id = p_right_id)
          or (o.requester_id = p_right_id and o.recipient_id = p_left_id))
    )

    union all
    select 'warm-introduction-accepted'
    where exists (
      select 1 from public.event_introduction_requests r
      where r.event_id = p_event_id and r.status in ('accepted','matched')
        and ((r.requester_id = p_left_id and r.target_id = p_right_id)
          or (r.requester_id = p_right_id and r.target_id = p_left_id))
    )

    union all
    select 'focus-window-shared-opt-in'
    where exists (
      select 1
      from public.event_focus_window_opt_ins a
      join public.event_focus_window_opt_ins b
        on b.window_id = a.window_id and b.user_id = p_right_id
      join public.event_focus_windows w on w.id = a.window_id
      where a.event_id = p_event_id and a.user_id = p_left_id
        and w.state <> 'cancelled' and w.ends_at <= now()
    )

    union all
    select 'community-exchange-context'
    where exists (
      select 1
      from public.community_exchange_agreements x
      join public.participant_event_community_affiliations a
        on a.event_id = x.event_id and a.user_id = p_left_id and a.exchange_enabled = true
      join public.participant_event_community_affiliations b
        on b.event_id = x.event_id and b.user_id = p_right_id and b.exchange_enabled = true
      where x.event_id = p_event_id and x.state in ('active','closed')
        and ((x.community_a_id = a.community_id and x.community_b_id = b.community_id)
          or (x.community_b_id = a.community_id and x.community_a_id = b.community_id))
    )
  ) evidence_rows;
$$;

create or replace function public.outcome_receipt_origin_context(
  p_event_id uuid,
  p_match_id uuid,
  p_left_id uuid,
  p_right_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.event_introduction_requests r
    where r.event_id = p_event_id and r.status in ('accepted','matched')
      and ((r.requester_id = p_left_id and r.target_id = p_right_id)
        or (r.requester_id = p_right_id and r.target_id = p_left_id))
  ) then return 'warm-introduction'; end if;

  if exists (
    select 1 from public.office_hours_requests o
    where o.event_id = p_event_id and o.status = 'completed'
      and ((o.requester_id = p_left_id and o.recipient_id = p_right_id)
        or (o.requester_id = p_right_id and o.recipient_id = p_left_id))
  ) then return 'office-hours'; end if;

  if exists (
    select 1 from public.event_handshake_verifications v
    where v.event_id = p_event_id
      and ((v.initiator_id = p_left_id and v.responder_id = p_right_id)
        or (v.initiator_id = p_right_id and v.responder_id = p_left_id))
  ) then return 'explicit-physical-handshake'; end if;

  if exists (
    select 1
    from public.event_focus_window_opt_ins a
    join public.event_focus_window_opt_ins b
      on b.window_id = a.window_id and b.user_id = p_right_id
    join public.event_focus_windows w on w.id = a.window_id
    where a.event_id = p_event_id and a.user_id = p_left_id
      and w.state <> 'cancelled' and w.ends_at <= now()
  ) then return 'focus-window'; end if;

  if exists (
    select 1
    from public.community_exchange_agreements x
    join public.participant_event_community_affiliations a
      on a.event_id = x.event_id and a.user_id = p_left_id and a.exchange_enabled = true
    join public.participant_event_community_affiliations b
      on b.event_id = x.event_id and b.user_id = p_right_id and b.exchange_enabled = true
    where x.event_id = p_event_id and x.state in ('active','closed')
      and ((x.community_a_id = a.community_id and x.community_b_id = b.community_id)
        or (x.community_b_id = a.community_id and x.community_a_id = b.community_id))
  ) then return 'community-exchange'; end if;

  if exists (
    select 1 from public.declared_fit_mutual_contexts c
    where c.match_id = p_match_id and c.fit_class <> 'none'
  ) then return 'declared-fit-mutual'; end if;

  return 'direct-mutual';
end;
$$;

create or replace function public.capture_outcome_receipt_context_links(
  p_receipt_event_id uuid,
  p_event_id uuid,
  p_match_id uuid,
  p_left_id uuid,
  p_right_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  ) values (
    p_receipt_event_id, p_event_id, 'verified-mutual', p_match_id, 'verified-mutual'
  ) on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select p_receipt_event_id, p_event_id, 'declared-fit-mutual', c.match_id, 'declared-fit-mutual'
  from public.declared_fit_mutual_contexts c
  where c.match_id = p_match_id and c.fit_class <> 'none'
  on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select p_receipt_event_id, p_event_id, 'physical-handshake', v.id, v.evidence_class
  from public.event_handshake_verifications v
  where v.event_id = p_event_id
    and ((v.initiator_id = p_left_id and v.responder_id = p_right_id)
      or (v.initiator_id = p_right_id and v.responder_id = p_left_id))
  on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select p_receipt_event_id, p_event_id, 'office-hours', o.id, 'office-hours-completed'
  from public.office_hours_requests o
  where o.event_id = p_event_id and o.status = 'completed'
    and ((o.requester_id = p_left_id and o.recipient_id = p_right_id)
      or (o.requester_id = p_right_id and o.recipient_id = p_left_id))
  on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select p_receipt_event_id, p_event_id, 'warm-introduction', r.id, 'warm-introduction-accepted'
  from public.event_introduction_requests r
  where r.event_id = p_event_id and r.status in ('accepted','matched')
    and ((r.requester_id = p_left_id and r.target_id = p_right_id)
      or (r.requester_id = p_right_id and r.target_id = p_left_id))
  on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select distinct p_receipt_event_id, p_event_id, 'focus-window', w.id, 'focus-window-shared-opt-in'
  from public.event_focus_window_opt_ins a
  join public.event_focus_window_opt_ins b
    on b.window_id = a.window_id and b.user_id = p_right_id
  join public.event_focus_windows w on w.id = a.window_id
  where a.event_id = p_event_id and a.user_id = p_left_id
    and w.state <> 'cancelled' and w.ends_at <= now()
  on conflict do nothing;

  insert into public.participant_outcome_receipt_context_links (
    receipt_event_id, event_id, context_kind, context_id, evidence_class
  )
  select distinct p_receipt_event_id, p_event_id, 'community-exchange', x.id, 'community-exchange-context'
  from public.community_exchange_agreements x
  join public.participant_event_community_affiliations a
    on a.event_id = x.event_id and a.user_id = p_left_id and a.exchange_enabled = true
  join public.participant_event_community_affiliations b
    on b.event_id = x.event_id and b.user_id = p_right_id and b.exchange_enabled = true
  where x.event_id = p_event_id and x.state in ('active','closed')
    and ((x.community_a_id = a.community_id and x.community_b_id = b.community_id)
      or (x.community_b_id = a.community_id and x.community_a_id = b.community_id))
  on conflict do nothing;
end;
$$;

create or replace function public.get_my_outcome_receipt(p_match_id uuid)
returns table (
  receipt_event_id uuid,
  stream_id uuid,
  lifecycle_state text,
  receipt_type public.participant_outcome_receipt_type,
  revision integer,
  alignment_state text,
  counterpart_receipt_type public.participant_outcome_receipt_type,
  compatibility_code text,
  domains text[],
  origin_context text,
  system_evidence text[],
  submitted_at timestamptz,
  can_submit boolean,
  observation_closes_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_counterparty uuid;
  v_own_stream public.participant_outcome_receipt_streams;
  v_peer_stream public.participant_outcome_receipt_streams;
  v_own public.participant_outcome_receipt_events;
  v_peer public.participant_outcome_receipt_events;
  v_blocked boolean;
  v_compatibility text;
  v_alignment text := 'none';
  v_close timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_match from public.matches m where m.id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'match access required';
  end if;

  v_counterparty := case when auth.uid() = v_match.user_a_id then v_match.user_b_id else v_match.user_a_id end;
  v_blocked := public.outcome_receipt_pair_blocked(auth.uid(), v_counterparty);
  v_close := v_match.created_at + interval '60 days';

  select * into v_own_stream
  from public.participant_outcome_receipt_streams s
  where s.match_id = p_match_id and s.participant_id = auth.uid();

  if v_own_stream.id is not null then
    select * into v_own
    from public.participant_outcome_receipt_events e
    where e.stream_id = v_own_stream.id
    order by e.sequence_no desc
    limit 1;
  end if;

  select * into v_peer_stream
  from public.participant_outcome_receipt_streams s
  where s.match_id = p_match_id and s.participant_id = v_counterparty;

  if v_peer_stream.id is not null then
    select * into v_peer
    from public.participant_outcome_receipt_events e
    where e.stream_id = v_peer_stream.id
    order by e.sequence_no desc
    limit 1;
  end if;

  if v_own.id is not null and v_own.event_type = 'submitted' then
    v_alignment := 'participant-attested';
    if not v_blocked and v_peer.id is not null and v_peer.event_type = 'submitted' then
      v_compatibility := public.resolve_outcome_receipt_compatibility(v_own.receipt_type, v_peer.receipt_type);
      if v_compatibility = 'exact' then
        v_alignment := 'bilaterally-confirmed';
      elsif v_compatibility is not null then
        v_alignment := 'counterpart-compatible';
      end if;
    end if;
  elsif v_own.id is not null and v_own.event_type = 'withdrawn' then
    v_alignment := 'withdrawn';
  end if;

  return query select
    v_own.id,
    v_own_stream.id,
    case
      when v_own.id is null then 'none'
      when v_own.event_type = 'withdrawn' then 'withdrawn'
      else 'submitted'
    end,
    case when v_own.event_type = 'submitted' then v_own.receipt_type else null end,
    coalesce(v_own.sequence_no, 0),
    v_alignment,
    case when v_compatibility is not null and not v_blocked then v_peer.receipt_type else null end,
    v_compatibility,
    case when v_own.event_type = 'submitted' then v_own.domains else '{}'::text[] end,
    case when v_own.event_type = 'submitted' then v_own.origin_context else 'direct-mutual' end,
    case when v_own.event_type = 'submitted' then v_own.system_evidence else '{}'::text[] end,
    case when v_own.event_type = 'submitted' then v_own.created_at else null end,
    (not v_blocked and now() <= v_close),
    v_close;
end;
$$;

create or replace function public.submit_my_outcome_receipt(
  p_match_id uuid,
  p_receipt_type public.participant_outcome_receipt_type,
  p_idempotency_key text
)
returns table (
  receipt_event_id uuid,
  stream_id uuid,
  lifecycle_state text,
  receipt_type public.participant_outcome_receipt_type,
  revision integer,
  alignment_state text,
  counterpart_receipt_type public.participant_outcome_receipt_type,
  compatibility_code text,
  domains text[],
  origin_context text,
  system_evidence text[],
  submitted_at timestamptz,
  can_submit boolean,
  observation_closes_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_counterparty uuid;
  v_stream public.participant_outcome_receipt_streams;
  v_previous public.participant_outcome_receipt_events;
  v_existing_match_id uuid;
  v_sequence integer;
  v_domains text[] := '{}';
  v_evidence text[] := '{}';
  v_origin text := 'direct-mutual';
  v_event_id uuid;
  v_recent integer;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_receipt_type is null then raise exception 'receipt type required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 160 then
    raise exception 'strong idempotency key required';
  end if;

  select * into v_match from public.matches m where m.id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'match access required';
  end if;
  v_counterparty := case when auth.uid() = v_match.user_a_id then v_match.user_b_id else v_match.user_a_id end;

  if public.outcome_receipt_pair_blocked(auth.uid(), v_counterparty) then
    raise exception 'outcome receipt unavailable while a safety boundary is active';
  end if;
  if now() > v_match.created_at + interval '60 days' then
    raise exception 'outcome receipt observation window has closed';
  end if;

  select s.match_id into v_existing_match_id
  from public.participant_outcome_receipt_events e
  join public.participant_outcome_receipt_streams s on s.id = e.stream_id
  where e.participant_id = auth.uid() and e.idempotency_key = trim(p_idempotency_key)
  limit 1;
  if v_existing_match_id is not null then
    if v_existing_match_id <> p_match_id then raise exception 'idempotency key already used'; end if;
    return query select * from public.get_my_outcome_receipt(p_match_id);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_match_id::text || ':' || auth.uid()::text, 0));

  insert into public.participant_outcome_receipt_streams (
    event_id, match_id, participant_id, counterparty_id
  ) values (
    v_match.event_id, p_match_id, auth.uid(), v_counterparty
  ) on conflict (match_id, participant_id) do nothing;

  select * into v_stream
  from public.participant_outcome_receipt_streams s
  where s.match_id = p_match_id and s.participant_id = auth.uid()
  for update;

  select * into v_previous
  from public.participant_outcome_receipt_events e
  where e.stream_id = v_stream.id
  order by e.sequence_no desc
  limit 1;

  if v_previous.id is not null and v_previous.event_type = 'submitted' and v_previous.receipt_type = p_receipt_type then
    return query select * from public.get_my_outcome_receipt(p_match_id);
    return;
  end if;

  select count(*)::integer into v_recent
  from public.participant_outcome_receipt_events e
  where e.stream_id = v_stream.id and e.created_at >= now() - interval '10 minutes';
  select count(*)::integer into v_total
  from public.participant_outcome_receipt_events e where e.stream_id = v_stream.id;
  if v_recent >= 8 or v_total >= 24 then
    raise exception 'outcome receipt revision is temporarily rate limited';
  end if;

  select coalesce(array_agg(distinct key order by key), '{}'::text[]) into v_domains
  from (
    select unnest(c.domains) as key
    from public.declared_fit_mutual_contexts c where c.match_id = p_match_id
    union
    select r.intent_key
    from public.event_introduction_requests r
    where r.event_id = v_match.event_id and r.status in ('accepted','matched')
      and ((r.requester_id = auth.uid() and r.target_id = v_counterparty)
        or (r.requester_id = v_counterparty and r.target_id = auth.uid()))
    union
    select w.intent_key
    from public.event_focus_window_opt_ins a
    join public.event_focus_window_opt_ins b
      on b.window_id = a.window_id and b.user_id = v_counterparty
    join public.event_focus_windows w on w.id = a.window_id
    where a.event_id = v_match.event_id and a.user_id = auth.uid()
      and w.state <> 'cancelled' and w.ends_at <= now()
  ) domain_rows;

  v_evidence := public.outcome_receipt_system_evidence(
    v_match.event_id, p_match_id, auth.uid(), v_counterparty
  );
  v_origin := public.outcome_receipt_origin_context(
    v_match.event_id, p_match_id, auth.uid(), v_counterparty
  );
  v_sequence := coalesce(v_previous.sequence_no, 0) + 1;

  insert into public.participant_outcome_receipt_events (
    stream_id, event_id, participant_id, sequence_no, event_type,
    receipt_type, domains, origin_context, system_evidence,
    supersedes_event_id, idempotency_key
  ) values (
    v_stream.id, v_match.event_id, auth.uid(), v_sequence, 'submitted',
    p_receipt_type, v_domains, v_origin, v_evidence,
    v_previous.id, trim(p_idempotency_key)
  ) returning id into v_event_id;

  perform public.capture_outcome_receipt_context_links(
    v_event_id, v_match.event_id, p_match_id, auth.uid(), v_counterparty
  );

  return query select * from public.get_my_outcome_receipt(p_match_id);
end;
$$;

create or replace function public.withdraw_my_outcome_receipt(
  p_match_id uuid,
  p_idempotency_key text
)
returns table (
  receipt_event_id uuid,
  stream_id uuid,
  lifecycle_state text,
  receipt_type public.participant_outcome_receipt_type,
  revision integer,
  alignment_state text,
  counterpart_receipt_type public.participant_outcome_receipt_type,
  compatibility_code text,
  domains text[],
  origin_context text,
  system_evidence text[],
  submitted_at timestamptz,
  can_submit boolean,
  observation_closes_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_stream public.participant_outcome_receipt_streams;
  v_previous public.participant_outcome_receipt_events;
  v_existing_match_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 160 then
    raise exception 'strong idempotency key required';
  end if;

  select * into v_match from public.matches m where m.id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'match access required';
  end if;

  select s.match_id into v_existing_match_id
  from public.participant_outcome_receipt_events e
  join public.participant_outcome_receipt_streams s on s.id = e.stream_id
  where e.participant_id = auth.uid() and e.idempotency_key = trim(p_idempotency_key)
  limit 1;
  if v_existing_match_id is not null then
    if v_existing_match_id <> p_match_id then raise exception 'idempotency key already used'; end if;
    return query select * from public.get_my_outcome_receipt(p_match_id);
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_match_id::text || ':' || auth.uid()::text, 0));

  select * into v_stream
  from public.participant_outcome_receipt_streams s
  where s.match_id = p_match_id and s.participant_id = auth.uid()
  for update;
  if v_stream.id is null then
    return query select * from public.get_my_outcome_receipt(p_match_id);
    return;
  end if;

  select * into v_previous
  from public.participant_outcome_receipt_events e
  where e.stream_id = v_stream.id
  order by e.sequence_no desc
  limit 1;

  if v_previous.id is null or v_previous.event_type = 'withdrawn' then
    return query select * from public.get_my_outcome_receipt(p_match_id);
    return;
  end if;

  insert into public.participant_outcome_receipt_events (
    stream_id, event_id, participant_id, sequence_no, event_type,
    receipt_type, domains, origin_context, system_evidence,
    supersedes_event_id, idempotency_key
  ) values (
    v_stream.id, v_match.event_id, auth.uid(), v_previous.sequence_no + 1, 'withdrawn',
    null, v_previous.domains, v_previous.origin_context, v_previous.system_evidence,
    v_previous.id, trim(p_idempotency_key)
  );

  return query select * from public.get_my_outcome_receipt(p_match_id);
end;
$$;

-- Host evidence: only current submitted receipts count. A host receives no
-- receipt-specific counts until at least five distinct mutuals carry a current
-- participant attestation. These are shares of supported mutuals, not a causal
-- conversion rate and not proof of a deal, hire, investment, or partnership.
create or replace function public.get_event_outcome_receipt_summary(p_event_id uuid)
returns table (
  supported boolean,
  total_mutual_matches integer,
  mutuals_with_participant_receipt integer,
  mutuals_with_compatible_receipts integer,
  mutuals_with_bilateral_confirmation integer,
  receipt_share_of_mutuals numeric,
  compatible_receipt_share_of_mutuals numeric,
  bilateral_confirmation_share_of_mutuals numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_attested integer;
  v_compatible integer;
  v_bilateral integer;
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then return; end if;

  with latest as (
    select distinct on (s.id)
      s.match_id, s.participant_id, e.event_type, e.receipt_type
    from public.participant_outcome_receipt_streams s
    join public.participant_outcome_receipt_events e on e.stream_id = s.id
    where s.event_id = p_event_id
    order by s.id, e.sequence_no desc
  ), current_receipts as (
    select * from latest where event_type = 'submitted'
  ), pairs as (
    select m.id as match_id,
      a.receipt_type as a_type,
      b.receipt_type as b_type,
      case when a.receipt_type is not null and b.receipt_type is not null
        then public.resolve_outcome_receipt_compatibility(a.receipt_type, b.receipt_type)
        else null end as compatibility
    from public.matches m
    left join current_receipts a on a.match_id = m.id and a.participant_id = m.user_a_id
    left join current_receipts b on b.match_id = m.id and b.participant_id = m.user_b_id
    where m.event_id = p_event_id
  )
  select
    count(*)::integer,
    count(*) filter (where a_type is not null or b_type is not null)::integer,
    count(*) filter (where compatibility is not null)::integer,
    count(*) filter (where compatibility = 'exact')::integer
  into v_total, v_attested, v_compatible, v_bilateral
  from pairs;

  if coalesce(v_attested, 0) < 5 then
    return query select false, null::integer, null::integer, null::integer, null::integer,
      null::numeric, null::numeric, null::numeric;
    return;
  end if;

  return query select
    true,
    v_total,
    v_attested,
    v_compatible,
    v_bilateral,
    v_attested::numeric / greatest(1, v_total),
    v_compatible::numeric / greatest(1, v_total),
    v_bilateral::numeric / greatest(1, v_total);
end;
$$;

create or replace function public.get_event_outcome_receipt_types(p_event_id uuid)
returns table (
  receipt_type public.participant_outcome_receipt_type,
  mutual_match_count integer,
  bilateral_confirmed_match_count integer,
  share_of_attested_mutuals numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then return; end if;

  return query
  with latest as (
    select distinct on (s.id)
      s.match_id, s.participant_id, e.event_type, e.receipt_type
    from public.participant_outcome_receipt_streams s
    join public.participant_outcome_receipt_events e on e.stream_id = s.id
    where s.event_id = p_event_id
    order by s.id, e.sequence_no desc
  ), current_receipts as (
    select * from latest where event_type = 'submitted'
  ), attested as (
    select count(distinct match_id)::integer as count from current_receipts
  ), grouped as (
    select r.receipt_type,
      count(distinct r.match_id)::integer as match_count,
      count(distinct r.match_id) filter (where exists (
        select 1 from current_receipts peer
        where peer.match_id = r.match_id
          and peer.participant_id <> r.participant_id
          and peer.receipt_type = r.receipt_type
      ))::integer as bilateral_count
    from current_receipts r
    group by r.receipt_type
  )
  select g.receipt_type, g.match_count, g.bilateral_count,
    g.match_count::numeric / greatest(1, a.count)
  from grouped g cross join attested a
  where a.count >= 5 and g.match_count >= 5
  order by g.match_count desc, g.receipt_type::text;
end;
$$;

create or replace function public.get_event_outcome_receipt_domains(p_event_id uuid)
returns table (
  intent_key text,
  mutual_match_count integer,
  compatible_receipt_match_count integer,
  bilateral_confirmed_match_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_event_host(p_event_id, auth.uid()) then return; end if;

  return query
  with latest as (
    select distinct on (s.id)
      s.match_id, s.participant_id, e.id as receipt_event_id,
      e.event_type, e.receipt_type, e.domains
    from public.participant_outcome_receipt_streams s
    join public.participant_outcome_receipt_events e on e.stream_id = s.id
    where s.event_id = p_event_id
    order by s.id, e.sequence_no desc
  ), current_receipts as (
    select * from latest where event_type = 'submitted'
  ), attested as (
    select count(distinct match_id)::integer as count from current_receipts
  ), pairs as (
    select m.id as match_id,
      a.receipt_type as a_type,
      b.receipt_type as b_type,
      case when a.receipt_type is not null and b.receipt_type is not null
        then public.resolve_outcome_receipt_compatibility(a.receipt_type, b.receipt_type)
        else null end as compatibility
    from public.matches m
    left join current_receipts a on a.match_id = m.id and a.participant_id = m.user_a_id
    left join current_receipts b on b.match_id = m.id and b.participant_id = m.user_b_id
    where m.event_id = p_event_id
  ), expanded as (
    select distinct r.match_id, d.intent_key
    from current_receipts r
    cross join lateral unnest(r.domains) d(intent_key)
  ), grouped as (
    select e.intent_key,
      count(distinct e.match_id)::integer as match_count,
      count(distinct e.match_id) filter (where p.compatibility is not null)::integer as compatible_count,
      count(distinct e.match_id) filter (where p.compatibility = 'exact')::integer as bilateral_count
    from expanded e join pairs p on p.match_id = e.match_id
    group by e.intent_key
  )
  select g.intent_key, g.match_count, g.compatible_count, g.bilateral_count
  from grouped g cross join attested a
  where a.count >= 5 and g.match_count >= 5
  order by g.match_count desc, g.intent_key;
end;
$$;

-- Community owners may inspect receipt evidence only for their own bilateral
-- exchange and only when both sides meet the existing five-person exchange
-- cohort boundary AND at least five cross-community mutuals carry a current
-- participant receipt linked to this exchange.
create or replace function public.get_community_exchange_outcome_receipt_summary(p_exchange_id uuid)
returns table (
  supported boolean,
  community_a_name text,
  community_b_name text,
  cross_community_mutual_count integer,
  mutuals_with_participant_receipt integer,
  compatible_receipt_match_count integer,
  bilateral_confirmed_match_count integer,
  receipt_share_of_cross_community_mutuals numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exchange public.community_exchange_agreements;
  v_owner_a uuid;
  v_owner_b uuid;
  v_name_a text;
  v_name_b text;
  v_a_count integer;
  v_b_count integer;
  v_mutuals integer;
  v_receipts integer;
  v_compatible integer;
  v_bilateral integer;
begin
  if auth.uid() is null then return; end if;
  select * into v_exchange from public.community_exchange_agreements x where x.id = p_exchange_id;
  if v_exchange.id is null then return; end if;
  select owner_id, name into v_owner_a, v_name_a from public.community_partners where id = v_exchange.community_a_id;
  select owner_id, name into v_owner_b, v_name_b from public.community_partners where id = v_exchange.community_b_id;
  if not public.is_event_host(v_exchange.event_id, auth.uid()) and auth.uid() not in (v_owner_a, v_owner_b) then return; end if;

  select count(*)::integer into v_a_count
  from public.participant_event_community_affiliations a
  where a.event_id = v_exchange.event_id and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true;
  select count(*)::integer into v_b_count
  from public.participant_event_community_affiliations a
  where a.event_id = v_exchange.event_id and a.community_id = v_exchange.community_b_id and a.exchange_enabled = true;

  with qualifying_matches as (
    select distinct m.id, m.user_a_id, m.user_b_id
    from public.matches m
    where m.event_id = v_exchange.event_id
      and (
        (exists (select 1 from public.participant_event_community_affiliations a
          where a.event_id = m.event_id and a.user_id = m.user_a_id
            and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true)
         and exists (select 1 from public.participant_event_community_affiliations b
          where b.event_id = m.event_id and b.user_id = m.user_b_id
            and b.community_id = v_exchange.community_b_id and b.exchange_enabled = true))
        or
        (exists (select 1 from public.participant_event_community_affiliations b
          where b.event_id = m.event_id and b.user_id = m.user_a_id
            and b.community_id = v_exchange.community_b_id and b.exchange_enabled = true)
         and exists (select 1 from public.participant_event_community_affiliations a
          where a.event_id = m.event_id and a.user_id = m.user_b_id
            and a.community_id = v_exchange.community_a_id and a.exchange_enabled = true))
      )
  ), latest as (
    select distinct on (s.id)
      s.match_id, s.participant_id, e.id as receipt_event_id, e.event_type, e.receipt_type
    from public.participant_outcome_receipt_streams s
    join public.participant_outcome_receipt_events e on e.stream_id = s.id
    where s.event_id = v_exchange.event_id
    order by s.id, e.sequence_no desc
  ), current_receipts as (
    select r.* from latest r
    where r.event_type = 'submitted'
      and exists (
        select 1 from public.participant_outcome_receipt_context_links l
        where l.receipt_event_id = r.receipt_event_id
          and l.context_kind = 'community-exchange'
          and l.context_id = p_exchange_id
      )
  ), pairs as (
    select q.id as match_id,
      a.receipt_type as a_type,
      b.receipt_type as b_type,
      case when a.receipt_type is not null and b.receipt_type is not null
        then public.resolve_outcome_receipt_compatibility(a.receipt_type, b.receipt_type)
        else null end as compatibility
    from qualifying_matches q
    left join current_receipts a on a.match_id = q.id and a.participant_id = q.user_a_id
    left join current_receipts b on b.match_id = q.id and b.participant_id = q.user_b_id
  )
  select count(*)::integer,
    count(*) filter (where a_type is not null or b_type is not null)::integer,
    count(*) filter (where compatibility is not null)::integer,
    count(*) filter (where compatibility = 'exact')::integer
  into v_mutuals, v_receipts, v_compatible, v_bilateral
  from pairs;

  if v_a_count < 5 or v_b_count < 5 or coalesce(v_receipts, 0) < 5 then
    return query select false, v_name_a, v_name_b, null::integer, null::integer,
      null::integer, null::integer, null::numeric;
    return;
  end if;

  return query select true, v_name_a, v_name_b, v_mutuals, v_receipts,
    v_compatible, v_bilateral,
    v_receipts::numeric / greatest(1, v_mutuals);
end;
$$;

-- Historical compatibility note: migration 026 introduced this field before
-- participant-owned receipts existed. It tracks completion of a private next-step
-- intent handshake. It must not be described as verified real-world conversion.
comment on column public.event_outcome_snapshots.mutual_to_outcome_rate is
  'Legacy private next-step alignment completion share. Not a verified real-world conversion rate; use participant outcome receipt aggregates for explicit attestation evidence.';

revoke all on function public.reject_participant_outcome_receipt_update() from public;
revoke all on function public.resolve_outcome_receipt_compatibility(public.participant_outcome_receipt_type, public.participant_outcome_receipt_type) from public;
revoke all on function public.outcome_receipt_pair_blocked(uuid, uuid) from public;
revoke all on function public.outcome_receipt_system_evidence(uuid, uuid, uuid, uuid) from public;
revoke all on function public.outcome_receipt_origin_context(uuid, uuid, uuid, uuid) from public;
revoke all on function public.capture_outcome_receipt_context_links(uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.get_my_outcome_receipt(uuid) from public;
revoke all on function public.submit_my_outcome_receipt(uuid, public.participant_outcome_receipt_type, text) from public;
revoke all on function public.withdraw_my_outcome_receipt(uuid, text) from public;
revoke all on function public.get_event_outcome_receipt_summary(uuid) from public;
revoke all on function public.get_event_outcome_receipt_types(uuid) from public;
revoke all on function public.get_event_outcome_receipt_domains(uuid) from public;
revoke all on function public.get_community_exchange_outcome_receipt_summary(uuid) from public;

grant execute on function public.get_my_outcome_receipt(uuid) to authenticated;
grant execute on function public.submit_my_outcome_receipt(uuid, public.participant_outcome_receipt_type, text) to authenticated;
grant execute on function public.withdraw_my_outcome_receipt(uuid, text) to authenticated;
grant execute on function public.get_event_outcome_receipt_summary(uuid) to authenticated;
grant execute on function public.get_event_outcome_receipt_types(uuid) to authenticated;
grant execute on function public.get_event_outcome_receipt_domains(uuid) to authenticated;
grant execute on function public.get_community_exchange_outcome_receipt_summary(uuid) to authenticated;

comment on table public.participant_outcome_receipt_streams is
  'Private per-participant receipt stream anchored to a real Beacon mutual; not host-readable.';
comment on table public.participant_outcome_receipt_events is
  'Append-only participant attestations and withdrawals. Revisions supersede rather than rewrite prior evidence.';
comment on table public.participant_outcome_receipt_context_links is
  'Server-private provenance linking a receipt event to Beacon-native context without asserting that context caused the participant-attested outcome.';
comment on function public.get_event_outcome_receipt_summary(uuid) is
  'Host-only cohort-gated composition of participant-attested outcomes among real mutuals. Observational evidence, not causal conversion.';
comment on function public.get_community_exchange_outcome_receipt_summary(uuid) is
  'Host/community-owner cohort-gated receipt composition for one approved exchange; returns no participant pairs.';
