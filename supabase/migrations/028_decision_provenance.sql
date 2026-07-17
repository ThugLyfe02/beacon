-- =============================================================================
-- 028_decision_provenance.sql
-- Privacy-safe, event-scoped provenance for high-impact product decisions.
-- Stores why a decision occurred without storing private messages, exact location,
-- raw model inputs, or concealed counterpart intent.
-- =============================================================================

create type public.decision_domain as enum (
  'opportunity_surge',
  'next_best_action',
  'verified_access',
  'signal_scarcity',
  'office_hours_queue',
  'access_drop',
  'outcome_handshake',
  'vault',
  'security'
);

create type public.decision_outcome as enum (
  'allow',
  'deny',
  'defer',
  'recommend',
  'align',
  'complete'
);

create table public.opportunity_decision_receipts (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  subject_id uuid references public.users(id) on delete set null,
  domain public.decision_domain not null,
  outcome public.decision_outcome not null,
  reason_codes text[] not null default '{}',
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  schema_version text not null default '1.0',
  input_fingerprint text not null check (char_length(input_fingerprint) between 8 and 80),
  feature_flags jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(feature_flags) = 'object'),
  check (jsonb_typeof(metadata) = 'object'),
  check (coalesce(array_length(reason_codes, 1), 0) <= 12),
  check (pg_column_size(metadata) <= 4096),
  check (pg_column_size(feature_flags) <= 4096)
);

create index opportunity_decision_receipts_actor_event_idx
  on public.opportunity_decision_receipts (actor_id, event_id, created_at desc);
create index opportunity_decision_receipts_event_domain_idx
  on public.opportunity_decision_receipts (event_id, domain, created_at desc);

alter table public.opportunity_decision_receipts enable row level security;

create policy "decision_receipts_read_own"
  on public.opportunity_decision_receipts
  for select
  using (auth.uid() = actor_id);

create or replace function public.record_opportunity_decision_receipt(
  p_event_id uuid,
  p_subject_id uuid,
  p_domain public.decision_domain,
  p_outcome public.decision_outcome,
  p_reason_codes text[],
  p_policy_version text,
  p_input_fingerprint text,
  p_feature_flags jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns public.opportunity_decision_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.opportunity_decision_receipts;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = auth.uid()
      and ep.status = 'approved'
  ) then
    raise exception 'Approved event participation required';
  end if;

  if p_subject_id is not null and not exists (
    select 1
    from public.event_participants ep
    where ep.event_id = p_event_id
      and ep.user_id = p_subject_id
      and ep.status = 'approved'
  ) then
    raise exception 'Decision subject must be an approved event participant';
  end if;

  if jsonb_typeof(coalesce(p_feature_flags, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'Decision metadata must be JSON objects';
  end if;

  insert into public.opportunity_decision_receipts (
    event_id,
    actor_id,
    subject_id,
    domain,
    outcome,
    reason_codes,
    policy_version,
    input_fingerprint,
    feature_flags,
    metadata,
    expires_at
  ) values (
    p_event_id,
    auth.uid(),
    p_subject_id,
    p_domain,
    p_outcome,
    coalesce(p_reason_codes, '{}'),
    p_policy_version,
    p_input_fingerprint,
    coalesce(p_feature_flags, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_expires_at
  )
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.record_opportunity_decision_receipt(
  uuid, uuid, public.decision_domain, public.decision_outcome, text[], text,
  text, jsonb, jsonb, timestamptz
) to authenticated;

comment on table public.opportunity_decision_receipts is
  'Event-scoped, privacy-safe provenance for explainable product decisions. Never stores private messages, raw coordinates, or concealed intent.';
