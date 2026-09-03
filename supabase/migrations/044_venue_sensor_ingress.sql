-- Venue sensor ingress
-- Gives real BLE/Wi-Fi/camera/edge adapters a revocable, replay-resistant path
-- into Beacon without granting devices user sessions or direct table mutation.
-- Device observations are aggregate only and expire from the raw ingress layer.

create extension if not exists pgcrypto;

create table if not exists public.venue_sensor_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_key text not null,
  source_kind text not null check (source_kind in ('ble','wifi','camera','edge','other')),
  layout_version text not null,
  token_digest text not null,
  token_version integer not null default 1 check (token_version > 0),
  max_observations_per_minute integer not null default 120
    check (max_observations_per_minute between 1 and 1200),
  active boolean not null default true,
  last_sequence bigint not null default -1,
  last_observed_at timestamptz,
  last_received_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  unique (event_id, source_key),
  check (length(trim(source_key)) between 2 and 80),
  check (length(trim(layout_version)) between 1 and 120),
  check (length(token_digest) = 64)
);

create table if not exists public.venue_sensor_observations (
  id bigserial primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.venue_sensor_sources(id) on delete cascade,
  schema_version text not null,
  layout_version text not null,
  kind text not null check (kind in ('occupancy','transition','service-point')),
  sequence bigint not null check (sequence >= 0),
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  confidence numeric not null check (confidence between 0 and 1),
  payload jsonb not null,
  record_hash text not null,
  retention_until timestamptz not null default (now() + interval '7 days'),
  unique (source_id, sequence),
  check (jsonb_typeof(payload) = 'object'),
  check (length(record_hash) = 64)
);

alter table public.venue_sensor_sources enable row level security;
alter table public.venue_sensor_observations enable row level security;

-- Tokens and raw aggregate ingress records are never readable or mutable through
-- normal client table APIs. Safe metadata is exposed only through scoped RPCs.
revoke all on public.venue_sensor_sources from authenticated, anon;
revoke all on public.venue_sensor_observations from authenticated, anon;

create index if not exists venue_sensor_observations_source_received_idx
  on public.venue_sensor_observations (source_id, received_at desc);
create index if not exists venue_sensor_observations_event_observed_idx
  on public.venue_sensor_observations (event_id, observed_at desc);
create index if not exists venue_sensor_observations_retention_idx
  on public.venue_sensor_observations (retention_until);

