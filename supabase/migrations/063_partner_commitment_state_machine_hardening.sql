-- Partner Commitment Ledger state-machine hardening
--
-- The primary ledger migration exposes only SECURITY DEFINER RPCs, but the
-- contract itself should remain correct even if a future RPC is implemented
-- incorrectly. These triggers move the critical invariants down to the data
-- boundary: accepted/scheduled work cannot be silently revised after delivery
-- begins, decisions cannot mutate a completed contract, measurements require a
-- fully accepted commitment, and lifecycle transitions are explicit.

-- Historical template provenance must not rely on an ON DELETE SET NULL action:
-- partner_commitments is intentionally immutable, so a referential SET NULL
-- would collide with its update guard. Restrict deletion instead and preserve the
-- source revision as part of the audit chain.
alter table public.partner_commitments
  drop constraint if exists partner_commitments_source_template_revision_id_fkey;
alter table public.partner_commitments
  add constraint partner_commitments_source_template_revision_id_fkey
  foreign key (source_template_revision_id)
  references public.partner_commitment_revisions(id)
  on delete restrict;

-- The event host is part of event-scoped contractual authority. Silently
-- nulling that actor would both violate the scope check and destroy provenance.
alter table public.partner_commitment_scopes
  drop constraint if exists partner_commitment_scopes_host_id_fkey;
alter table public.partner_commitment_scopes
  add constraint partner_commitment_scopes_host_id_fkey
  foreign key (host_id)
  references public.users(id)
  on delete restrict;

create or replace function public.enforce_partner_commitment_revision_supersession()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.partner_commitment_revisions;
  v_latest_id uuid;
  v_previous_status text;
begin
  if new.supersedes_revision_id is null then
    if new.revision_no <> 1 then
      raise exception 'first commitment revision must have revision number 1';
    end if;
    return new;
  end if;

  select * into v_previous
  from public.partner_commitment_revisions r
  where r.id = new.supersedes_revision_id;

  if v_previous.id is null or v_previous.commitment_id <> new.commitment_id then
    raise exception 'superseded revision must belong to the same commitment';
  end if;

  select r.id into v_latest_id
  from public.partner_commitment_revisions r
  where r.commitment_id = new.commitment_id
  order by r.revision_no desc
  limit 1;

  if v_latest_id is distinct from v_previous.id then
    raise exception 'only the current commitment revision may be superseded';
  end if;

  if new.revision_no <> v_previous.revision_no + 1 then
    raise exception 'commitment revision sequence must be contiguous';
  end if;

  v_previous_status := public.partner_commitment_latest_status(v_previous.id);
  if v_previous_status not in ('proposed','accepted') then
    raise exception 'commitment already entered delivery lifecycle; cancel it and create a new commitment instead';
  end if;

  return new;
end;
$$;

drop trigger if exists partner_commitment_revision_supersession_guard
  on public.partner_commitment_revisions;
create trigger partner_commitment_revision_supersession_guard
before insert on public.partner_commitment_revisions
for each row execute function public.enforce_partner_commitment_revision_supersession();

create or replace function public.enforce_partner_commitment_decision_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_required text[];
begin
  v_required := public.partner_commitment_required_roles(new.revision_id);
  if new.actor_role <> all(coalesce(v_required, '{}'::text[])) then
    raise exception 'decision role is not required by this commitment';
  end if;

  v_status := public.partner_commitment_latest_status(new.revision_id);

  if new.decision in ('accepted','rejected') and v_status <> 'proposed' then
    raise exception 'acceptance or rejection is allowed only while the revision is proposed';
  end if;

  if new.decision = 'withdrawn' and v_status not in ('proposed','accepted','scheduled') then
    raise exception 'withdrawal is no longer available after delivery begins or a terminal measurement is recorded';
  end if;

  return new;
end;
$$;

drop trigger if exists partner_commitment_decision_transition_guard
  on public.partner_commitment_decisions;
create trigger partner_commitment_decision_transition_guard
before insert on public.partner_commitment_decisions
for each row execute function public.enforce_partner_commitment_decision_transition();

create or replace function public.enforce_partner_commitment_measurement_admission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceptance text;
  v_status text;
  v_scope_kind text;
begin
  select s.scope_kind into v_scope_kind
  from public.partner_commitment_revisions r
  join public.partner_commitments c on c.id = r.commitment_id
  join public.partner_commitment_scopes s on s.id = c.scope_id
  where r.id = new.revision_id;

  if v_scope_kind is distinct from 'event-exchange' then
    raise exception 'program templates cannot receive delivery measurements';
  end if;

  v_acceptance := public.partner_commitment_acceptance_state(new.revision_id);
  if v_acceptance <> 'accepted' then
    raise exception 'all required parties must accept before commitment measurement';
  end if;

  v_status := public.partner_commitment_latest_status(new.revision_id);
  if v_status not in ('accepted','scheduled','delivering') then
    raise exception 'terminal or rejected commitment cannot receive a new measurement';
  end if;

  return new;
end;
$$;

drop trigger if exists partner_commitment_measurement_admission_guard
  on public.partner_commitment_measurements;
create trigger partner_commitment_measurement_admission_guard
before insert on public.partner_commitment_measurements
for each row execute function public.enforce_partner_commitment_measurement_admission();

create or replace function public.enforce_partner_commitment_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  select e.status into v_previous
  from public.partner_commitment_lifecycle_events e
  where e.revision_id = new.revision_id
  order by e.created_at desc, e.id desc
  limit 1;

  if v_previous is null then
    if new.status <> 'proposed' then
      raise exception 'commitment lifecycle must begin as proposed';
    end if;
    return new;
  end if;

  if v_previous = 'proposed' and new.status not in ('accepted','rejected','cancelled') then
    raise exception 'invalid commitment transition from proposed to %', new.status;
  elsif v_previous = 'accepted' and new.status not in (
    'scheduled','delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from accepted to %', new.status;
  elsif v_previous = 'scheduled' and new.status not in (
    'delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from scheduled to %', new.status;
  elsif v_previous = 'delivering' and new.status not in (
    'fulfilled','partially_fulfilled','cancelled','not_fulfilled'
  ) then
    raise exception 'invalid commitment transition from delivering to %', new.status;
  elsif v_previous in ('fulfilled','partially_fulfilled','cancelled','not_fulfilled','rejected') then
    raise exception 'terminal commitment state % is append-only and cannot transition again', v_previous;
  end if;

  return new;
end;
$$;

drop trigger if exists partner_commitment_lifecycle_transition_guard
  on public.partner_commitment_lifecycle_events;
create trigger partner_commitment_lifecycle_transition_guard
before insert on public.partner_commitment_lifecycle_events
for each row execute function public.enforce_partner_commitment_lifecycle_transition();

revoke all on function public.enforce_partner_commitment_revision_supersession() from public;
revoke all on function public.enforce_partner_commitment_decision_transition() from public;
revoke all on function public.enforce_partner_commitment_measurement_admission() from public;
revoke all on function public.enforce_partner_commitment_lifecycle_transition() from public;

comment on function public.enforce_partner_commitment_revision_supersession() is
  'Prevents a commitment from being revision-swapped after scheduling/delivery begins and requires a contiguous append-only supersession chain.';
comment on function public.enforce_partner_commitment_measurement_admission() is
  'Admits measurement only for fully accepted event commitments that have not reached a terminal lifecycle state.';
comment on function public.enforce_partner_commitment_lifecycle_transition() is
  'Database-level lifecycle state machine for Partner Commitment Ledger revisions; terminal states cannot be silently reopened.';
