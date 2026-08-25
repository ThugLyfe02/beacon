-- Tamper-evident venue operations audit chain
-- Append-only storage prevents ordinary mutation. This adds a deterministic
-- server-side hash chain so exported/replayed evidence can also detect missing,
-- reordered, or modified chained records after this migration becomes active.
-- It is tamper-evident integrity, not an external signature or notarization.

create extension if not exists pgcrypto;

alter table public.venue_operation_audit_events
  add column if not exists integrity_version smallint,
  add column if not exists chain_sequence bigint,
  add column if not exists previous_record_hash text,
  add column if not exists record_hash text;

create unique index if not exists venue_operation_audit_chain_sequence_idx
  on public.venue_operation_audit_events (event_id, chain_sequence)
  where chain_sequence is not null;

create index if not exists venue_operation_audit_record_hash_idx
  on public.venue_operation_audit_events (event_id, record_hash)
  where record_hash is not null;

create or replace function public.compute_venue_operation_audit_hash(
  p_event_id uuid,
  p_chain_sequence bigint,
  p_previous_record_hash text,
  p_record_id uuid,
  p_event_type text,
  p_command_id text,
  p_intervention_id text,
  p_operator_id uuid,
  p_target_zone_ids text[],
  p_layout_version text,
  p_geometry_hash text,
  p_policy_version text,
  p_model_version text,
  p_admission_decision text,
  p_evidence_score numeric,
  p_reason_code text,
  p_note text,
  p_idempotency_key text,
  p_created_at timestamptz
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(
      convert_to(
        concat_ws('|',
          'venue-audit-v1',
          coalesce(p_event_id::text, ''),
          coalesce(p_chain_sequence::text, ''),
          coalesce(p_previous_record_hash, 'GENESIS'),
          coalesce(p_record_id::text, ''),
          coalesce(p_event_type, ''),
          coalesce(p_command_id, ''),
          coalesce(p_intervention_id, ''),
          coalesce(p_operator_id::text, ''),
          coalesce(array_to_string(p_target_zone_ids, ','), ''),
          coalesce(p_layout_version, ''),
          coalesce(p_geometry_hash, ''),
          coalesce(p_policy_version, ''),
          coalesce(p_model_version, ''),
          coalesce(p_admission_decision, ''),
          coalesce(p_evidence_score::text, ''),
          coalesce(p_reason_code, ''),
          coalesce(p_note, ''),
          coalesce(p_idempotency_key, ''),
          coalesce(p_created_at::text, '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.chain_venue_operation_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_previous_hash text;
  v_previous_sequence bigint;
begin
  -- Event-scoped advisory serialization makes sequence assignment deterministic
  -- even when multiple operator devices append at the same time.
  perform pg_advisory_xact_lock(hashtext(new.event_id::text));

  select a.chain_sequence, a.record_hash
    into v_previous_sequence, v_previous_hash
  from public.venue_operation_audit_events a
  where a.event_id = new.event_id
    and a.chain_sequence is not null
    and a.record_hash is not null
  order by a.chain_sequence desc
  limit 1;

  new.integrity_version := 1;
  new.chain_sequence := coalesce(v_previous_sequence, 0) + 1;
  new.previous_record_hash := v_previous_hash;
  new.record_hash := public.compute_venue_operation_audit_hash(
    new.event_id,
    new.chain_sequence,
    new.previous_record_hash,
    new.id,
    new.event_type,
    new.command_id,
    new.intervention_id,
    new.operator_id,
    new.target_zone_ids,
    new.layout_version,
    new.geometry_hash,
    new.policy_version,
    new.model_version,
    new.admission_decision,
    new.evidence_score,
    new.reason_code,
    new.note,
    new.idempotency_key,
    new.created_at
  );

  return new;
end;
$$;

drop trigger if exists venue_operation_audit_hash_chain on public.venue_operation_audit_events;
create trigger venue_operation_audit_hash_chain
before insert on public.venue_operation_audit_events
for each row execute function public.chain_venue_operation_audit_insert();

create or replace function public.verify_venue_operation_audit_chain(p_event_id uuid)
returns table (
  valid boolean,
  chained_records bigint,
  legacy_records bigint,
  first_broken_sequence bigint,
  chain_head_hash text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_row public.venue_operation_audit_events;
  v_previous_hash text := null;
  v_expected_sequence bigint := 1;
  v_expected_hash text;
  v_chained bigint := 0;
  v_legacy bigint := 0;
  v_broken bigint := null;
  v_head text := null;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not (
    public.is_event_host(p_event_id, auth.uid())
    or public.venue_operator_role(p_event_id, auth.uid()) is not null
  ) then
    raise exception 'event operator scope required';
  end if;

  select count(*) into v_legacy
  from public.venue_operation_audit_events a
  where a.event_id = p_event_id
    and a.record_hash is null;

  for v_row in
    select *
    from public.venue_operation_audit_events a
    where a.event_id = p_event_id
      and a.record_hash is not null
    order by a.chain_sequence asc
  loop
    v_chained := v_chained + 1;

    if v_row.chain_sequence is distinct from v_expected_sequence
       or v_row.previous_record_hash is distinct from v_previous_hash then
      v_broken := coalesce(v_row.chain_sequence, v_expected_sequence);
      exit;
    end if;

    v_expected_hash := public.compute_venue_operation_audit_hash(
      v_row.event_id,
      v_row.chain_sequence,
      v_row.previous_record_hash,
      v_row.id,
      v_row.event_type,
      v_row.command_id,
      v_row.intervention_id,
      v_row.operator_id,
      v_row.target_zone_ids,
      v_row.layout_version,
      v_row.geometry_hash,
      v_row.policy_version,
      v_row.model_version,
      v_row.admission_decision,
      v_row.evidence_score,
      v_row.reason_code,
      v_row.note,
      v_row.idempotency_key,
      v_row.created_at
    );

    if v_expected_hash is distinct from v_row.record_hash then
      v_broken := v_row.chain_sequence;
      exit;
    end if;

    v_previous_hash := v_row.record_hash;
    v_head := v_row.record_hash;
    v_expected_sequence := v_expected_sequence + 1;
  end loop;

  return query select
    v_broken is null,
    v_chained,
    v_legacy,
    v_broken,
    v_head;
end;
$$;

revoke all on function public.compute_venue_operation_audit_hash(
  uuid,bigint,text,uuid,text,text,text,uuid,text[],text,text,text,text,text,numeric,text,text,text,timestamptz
) from public;
revoke all on function public.verify_venue_operation_audit_chain(uuid) from public;
grant execute on function public.verify_venue_operation_audit_chain(uuid) to authenticated;

comment on column public.venue_operation_audit_events.record_hash is
  'Server-computed SHA-256 hash chained to the previous post-migration audit record. Tamper-evident, not an external digital signature.';
