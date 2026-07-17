-- =============================================================================
-- 024_outcome_handshake_protocol.sql
-- Converts mutual connections into coordinated real-world next steps.
--
-- The protocol is intentionally event-scoped and private. Each party selects an
-- outcome intent independently. Beacon reveals alignment only when the pair is
-- compatible, then seeds a concrete next action into both private Vaults.
-- =============================================================================

alter type public.security_action_kind add value if not exists 'outcome_handshake';

create type public.outcome_intent as enum (
  'follow_up',
  'collaborate',
  'partnership',
  'raise_capital',
  'invest',
  'hire',
  'explore_role',
  'sell',
  'buy',
  'mentor',
  'seek_mentorship',
  'make_intro',
  'request_intro'
);

create type public.outcome_handshake_status as enum (
  'waiting',
  'aligned',
  'declined',
  'withdrawn',
  'expired',
  'completed'
);

create table if not exists public.opportunity_intent_signals (
  match_id uuid not null references public.matches(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  intent public.outcome_intent not null,
  note text check (note is null or char_length(note) <= 280),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists opportunity_intent_event_idx
  on public.opportunity_intent_signals (event_id, created_at desc);

alter table public.opportunity_intent_signals enable row level security;

create policy "outcome_intents_match_parties_read"
  on public.opportunity_intent_signals
  for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = opportunity_intent_signals.match_id
        and auth.uid() in (m.user_a_id, m.user_b_id)
    )
  );

-- Writes happen only through the secure RPC so that independent intent remains
-- private and replay-protected until alignment is established.

create table if not exists public.outcome_handshakes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  intent_a public.outcome_intent,
  intent_b public.outcome_intent,
  activation_type text,
  status public.outcome_handshake_status not null default 'waiting',
  expires_at timestamptz not null,
  aligned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  check (activation_type is null or char_length(activation_type) <= 80)
);

create index if not exists outcome_handshakes_event_idx
  on public.outcome_handshakes (event_id, status, created_at desc);

alter table public.outcome_handshakes enable row level security;

create policy "outcome_handshakes_parties_read"
  on public.outcome_handshakes
  for select
  using (auth.uid() in (user_a_id, user_b_id));

create policy "outcome_handshakes_parties_update"
  on public.outcome_handshakes
  for update
  using (auth.uid() in (user_a_id, user_b_id))
  with check (auth.uid() in (user_a_id, user_b_id));

create or replace function public.resolve_outcome_activation(
  p_left public.outcome_intent,
  p_right public.outcome_intent
)
returns text
language sql
immutable
as $$
  select case
    when p_left = p_right and p_left = 'follow_up' then 'follow_up'
    when p_left = p_right and p_left in ('collaborate', 'partnership') then 'build_together'
    when (p_left, p_right) in (
      ('raise_capital', 'invest'), ('invest', 'raise_capital')
    ) then 'capital_conversation'
    when (p_left, p_right) in (
      ('hire', 'explore_role'), ('explore_role', 'hire')
    ) then 'talent_conversation'
    when (p_left, p_right) in (
      ('sell', 'buy'), ('buy', 'sell')
    ) then 'commercial_conversation'
    when (p_left, p_right) in (
      ('mentor', 'seek_mentorship'), ('seek_mentorship', 'mentor')
    ) then 'mentorship_conversation'
    when (p_left, p_right) in (
      ('make_intro', 'request_intro'), ('request_intro', 'make_intro')
    ) then 'introduction_exchange'
    when p_left = p_right then 'shared_intent'
    else null
  end;
$$;

