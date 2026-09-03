-- Partner Commitment Ledger effective-template and evidence-uniqueness hardening
--
-- Two edge cases become important once the ledger is reused across events:
--
-- 1. A pending Partner Program amendment must not make the already accepted
--    template disappear from event prefill. Accepted terms remain effective until
--    the amendment earns fresh bilateral acceptance.
-- 2. A fulfilled/partially-fulfilled obligation remains part of the event's
--    evidence history. A later overlapping commitment with indistinguishable
--    semantics must not be able to count the same activity a second time merely
--    because the first commitment reached a terminal delivery state.

create or replace function public.partner_commitment_has_semantic_overlap(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      r.id as revision_id,
      r.commitment_id,
      r.commitment_type,
      r.domain,
      r.window_start,
      r.window_end,
      c.scope_id,
      c.committed_party_kind,
      c.committed_community_id,
      s.scope_kind
    from public.partner_commitment_revisions r
    join public.partner_commitments c on c.id = r.commitment_id
    join public.partner_commitment_scopes s on s.id = c.scope_id
    where r.id = p_revision_id
  ), peers as (
    select
      pc.id as commitment_id,
      public.partner_commitment_effective_revision(pc.id) as effective_revision_id
    from candidate x
    join public.partner_commitments pc
      on pc.scope_id = x.scope_id
     and pc.id <> x.commitment_id
     and pc.committed_party_kind = x.committed_party_kind
     and pc.committed_community_id is not distinct from x.committed_community_id
  )
  select exists (
    select 1
    from candidate x
    join peers p on p.effective_revision_id is not null
    join public.partner_commitment_revisions er on er.id = p.effective_revision_id
    where er.commitment_type = x.commitment_type
      and er.domain is not distinct from x.domain
      and public.partner_commitment_latest_status(er.id) in (
        'accepted','scheduled','delivering','fulfilled','partially_fulfilled'
      )
      and (
        x.scope_kind = 'program-template'
        or (
          x.window_start is not null
          and x.window_end is not null
          and er.window_start is not null
          and er.window_end is not null
          and x.window_start < er.window_end
          and er.window_start < x.window_end
        )
      )
  );
$$;

-- Reusable program configuration follows the same effective-contract semantics
-- as the shared ledger. A latest-but-unaccepted amendment is not yet the template.
create or replace function public.prefill_partner_program_commitments(
  p_exchange_id uuid,
  p_idempotency_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_scope_id uuid;
  v_event_scope public.partner_commitment_scopes;
  v_program_scope_id uuid;
  v_event public.events;
  v_exchange_state text;
  v_template record;
  v_commitment_id uuid;
  v_revision_id uuid;
  v_created integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 20 and 180 then
    raise exception 'strong idempotency key required';
  end if;

  v_event_scope_id := public.ensure_partner_exchange_commitment_scope(p_exchange_id);
  select * into v_event_scope
  from public.partner_commitment_scopes
  where id = v_event_scope_id;

  select state into v_exchange_state
  from public.community_exchange_agreements
  where id = v_event_scope.exchange_id;

  if v_exchange_state is distinct from 'active' then
    raise exception 'active operational exchange required for commitment prefill';
  end if;

  if v_event_scope.program_id is null then
    raise exception 'exchange was not instantiated from a reusable partner program';
  end if;

  select id into v_program_scope_id
  from public.partner_commitment_scopes
  where scope_kind = 'program-template'
    and program_id = v_event_scope.program_id;

  if v_program_scope_id is null then return 0; end if;

  select * into v_event
  from public.events
  where id = v_event_scope.event_id;

  if not public.is_event_operational(v_event_scope.event_id) then
    raise exception 'active operational exchange required for commitment prefill';
  end if;
  if v_event.ends_at is null then
    raise exception 'event end time is required before commitments can be prefilled';
  end if;

  for v_template in
    with effective as (
      select
        c.id as commitment_id,
        c.committed_party_kind,
        c.committed_community_id,
        public.partner_commitment_effective_revision(c.id) as effective_revision_id
      from public.partner_commitments c
      where c.scope_id = v_program_scope_id
    )
    select
      e.commitment_id,
      e.committed_party_kind,
      e.committed_community_id,
      r.id as revision_id,
      r.commitment_type,
      r.domain,
      r.committed_quantity
    from effective e
    join public.partner_commitment_revisions r on r.id = e.effective_revision_id
    where e.effective_revision_id is not null
      and public.partner_commitment_acceptance_state(r.id) = 'accepted'
      and public.partner_commitment_latest_status(r.id) = 'accepted'
    order by
      e.committed_party_kind,
      e.committed_community_id,
      r.commitment_type,
      r.domain nulls first,
      r.id
  loop
    if exists (
      select 1
      from public.partner_commitments c
      where c.scope_id = v_event_scope_id
        and c.source_template_revision_id = v_template.revision_id
    ) then
      continue;
    end if;

    insert into public.partner_commitments (
      scope_id,
      committed_party_kind,
      committed_community_id,
      source_template_revision_id,
      created_by
    ) values (
      v_event_scope_id,
      v_template.committed_party_kind,
      v_template.committed_community_id,
      v_template.revision_id,
      auth.uid()
    ) returning id into v_commitment_id;

    insert into public.partner_commitment_revisions (
      commitment_id,
      revision_no,
      commitment_type,
      domain,
      committed_quantity,
      window_start,
      window_end,
      created_by,
      idempotency_key
    ) values (
      v_commitment_id,
      1,
      v_template.commitment_type,
      v_template.domain,
      v_template.committed_quantity,
      coalesce(v_event.starts_at, v_event.created_at),
      v_event.ends_at,
      auth.uid(),
      trim(p_idempotency_key) || '-' || substr(v_template.revision_id::text, 1, 12)
    ) returning id into v_revision_id;

    -- Historical configuration reduces setup cost only. Every event copy starts
    -- over as a proposal and must earn the event's own required acceptance.
    insert into public.partner_commitment_lifecycle_events (
      revision_id,
      status,
      actor_kind,
      actor_user_id,
      reason_code
    ) values (
      v_revision_id,
      'proposed',
      'system',
      null,
      'proposal-created'
    );

    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

revoke all on function public.partner_commitment_has_semantic_overlap(uuid) from public;
revoke all on function public.prefill_partner_program_commitments(uuid,text) from public;
grant execute on function public.prefill_partner_program_commitments(uuid,text) to authenticated;

comment on function public.prefill_partner_program_commitments(uuid,text) is
  'Copies only the currently effective accepted Partner Program revision into an active operational exchange as a fresh proposal; pending/rejected amendments never silently replace accepted configuration.';
comment on function public.partner_commitment_has_semantic_overlap(uuid) is
  'Rejects indistinguishable overlapping obligations even when an earlier obligation is fulfilled/partially fulfilled, preventing one real activity from satisfying two semantic duplicates.';
