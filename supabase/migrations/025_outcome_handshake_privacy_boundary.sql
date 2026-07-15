-- =============================================================================
-- 025_outcome_handshake_privacy_boundary.sql
-- Prevents a modified client from reading the counterpart's intent before the
-- protocol has established compatible mutual alignment.
-- =============================================================================

drop policy if exists "outcome_intents_match_parties_read"
  on public.opportunity_intent_signals;

create policy "outcome_intents_select_own"
  on public.opportunity_intent_signals
  for select
  using (auth.uid() = user_id);

drop policy if exists "outcome_handshakes_parties_read"
  on public.outcome_handshakes;

drop policy if exists "outcome_handshakes_parties_update"
  on public.outcome_handshakes;

-- Handshake rows are intentionally not directly readable by clients because the
-- row contains both private intents. The RPC performs field-level disclosure.
create or replace function public.get_outcome_handshake_state(p_match_id uuid)
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
  v_handshake public.outcome_handshakes;
  v_own public.opportunity_intent_signals;
  v_is_a boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if v_match.id is null or auth.uid() not in (v_match.user_a_id, v_match.user_b_id) then
    raise exception 'Match access required';
  end if;

  v_is_a := auth.uid() = v_match.user_a_id;

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
      v_own.expires_at;
    return;
  end if;

  return query select
    v_handshake.id,
    case
      when v_handshake.expires_at <= now() and v_handshake.status not in ('completed', 'declined', 'withdrawn')
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
    v_handshake.expires_at;
end;
$$;

grant execute on function public.get_outcome_handshake_state(uuid) to authenticated;

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

  if found then
    update public.vault_entries
    set status = 'completed', updated_at = now()
    where source_id = p_handshake_id
      and user_id = auth.uid()
      and kind = 'next_action';
  end if;

  return found;
end;
$$;
