-- =============================================================================
-- 035_two_party_outcome_commit.sql
-- Makes post-event outcome completion a two-party commit protocol.
--
-- Security / truth goals:
--   * Once compatible private intents align, neither party can silently rewrite
--     the shared agreement underneath the other.
--   * One participant cannot globally mark a shared real-world outcome complete.
--   * Each confirmation is independently persisted and attributable.
--   * The shared handshake reaches `completed` only after both parties confirm.
--   * Clients read confirmation state through one narrow SECURITY DEFINER RPC;
--     the confirmation table itself has no direct client surface.
-- =============================================================================

create table if not exists public.outcome_handshake_confirmations (
  handshake_id uuid not null references public.outcome_handshakes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (handshake_id, user_id)
);

create index if not exists outcome_handshake_confirmations_user_idx
  on public.outcome_handshake_confirmations (user_id, confirmed_at desc);

alter table public.outcome_handshake_confirmations enable row level security;
-- Intentionally no client RLS policy. State is disclosed only through the
-- party-scoped RPC below; writes happen only through confirm_outcome_handshake.

-- Prevent any SECURITY DEFINER path from mutating a participant intent after
-- mutual compatibility has already been revealed. This avoids stale Vault actions
-- and unilateral post-alignment rewrites.
create or replace function public.guard_aligned_outcome_intent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status public.outcome_handshake_status;
begin
  select h.status into v_status
  from public.outcome_handshakes h
  where h.match_id = new.match_id;

  if v_status in ('aligned', 'completed') then
    raise exception 'Aligned outcome intent is sealed; create a new explicit workflow rather than rewriting shared state';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_aligned_outcome_intent_mutation
  on public.opportunity_intent_signals;
create trigger guard_aligned_outcome_intent_mutation
before insert or update on public.opportunity_intent_signals
for each row execute function public.guard_aligned_outcome_intent_mutation();

-- Enforce monotonic shared-state transitions below every RPC. A completed
-- handshake can never be reopened, and an aligned handshake can only remain
-- aligned or advance to completed.
create or replace function public.guard_outcome_handshake_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'completed' and new.status is distinct from 'completed' then
    raise exception 'Completed outcome handshakes are immutable';
  end if;

  if old.status = 'aligned' and new.status not in ('aligned', 'completed') then
    raise exception 'Aligned outcome handshakes may only advance to completed';
  end if;

  if old.status in ('declined', 'withdrawn') and new.status is distinct from old.status then
    raise exception 'Terminal outcome handshake state is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_outcome_handshake_transition
  on public.outcome_handshakes;
create trigger guard_outcome_handshake_transition
before update on public.outcome_handshakes
for each row execute function public.guard_outcome_handshake_transition();