create or replace function public.get_venue_sensor_sources(p_event_id uuid)
returns table (
  source_id uuid,
  source_key text,
  source_kind text,
  layout_version text,
  token_version integer,
  max_observations_per_minute integer,
  active boolean,
  last_sequence bigint,
  last_observed_at timestamptz,
  last_received_at timestamptz,
  created_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not (
    public.is_event_host(p_event_id, auth.uid())
    or public.venue_operator_role(p_event_id, auth.uid()) is not null
  ) then
    raise exception 'venue operator scope required';
  end if;

  return query
  select
    s.id,
    s.source_key,
    s.source_kind,
    s.layout_version,
    s.token_version,
    s.max_observations_per_minute,
    s.active,
    s.last_sequence,
    s.last_observed_at,
    s.last_received_at,
    s.created_at,
    s.rotated_at,
    s.revoked_at
  from public.venue_sensor_sources s
  where s.event_id = p_event_id
  order by s.active desc, s.source_kind, s.source_key;
end;
$$;

create or replace function public.provision_venue_sensor_source(
  p_event_id uuid,
  p_source_key text,
  p_source_kind text,
  p_layout_version text,
  p_max_observations_per_minute integer default 120
)
returns table (
  source_id uuid,
  ingress_token text,
  token_version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_source_id uuid;
  v_active_layout text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not public.is_event_host(p_event_id, auth.uid()) then
    raise exception 'event host scope required to provision a sensor source';
  end if;
  if not public.is_event_operational(p_event_id) then
    raise exception 'sensor sources can be provisioned only for an operational event';
  end if;
  if p_source_kind not in ('ble','wifi','camera','edge','other') then
    raise exception 'unsupported sensor source kind';
  end if;
  if length(trim(coalesce(p_source_key, ''))) not between 2 and 80 then
    raise exception 'source key must be between 2 and 80 characters';
  end if;
  if p_max_observations_per_minute not between 1 and 1200 then
    raise exception 'source rate limit must be between 1 and 1200 observations per minute';
  end if;

  select r.layout_version into v_active_layout
  from public.venue_operation_releases r
  where r.event_id = p_event_id
    and r.activated_at <= now()
    and (r.expires_at is null or r.expires_at > now())
  order by r.activated_at desc
  limit 1;

  if v_active_layout is null then
    raise exception 'an active venue operations release is required before sensor provisioning';
  end if;
  if trim(p_layout_version) <> v_active_layout then
    raise exception 'sensor layout version must match the active venue operations release';
  end if;

  v_token := 'bcn_' || encode(gen_random_bytes(32), 'hex');

  insert into public.venue_sensor_sources (
    event_id,
    source_key,
    source_kind,
    layout_version,
    token_digest,
    max_observations_per_minute,
    created_by
  ) values (
    p_event_id,
    trim(p_source_key),
    p_source_kind,
    trim(p_layout_version),
    encode(digest(v_token, 'sha256'), 'hex'),
    p_max_observations_per_minute,
    auth.uid()
  )
  on conflict (event_id, source_key) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    raise exception 'source key already exists; rotate the existing source credential instead';
  end if;

  return query select v_source_id, v_token, 1;
end;
$$;

create or replace function public.rotate_venue_sensor_source_token(p_source_id uuid)
returns table (
  source_id uuid,
  ingress_token text,
  token_version integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.venue_sensor_sources;
  v_token text;
  v_version integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into v_source
  from public.venue_sensor_sources s
  where s.id = p_source_id
  for update;

  if v_source.id is null or not public.is_event_host(v_source.event_id, auth.uid()) then
    raise exception 'event host scope required to rotate a sensor credential';
  end if;
  if not public.is_event_operational(v_source.event_id) then
    raise exception 'sensor credentials cannot be rotated for a closed event';
  end if;

  v_token := 'bcn_' || encode(gen_random_bytes(32), 'hex');
  v_version := v_source.token_version + 1;

  update public.venue_sensor_sources
  set
    token_digest = encode(digest(v_token, 'sha256'), 'hex'),
    token_version = v_version,
    active = true,
    rotated_at = now(),
    revoked_at = null
  where id = p_source_id;

  return query select p_source_id, v_token, v_version;
end;
$$;

create or replace function public.revoke_venue_sensor_source(p_source_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select s.event_id into v_event_id
  from public.venue_sensor_sources s
  where s.id = p_source_id;

  if v_event_id is null or not public.is_event_host(v_event_id, auth.uid()) then
    raise exception 'event host scope required to revoke a sensor source';
  end if;

  update public.venue_sensor_sources
  set active = false, revoked_at = coalesce(revoked_at, now())
  where id = p_source_id;

  return found;
end;
$$;

create or replace function public.ingest_venue_sensor_observation(
  p_source_id uuid,
  p_ingress_token text,
  p_schema_version text,
  p_layout_version text,
  p_kind text,
  p_sequence bigint,
  p_observed_at timestamptz,
  p_confidence numeric,
  p_payload jsonb
)
returns table (
  observation_id bigint,
  received_at timestamptz,
  accepted_sequence bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.venue_sensor_sources;
  v_rate_count integer;
  v_hash text;
  v_id bigint;
  v_received_at timestamptz;
  v_existing_hash text;
  v_number numeric;
  v_allowed_keys text[];
begin
  if p_ingress_token is null or length(p_ingress_token) < 20 then
    raise exception 'sensor credential required';
  end if;

  select * into v_source
  from public.venue_sensor_sources s
  where s.id = p_source_id
  for update;

  if v_source.id is null then
    raise exception 'sensor source not found';
  end if;
  if not v_source.active or v_source.revoked_at is not null then
    raise exception 'sensor source is revoked';
  end if;
  if v_source.token_digest <> encode(digest(p_ingress_token, 'sha256'), 'hex') then
    raise exception 'sensor credential rejected';
  end if;
  if not public.is_event_operational(v_source.event_id) then
    raise exception 'event is not operational';
  end if;
  if p_schema_version <> '1.0' then
    raise exception 'unsupported venue observation schema version';
  end if;
  if trim(coalesce(p_layout_version, '')) <> v_source.layout_version then
    raise exception 'sensor observation layout version mismatch';
  end if;
  if p_kind not in ('occupancy','transition','service-point') then
    raise exception 'device ingress accepts aggregate occupancy, transition, or service-point observations only';
  end if;
  if p_sequence is null or p_sequence < 0 then
    raise exception 'non-negative source sequence required';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'observation confidence must be between 0 and 1';
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '30 seconds' then
    raise exception 'observation timestamp is materially in the future';
  end if;
  if p_observed_at < now() - interval '10 minutes' then
    raise exception 'observation is too stale for live venue ingress';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'aggregate observation payload must be a JSON object';
  end if;
  if v_source.last_sequence >= 0 and p_sequence < greatest(0, v_source.last_sequence - 64) then
    raise exception 'observation sequence is outside the bounded replay/reorder window';
  end if;

  select count(*)::integer into v_rate_count
  from public.venue_sensor_observations o
  where o.source_id = p_source_id
    and o.received_at >= now() - interval '1 minute';

  if v_rate_count >= v_source.max_observations_per_minute then
    raise exception 'sensor source rate limit exceeded';
  end if;

  if p_kind = 'occupancy' then
    v_allowed_keys := array['zoneId','occupancy','sampleSupport'];
    if (p_payload - v_allowed_keys) <> '{}'::jsonb then
      raise exception 'occupancy payload contains unsupported fields';
    end if;
    if length(trim(coalesce(p_payload->>'zoneId', ''))) not between 1 and 96 then
      raise exception 'occupancy zoneId is required';
    end if;
    if jsonb_typeof(p_payload->'occupancy') <> 'number'
       or jsonb_typeof(p_payload->'sampleSupport') <> 'number' then
      raise exception 'occupancy and sampleSupport must be numeric';
    end if;
    v_number := (p_payload->>'occupancy')::numeric;
    if v_number < 0 then raise exception 'occupancy cannot be negative'; end if;
    v_number := (p_payload->>'sampleSupport')::numeric;
    if v_number < 0 then raise exception 'sampleSupport cannot be negative'; end if;
  elsif p_kind = 'transition' then
    v_allowed_keys := array['fromZoneId','toZoneId','support','sampleSupport'];
    if (p_payload - v_allowed_keys) <> '{}'::jsonb then
      raise exception 'transition payload contains unsupported fields';
    end if;
    if length(trim(coalesce(p_payload->>'fromZoneId', ''))) not between 1 and 96
       or length(trim(coalesce(p_payload->>'toZoneId', ''))) not between 1 and 96 then
      raise exception 'transition zone ids are required';
    end if;
    if (p_payload->>'fromZoneId') = (p_payload->>'toZoneId') then
      raise exception 'transition origin and destination must differ';
    end if;
    if jsonb_typeof(p_payload->'support') <> 'number'
       or jsonb_typeof(p_payload->'sampleSupport') <> 'number' then
      raise exception 'transition support fields must be numeric';
    end if;
    if (p_payload->>'support')::numeric < 0 or (p_payload->>'sampleSupport')::numeric < 0 then
      raise exception 'transition support cannot be negative';
    end if;
  else
    v_allowed_keys := array['servicePointId','zoneId','queueLength','arrivals','completions','windowMinutes','sampleSupport'];
    if (p_payload - v_allowed_keys) <> '{}'::jsonb then
      raise exception 'service-point payload contains unsupported fields';
    end if;
    if length(trim(coalesce(p_payload->>'servicePointId', ''))) not between 1 and 96
       or length(trim(coalesce(p_payload->>'zoneId', ''))) not between 1 and 96 then
      raise exception 'service-point and zone identifiers are required';
    end if;
    if jsonb_typeof(p_payload->'queueLength') <> 'number'
       or jsonb_typeof(p_payload->'arrivals') <> 'number'
       or jsonb_typeof(p_payload->'completions') <> 'number'
       or jsonb_typeof(p_payload->'windowMinutes') <> 'number'
       or jsonb_typeof(p_payload->'sampleSupport') <> 'number' then
      raise exception 'service-point metrics must be numeric';
    end if;
    if (p_payload->>'queueLength')::numeric < 0
       or (p_payload->>'arrivals')::numeric < 0
       or (p_payload->>'completions')::numeric < 0
       or (p_payload->>'sampleSupport')::numeric < 0 then
      raise exception 'service-point counts cannot be negative';
    end if;
    v_number := (p_payload->>'windowMinutes')::numeric;
    if v_number <= 0 or v_number > 120 then
      raise exception 'service-point windowMinutes must be in (0,120]';
    end if;
  end if;

  v_hash := encode(digest(concat_ws('|',
    v_source.event_id::text,
    p_source_id::text,
    p_schema_version,
    p_layout_version,
    p_kind,
    p_sequence::text,
    p_observed_at::text,
    p_confidence::text,
    p_payload::text
  ), 'sha256'), 'hex');

  insert into public.venue_sensor_observations (
    event_id,
    source_id,
    schema_version,
    layout_version,
    kind,
    sequence,
    observed_at,
    confidence,
    payload,
    record_hash
  ) values (
    v_source.event_id,
    p_source_id,
    p_schema_version,
    p_layout_version,
    p_kind,
    p_sequence,
    p_observed_at,
    p_confidence,
    p_payload,
    v_hash
  )
  on conflict (source_id, sequence) do nothing
  returning id, venue_sensor_observations.received_at into v_id, v_received_at;

  if v_id is null then
    select o.id, o.received_at, o.record_hash
      into v_id, v_received_at, v_existing_hash
    from public.venue_sensor_observations o
    where o.source_id = p_source_id and o.sequence = p_sequence;

    if v_existing_hash is distinct from v_hash then
      raise exception 'sequence replay attempted with a different payload';
    end if;
  else
    update public.venue_sensor_sources
    set
      last_sequence = greatest(last_sequence, p_sequence),
      last_observed_at = case
        when last_observed_at is null or p_observed_at > last_observed_at then p_observed_at
        else last_observed_at
      end,
      last_received_at = v_received_at
    where id = p_source_id;
  end if;

  return query select v_id, v_received_at, p_sequence;
end;
$$;

-- Raw ingress is a short-lived transport layer, not a permanent mobility store.
-- Trusted backend maintenance can call this periodically; clients cannot choose
-- arbitrary retention windows or delete evidence selectively.
create or replace function public.purge_expired_venue_sensor_observations()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  delete from public.venue_sensor_observations
  where retention_until <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.get_venue_sensor_sources(uuid) from public;
revoke all on function public.provision_venue_sensor_source(uuid,text,text,text,integer) from public;
revoke all on function public.rotate_venue_sensor_source_token(uuid) from public;
revoke all on function public.revoke_venue_sensor_source(uuid) from public;
revoke all on function public.ingest_venue_sensor_observation(uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb) from public;
revoke all on function public.purge_expired_venue_sensor_observations() from public;

grant execute on function public.get_venue_sensor_sources(uuid) to authenticated;
grant execute on function public.provision_venue_sensor_source(uuid,text,text,text,integer) to authenticated;
grant execute on function public.rotate_venue_sensor_source_token(uuid) to authenticated;
grant execute on function public.revoke_venue_sensor_source(uuid) to authenticated;
-- Sensors call with the public project API key plus their own unique ingress token.
-- The token is the device credential; no user session is required for telemetry.
grant execute on function public.ingest_venue_sensor_observation(uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb) to anon, authenticated;
grant execute on function public.purge_expired_venue_sensor_observations() to service_role;

comment on table public.venue_sensor_sources is
  'Event-scoped aggregate sensor adapters with unique hashed credentials, revocation, rate limits, and layout binding.';
comment on table public.venue_sensor_observations is
  'Short-lived aggregate sensor ingress. Payload schemas intentionally exclude attendee identifiers and person-level trajectories.';
comment on function public.ingest_venue_sensor_observation(uuid,text,text,text,text,bigint,timestamptz,numeric,jsonb) is
  'Authenticates one sensor credential, enforces event/layout/schema/time/sequence/rate/payload boundaries, and records an idempotent aggregate observation.';
