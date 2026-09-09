-- =============================================================================
-- 071_internal_graph_case_handoff_hardening.sql
-- NULL-safe participant checks for investigation handoffs after account erasure.
-- =============================================================================

create or replace function public.set_internal_graph_case_handoff_status(
  p_handoff_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.internal_graph_case_handoffs;
  v_is_sender boolean;
  v_is_recipient boolean;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;
  if p_status not in ('accepted', 'declined', 'resolved', 'withdrawn') then
    raise exception 'Unsupported handoff status';
  end if;

  select * into v_handoff
  from public.internal_graph_case_handoffs h
  where h.id = p_handoff_id and h.expires_at > now();
  if v_handoff.id is null then raise exception 'Unknown or expired handoff'; end if;

  v_is_sender := v_handoff.from_operator is not null and v_handoff.from_operator = auth.uid();
  v_is_recipient := v_handoff.to_operator = auth.uid();

  if p_status in ('accepted', 'declined') and not v_is_recipient then
    raise exception 'Only the recipient may accept or decline a handoff';
  end if;
  if p_status = 'withdrawn' and not v_is_sender then
    raise exception 'Only the sender may withdraw a handoff';
  end if;
  if p_status = 'resolved' and not (v_is_sender or v_is_recipient) then
    raise exception 'Only a handoff participant may resolve it';
  end if;

  if v_handoff.status in ('declined', 'resolved', 'withdrawn') then
    raise exception 'Terminal handoff status cannot transition again';
  end if;
  if p_status = 'accepted' and v_handoff.status <> 'open' then
    raise exception 'Only an open handoff can be accepted';
  end if;
  if p_status = 'declined' and v_handoff.status <> 'open' then
    raise exception 'Only an open handoff can be declined';
  end if;
  if p_status = 'withdrawn' and v_handoff.status <> 'open' then
    raise exception 'Only an open handoff can be withdrawn';
  end if;
  if p_status = 'resolved' and v_handoff.status <> 'accepted' then
    raise exception 'Only an accepted handoff can be resolved';
  end if;

  update public.internal_graph_case_handoffs
  set status = p_status,
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      resolved_at = case when p_status in ('resolved', 'declined', 'withdrawn') then now() else resolved_at end
  where id = p_handoff_id;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  select auth.uid(), 'graph_case_handoff_status', c.scope_event_id,
    jsonb_build_object('handoffId', v_handoff.id, 'caseId', v_handoff.case_id, 'status', p_status)
  from public.internal_graph_cases c where c.id = v_handoff.case_id;

  return true;
end;
$$;
revoke all on function public.set_internal_graph_case_handoff_status(uuid, text) from public;
grant execute on function public.set_internal_graph_case_handoff_status(uuid, text) to authenticated;

create or replace function public.add_internal_graph_case_handoff_note(
  p_handoff_id uuid,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handoff public.internal_graph_case_handoffs;
  v_id uuid;
  v_count integer;
  v_is_sender boolean;
  v_is_recipient boolean;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select * into v_handoff
  from public.internal_graph_case_handoffs h
  where h.id = p_handoff_id and h.expires_at > now();
  if v_handoff.id is null then raise exception 'Unknown or expired handoff'; end if;

  v_is_sender := v_handoff.from_operator is not null and v_handoff.from_operator = auth.uid();
  v_is_recipient := v_handoff.to_operator = auth.uid();
  if not (v_is_sender or v_is_recipient) then
    raise exception 'Handoff is not available to current operator';
  end if;
  if v_handoff.status not in ('open', 'accepted') then
    raise exception 'Notes are closed for terminal handoffs';
  end if;
  if not public.internal_handoff_text_safe(p_note)
     or char_length(trim(coalesce(p_note, ''))) < 1
     or char_length(trim(p_note)) > 600 then
    raise exception 'Handoff note must be bounded and contain no direct email address or external URL';
  end if;

  select count(*) into v_count
  from public.internal_graph_case_handoff_notes
  where handoff_id = p_handoff_id;
  if v_count >= 50 then raise exception 'Handoff note limit reached'; end if;

  insert into public.internal_graph_case_handoff_notes(handoff_id, author_id, note)
  values (p_handoff_id, auth.uid(), trim(p_note)) returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_internal_graph_case_handoff_note(uuid, text) from public;
grant execute on function public.add_internal_graph_case_handoff_note(uuid, text) to authenticated;

comment on function public.set_internal_graph_case_handoff_status(uuid, text) is
  'NULL-safe monotonic handoff state machine. Sender erasure cannot accidentally broaden participant authorization.';