-- New party-scoped state surface. The historical RPC remains in the database for
-- migration compatibility but loses authenticated execution below so shipped
-- clients cannot accidentally ignore two-party confirmation state.
create or replace function public.get_outcome_handshake_commit_state(p_match_id uuid)
returns table (
  handshake_id uuid,
  handshake_status public.outcome_handshake_status,
  own_intent public.outcome_intent,
  counterpart_intent public.outcome_intent,
  activation_type text,
  expires_at timestamptz,
  own_confirmed boolean,
  counterpart_confirmed boolean,
  confirmation_count smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_handshake public.outcome_handshakes;
  v_own public.opportunity_intent_signals;
  v_is_a boolean;
  v_other_id uuid;
  v_own_confirmed boolean := false;
  v_other_confirmed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'Match access required';
  end if;

  v_is_a := auth.uid() = v_match.user_a_id;
  v_other_id := case when v_is_a then v_match.user_b_id else v_match.user_a_id end;

  select * into v_own
  from public.opportunity_intent_signals
  where match_id = p_match_id and user_id = auth.uid();

  select * into v_handshake
  from public.outcome_handshakes
  where match_id = p_match_id;

  if v_handshake.id is null then
    return query select
      null::uuid,
      case when v_own.user_id is null then null else 'waiting'::public.outcome_handshake_status end,
      v_own.intent,
      null::public.outcome_intent,
      null::text,
      v_own.expires_at,
      false,
      false,
      0::smallint;
    return;
  end if;

  select exists (
    select 1 from public.outcome_handshake_confirmations c
    where c.handshake_id = v_handshake.id and c.user_id = auth.uid()
  ) into v_own_confirmed;

  select exists (
    select 1 from public.outcome_handshake_confirmations c
    where c.handshake_id = v_handshake.id and c.user_id = v_other_id
  ) into v_other_confirmed;

  return query select
    v_handshake.id,
    case
      when v_handshake.expires_at <= now()
        and v_handshake.status not in ('completed', 'declined', 'withdrawn')
        then 'expired'::public.outcome_handshake_status
      else v_handshake.status
    end,
    v_own.intent,
    case
      when v_handshake.status in ('aligned', 'completed')
        then case when v_is_a then v_handshake.intent_b else v_handshake.intent_a end
      else null::public.outcome_intent
    end,
    case when v_handshake.status in ('aligned', 'completed') then v_handshake.activation_type else null end,
    v_handshake.expires_at,
    v_own_confirmed,
    v_other_confirmed,
    ((case when v_own_confirmed then 1 else 0 end)
      + (case when v_other_confirmed then 1 else 0 end))::smallint;
end;
$$;

revoke all on function public.get_outcome_handshake_commit_state(uuid) from public;
grant execute on function public.get_outcome_handshake_commit_state(uuid) to authenticated;

revoke execute on function public.get_outcome_handshake_state(uuid) from authenticated;
revoke all on function public.get_outcome_handshake_state(uuid) from public;

-- Independent confirmation. The first caller records only their side and leaves
-- the shared status `aligned`. The second caller atomically advances the shared
-- handshake to `completed` and closes both Vault actions.
create or replace function public.confirm_outcome_handshake(p_handshake_id uuid)
returns table (
  accepted boolean,
  event_id uuid,
  handshake_status public.outcome_handshake_status,
  own_confirmed boolean,
  counterpart_confirmed boolean,
  confirmation_count smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handshake public.outcome_handshakes;
  v_other_id uuid;
  v_count integer;
  v_other_confirmed boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_handshake
  from public.outcome_handshakes h
  where h.id = p_handshake_id
  for update;

  if v_handshake.id is null
     or auth.uid() not in (v_handshake.user_a_id, v_handshake.user_b_id) then
    raise exception 'Handshake access required';
  end if;

  if v_handshake.status = 'completed' then
    v_other_id := case
      when auth.uid() = v_handshake.user_a_id then v_handshake.user_b_id
      else v_handshake.user_a_id
    end;

    select count(*) into v_count
    from public.outcome_handshake_confirmations c
    where c.handshake_id = p_handshake_id;

    return query select
      true,
      v_handshake.event_id,
      'completed'::public.outcome_handshake_status,
      true,
      exists (
        select 1 from public.outcome_handshake_confirmations c
        where c.handshake_id = p_handshake_id and c.user_id = v_other_id
      ),
      least(v_count, 2)::smallint;
    return;
  end if;

  if v_handshake.status <> 'aligned' then
    raise exception 'Only an aligned outcome can be confirmed';
  end if;

  if v_handshake.expires_at <= now() then
    raise exception 'Outcome confirmation window has expired';
  end if;

  v_other_id := case
    when auth.uid() = v_handshake.user_a_id then v_handshake.user_b_id
    else v_handshake.user_a_id
  end;

  insert into public.outcome_handshake_confirmations (handshake_id, user_id)
  values (p_handshake_id, auth.uid())
  on conflict (handshake_id, user_id) do nothing;

  select count(*) into v_count
  from public.outcome_handshake_confirmations c
  where c.handshake_id = p_handshake_id;

  select exists (
    select 1 from public.outcome_handshake_confirmations c
    where c.handshake_id = p_handshake_id and c.user_id = v_other_id
  ) into v_other_confirmed;

  -- The caller has completed their private action whether or not the counterpart
  -- has. Keep the counterpart's Vault action open until they independently confirm.
  update public.vault_entries
  set status = 'completed', updated_at = now()
  where source_id = p_handshake_id
    and user_id = auth.uid()
    and kind = 'next_action';

  if v_count >= 2 then
    update public.outcome_handshakes
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_handshake_id and status = 'aligned';

    update public.vault_entries
    set status = 'completed', updated_at = now()
    where source_id = p_handshake_id
      and user_id in (v_handshake.user_a_id, v_handshake.user_b_id)
      and kind = 'next_action';

    v_handshake.status := 'completed';
  end if;

  return query select
    true,
    v_handshake.event_id,
    v_handshake.status,
    true,
    v_other_confirmed,
    least(v_count, 2)::smallint;
end;
$$;

revoke all on function public.confirm_outcome_handshake(uuid) from public;
grant execute on function public.confirm_outcome_handshake(uuid) to authenticated;

-- Retire the single-party completion surface from client execution. It remains
-- defined for historical migration compatibility but cannot be invoked remotely.
revoke execute on function public.complete_outcome_handshake(uuid) from authenticated;
revoke all on function public.complete_outcome_handshake(uuid) from public;

comment on table public.outcome_handshake_confirmations is
  'Independent party confirmations for aligned private outcomes. Shared completion requires both match participants.';
comment on function public.confirm_outcome_handshake(uuid) is
  'Records the caller confirmation and advances the shared handshake to completed only when both parties have independently confirmed.';
