-- =============================================================================
-- 052_internal_graph_temporal_rpc_volatility_fix.sql
-- get_internal_graph_event_sequence writes an operator audit row, so it must not
-- be declared STABLE. Keep the behavior/audit trail, correct the volatility
-- contract in a forward migration, and preserve the narrow read surface.
-- =============================================================================

create or replace function public.get_internal_graph_event_sequence(p_limit integer default 36)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit integer := least(120, greatest(2, coalesce(p_limit, 36)));
  v_events jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  select coalesce(jsonb_agg(row_payload order by sort_at desc, event_id desc), '[]'::jsonb)
  into v_events
  from (
    select
      e.id as event_id,
      coalesce(e.ends_at, e.starts_at, e.created_at) as sort_at,
      jsonb_build_object(
        'eventId', e.id,
        'name', e.name,
        'startsAt', e.starts_at,
        'endsAt', e.ends_at,
        'finalizedAt', e.finalized_at,
        'venueKey', case
          when e.latitude is not null or e.longitude is not null or nullif(trim(e.address), '') is not null
            then public.compute_world_memory_venue_key(e.address, e.latitude, e.longitude, e.id)
          else null
        end,
        'participantCount', (
          select count(*) from public.event_participants ep
          where ep.event_id = e.id and ep.status = 'approved'
        ),
        'mutualCount', (select count(*) from public.matches m where m.event_id = e.id),
        'officeHoursCompleted', (
          select count(*) from public.office_hours_requests o
          where o.event_id = e.id and o.status = 'completed'
        ),
        'outcomeCompleted', (
          select count(*) from public.outcome_handshakes h
          where h.event_id = e.id and h.status = 'completed'
        )
      ) as row_payload
    from public.events e
    where exists (select 1 from public.event_participants ep where ep.event_id = e.id)
    order by coalesce(e.ends_at, e.starts_at, e.created_at) desc, e.id desc
    limit v_limit
  ) ranked;

  insert into public.internal_graph_audit_log(actor_id, action, metadata)
  values (auth.uid(), 'graph_event_sequence_read', jsonb_build_object('limit', v_limit));

  return jsonb_build_object('generatedAt', now(), 'events', v_events);
end;
$$;

revoke all on function public.get_internal_graph_event_sequence(integer) from public;
grant execute on function public.get_internal_graph_event_sequence(integer) to authenticated;

comment on function public.get_internal_graph_event_sequence(integer) is
  'Audited operator event sequence. VOLATILE because the read records its own access audit event.';