create or replace function public.propose_outcome_handshake(
  p_match_id uuid,
  p_intent public.outcome_intent,
  p_note text,
  p_nonce text
)
returns table (
  handshake_id uuid,
  handshake_status public.outcome_handshake_status,
  own_intent public.outcome_intent,
  counterpart_intent public.outcome_intent,
  activation_type text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_other_id uuid;
  v_other_signal public.opportunity_intent_signals;
  v_activation text;
  v_handshake public.outcome_handshakes;
  v_authorized boolean;
  v_expiry timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_note is not null and char_length(p_note) > 280 then
    raise exception 'Outcome note is too long';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'Match access required';
  end if;

  v_other_id := case
    when auth.uid() = v_match.user_a_id then v_match.user_b_id
    else v_match.user_a_id
  end;

  select allowed into v_authorized
  from public.authorize_sensitive_action(
    v_match.event_id,
    'outcome_handshake'::public.security_action_kind,
    p_nonce,
    v_other_id,
    jsonb_build_object('match_id', p_match_id)
  );

  if not coalesce(v_authorized, false) then
    raise exception 'Outcome handshake authorization denied';
  end if;

  v_expiry := greatest(now() + interval '1 hour',
    least(now() + interval '14 days', coalesce((select ends_at from public.events where id = v_match.event_id), now()) + interval '7 days'));

  insert into public.opportunity_intent_signals (
    match_id, event_id, user_id, intent, note, expires_at
  ) values (
    p_match_id, v_match.event_id, auth.uid(), p_intent, nullif(trim(p_note), ''), v_expiry
  )
  on conflict (match_id, user_id) do update
    set intent = excluded.intent,
        note = excluded.note,
        expires_at = excluded.expires_at,
        updated_at = now();

  select * into v_other_signal
  from public.opportunity_intent_signals
  where match_id = p_match_id
    and user_id = v_other_id
    and expires_at > now();

  v_activation := case
    when v_other_signal.user_id is null then null
    else public.resolve_outcome_activation(p_intent, v_other_signal.intent)
  end;

  insert into public.outcome_handshakes (
    match_id, event_id, user_a_id, user_b_id,
    intent_a, intent_b, activation_type, status, expires_at, aligned_at
  ) values (
    p_match_id,
    v_match.event_id,
    v_match.user_a_id,
    v_match.user_b_id,
    case when auth.uid() = v_match.user_a_id then p_intent else v_other_signal.intent end,
    case when auth.uid() = v_match.user_b_id then p_intent else v_other_signal.intent end,
    v_activation,
    case when v_activation is null then 'waiting' else 'aligned' end,
    v_expiry,
    case when v_activation is null then null else now() end
  )
  on conflict (match_id) do update
    set intent_a = excluded.intent_a,
        intent_b = excluded.intent_b,
        activation_type = excluded.activation_type,
        status = excluded.status,
        expires_at = excluded.expires_at,
        aligned_at = excluded.aligned_at,
        updated_at = now()
  returning * into v_handshake;

  if v_activation is not null then
    insert into public.vault_entries (
      event_id, user_id, kind, source_id, subject_user_id,
      identity_revealed, title, detail, next_action, metadata, visible_until
    ) values
      (
        v_match.event_id, v_match.user_a_id, 'next_action', v_handshake.id,
        v_match.user_b_id, true, 'Outcome alignment unlocked',
        'Both participants independently selected compatible next steps.',
        'Open the mutual and confirm the next real-world action.',
        jsonb_build_object('activationType', v_activation, 'matchId', p_match_id),
        v_expiry
      ),
      (
        v_match.event_id, v_match.user_b_id, 'next_action', v_handshake.id,
        v_match.user_a_id, true, 'Outcome alignment unlocked',
        'Both participants independently selected compatible next steps.',
        'Open the mutual and confirm the next real-world action.',
        jsonb_build_object('activationType', v_activation, 'matchId', p_match_id),
        v_expiry
      )
    on conflict (user_id, event_id, kind, source_id) do update
      set title = excluded.title,
          detail = excluded.detail,
          next_action = excluded.next_action,
          metadata = excluded.metadata,
          visible_until = excluded.visible_until,
          status = 'open',
          updated_at = now();
  end if;

  return query select
    v_handshake.id,
    v_handshake.status,
    p_intent,
    case when v_activation is null then null else v_other_signal.intent end,
    v_handshake.activation_type,
    v_handshake.expires_at;
end;
$$;

grant execute on function public.propose_outcome_handshake(uuid, public.outcome_intent, text, text) to authenticated;

create or replace function public.complete_outcome_handshake(p_handshake_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.outcome_handshakes
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_handshake_id
    and auth.uid() in (user_a_id, user_b_id)
    and status = 'aligned';

  return found;
end;
$$;

grant execute on function public.complete_outcome_handshake(uuid) to authenticated;
