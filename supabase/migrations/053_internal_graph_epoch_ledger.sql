-- =============================================================================
-- 053_internal_graph_epoch_ledger.sql
-- Durable longitudinal structural memory for finalized Beacon events.
--
-- Privacy contract:
--   * epochs contain structural summaries, never contact data or raw GPS;
--   * person membership/broker history references erasable subject aliases by FK;
--   * deleting an account alias cascades its epoch membership/broker rows;
--   * no opaque JSON array of person aliases is retained inside the epoch row;
--   * recording is operator-only and re-validates submitted analysis against the
--     current server-derived event graph before accepting it.
-- =============================================================================

create table if not exists public.internal_graph_epochs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  graph_version text not null check (char_length(graph_version) between 1 and 80),
  topology_digest text not null check (char_length(topology_digest) = 64),
  node_count integer not null check (node_count >= 0),
  edge_count integer not null check (edge_count >= 0),
  community_count integer not null check (community_count >= 0),
  articulation_count integer not null default 0 check (articulation_count >= 0),
  critical_bridge_count integer not null default 0 check (critical_bridge_count >= 0),
  structural_dependence numeric(8,6) not null default 0 check (structural_dependence between 0 and 1),
  summary jsonb not null default '{}'::jsonb,
  captured_by uuid references public.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '730 days'),
  unique (event_id, topology_digest)
);

create index if not exists internal_graph_epochs_event_time_idx
  on public.internal_graph_epochs(event_id, captured_at desc);
create index if not exists internal_graph_epochs_time_idx
  on public.internal_graph_epochs(captured_at desc);

create table if not exists public.internal_graph_epoch_communities (
  epoch_id uuid not null references public.internal_graph_epochs(id) on delete cascade,
  local_community_id integer not null,
  label text not null check (char_length(label) between 1 and 160),
  total_size integer not null check (total_size >= 0),
  person_count integer not null default 0 check (person_count >= 0),
  cohesion numeric(8,6) not null default 0 check (cohesion between 0 and 1),
  primary key (epoch_id, local_community_id)
);

create table if not exists public.internal_graph_epoch_members (
  epoch_id uuid not null,
  local_community_id integer not null,
  subject_alias uuid not null references public.internal_graph_subject_aliases(alias) on delete cascade,
  primary key (epoch_id, local_community_id, subject_alias),
  foreign key (epoch_id, local_community_id)
    references public.internal_graph_epoch_communities(epoch_id, local_community_id)
    on delete cascade
);
create index if not exists internal_graph_epoch_members_alias_idx
  on public.internal_graph_epoch_members(subject_alias, epoch_id);

create table if not exists public.internal_graph_epoch_brokers (
  epoch_id uuid not null references public.internal_graph_epochs(id) on delete cascade,
  subject_alias uuid not null references public.internal_graph_subject_aliases(alias) on delete cascade,
  rank integer not null check (rank >= 1),
  forensic_score numeric(12,6) not null default 0,
  broker_score numeric(12,6) not null default 0,
  participation_coefficient numeric(8,6) not null default 0 check (participation_coefficient between 0 and 1),
  effective_size numeric(12,6) not null default 0,
  redundancy_ratio numeric(8,6) not null default 0 check (redundancy_ratio between 0 and 1),
  articulation boolean not null default false,
  cross_community_count integer not null default 0 check (cross_community_count >= 0),
  primary key (epoch_id, subject_alias)
);

create table if not exists public.internal_graph_epoch_motifs (
  epoch_id uuid not null references public.internal_graph_epochs(id) on delete cascade,
  motif_key text not null check (char_length(motif_key) between 1 and 80),
  observed_count integer not null default 0 check (observed_count >= 0),
  strength numeric(12,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (epoch_id, motif_key)
);

alter table public.internal_graph_epochs enable row level security;
alter table public.internal_graph_epoch_communities enable row level security;
alter table public.internal_graph_epoch_members enable row level security;
alter table public.internal_graph_epoch_brokers enable row level security;
alter table public.internal_graph_epoch_motifs enable row level security;

revoke all on table public.internal_graph_epochs from anon, authenticated;
revoke all on table public.internal_graph_epoch_communities from anon, authenticated;
revoke all on table public.internal_graph_epoch_members from anon, authenticated;
revoke all on table public.internal_graph_epoch_brokers from anon, authenticated;
revoke all on table public.internal_graph_epoch_motifs from anon, authenticated;

create or replace function public.record_internal_graph_epoch(
  p_event_id uuid,
  p_analysis jsonb,
  p_motifs jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events;
  v_graph jsonb;
  v_graph_text text;
  v_digest text;
  v_epoch_id uuid;
  v_community jsonb;
  v_broker jsonb;
  v_motif jsonb;
  v_node_id text;
  v_alias uuid;
  v_person_count integer;
  v_rank integer := 0;
begin
  if not public.has_internal_operator_capability('graph_manage') then
    raise exception 'Internal graph management capability required';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then raise exception 'Unknown event'; end if;
  if v_event.finalized_at is null then
    raise exception 'Durable graph epochs require a finalized event';
  end if;
  if p_analysis is null or jsonb_typeof(p_analysis) <> 'object' then
    raise exception 'Analysis payload must be an object';
  end if;
  if jsonb_typeof(coalesce(p_analysis->'communities', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_analysis->'brokers', '[]'::jsonb)) <> 'array' then
    raise exception 'Analysis communities and brokers must be arrays';
  end if;
  if jsonb_typeof(coalesce(p_motifs, '[]'::jsonb)) <> 'array' then
    raise exception 'Motifs must be an array';
  end if;

  -- Recompute the authorized event graph server-side. The client may submit
  -- analysis, but it cannot invent node membership outside this graph.
  v_graph := public.get_internal_intelligence_graph(p_event_id, false, 2000);
  v_graph_text := v_graph::text;
  v_digest := encode(digest(v_graph_text, 'sha256'), 'hex');

  insert into public.internal_graph_epochs (
    event_id,
    graph_version,
    topology_digest,
    node_count,
    edge_count,
    community_count,
    articulation_count,
    critical_bridge_count,
    structural_dependence,
    summary,
    captured_by,
    expires_at
  ) values (
    p_event_id,
    coalesce(nullif(v_graph->>'graphVersion', ''), 'unknown'),
    v_digest,
    coalesce((v_graph->>'nodeCount')::integer, 0),
    coalesce((v_graph->>'edgeCount')::integer, 0),
    jsonb_array_length(coalesce(p_analysis->'communities', '[]'::jsonb)),
    greatest(0, coalesce((p_analysis->>'articulationCount')::integer, 0)),
    greatest(0, coalesce((p_analysis->>'criticalBridgeCount')::integer, 0)),
    least(1::numeric, greatest(0::numeric, coalesce((p_analysis->>'structuralDependence')::numeric, 0))),
    jsonb_build_object(
      'analysisVersion', coalesce(p_analysis->>'analysisVersion', 'forensics-v1'),
      'capturedFrom', 'server-validated-event-graph'
    ),
    auth.uid(),
    now() + interval '730 days'
  )
  on conflict (event_id, topology_digest) do update
    set captured_at = now(),
        expires_at = greatest(public.internal_graph_epochs.expires_at, excluded.expires_at),
        community_count = excluded.community_count,
        articulation_count = excluded.articulation_count,
        critical_bridge_count = excluded.critical_bridge_count,
        structural_dependence = excluded.structural_dependence,
        summary = excluded.summary,
        captured_by = auth.uid()
  returning id into v_epoch_id;

  -- Replace derived epoch analysis atomically so repeat captures are idempotent.
  delete from public.internal_graph_epoch_motifs where epoch_id = v_epoch_id;
  delete from public.internal_graph_epoch_brokers where epoch_id = v_epoch_id;
  delete from public.internal_graph_epoch_communities where epoch_id = v_epoch_id;

  for v_community in select value from jsonb_array_elements(p_analysis->'communities')
  loop
    if jsonb_typeof(coalesce(v_community->'nodeIds', '[]'::jsonb)) <> 'array' then
      raise exception 'Community nodeIds must be an array';
    end if;

    -- Reject any node the client claims that is absent from the current graph.
    if exists (
      select 1
      from jsonb_array_elements_text(v_community->'nodeIds') submitted(node_id)
      where not exists (
        select 1 from jsonb_array_elements(v_graph->'nodes') graph_node
        where graph_node->>'id' = submitted.node_id
      )
    ) then
      raise exception 'Community contains node outside the current event graph';
    end if;

    select count(*)::integer into v_person_count
    from jsonb_array_elements_text(v_community->'nodeIds') submitted(node_id)
    where submitted.node_id like 'person:%';

    insert into public.internal_graph_epoch_communities (
      epoch_id, local_community_id, label, total_size, person_count, cohesion
    ) values (
      v_epoch_id,
      coalesce((v_community->>'id')::integer, 0),
      left(coalesce(nullif(v_community->>'label', ''), 'Community'), 160),
      jsonb_array_length(v_community->'nodeIds'),
      v_person_count,
      least(1::numeric, greatest(0::numeric, coalesce((v_community->>'cohesion')::numeric, 0)))
    );

    for v_node_id in select value from jsonb_array_elements_text(v_community->'nodeIds')
    loop
      if v_node_id like 'person:%' then
        begin
          v_alias := substring(v_node_id from 8)::uuid;
        exception when invalid_text_representation then
          raise exception 'Malformed person graph alias';
        end;
        if not exists (select 1 from public.internal_graph_subject_aliases a where a.alias = v_alias) then
          raise exception 'Unknown person graph alias';
        end if;
        insert into public.internal_graph_epoch_members(epoch_id, local_community_id, subject_alias)
        values (v_epoch_id, coalesce((v_community->>'id')::integer, 0), v_alias)
        on conflict do nothing;
      end if;
    end loop;
  end loop;

  v_rank := 0;
  for v_broker in select value from jsonb_array_elements(p_analysis->'brokers')
  loop
    v_node_id := v_broker->>'nodeId';
    if v_node_id is null or v_node_id not like 'person:%' then continue; end if;
    if not exists (
      select 1 from jsonb_array_elements(v_graph->'nodes') graph_node
      where graph_node->>'id' = v_node_id
    ) then
      raise exception 'Broker outside the current event graph';
    end if;
    begin
      v_alias := substring(v_node_id from 8)::uuid;
    exception when invalid_text_representation then
      raise exception 'Malformed broker alias';
    end;
    if not exists (select 1 from public.internal_graph_subject_aliases a where a.alias = v_alias) then
      raise exception 'Unknown broker alias';
    end if;
    v_rank := v_rank + 1;
    if v_rank > 100 then exit; end if;
    insert into public.internal_graph_epoch_brokers (
      epoch_id, subject_alias, rank, forensic_score, broker_score,
      participation_coefficient, effective_size, redundancy_ratio,
      articulation, cross_community_count
    ) values (
      v_epoch_id,
      v_alias,
      v_rank,
      coalesce((v_broker->>'forensicScore')::numeric, 0),
      coalesce((v_broker->>'brokerScore')::numeric, 0),
      least(1::numeric, greatest(0::numeric, coalesce((v_broker->>'participationCoefficient')::numeric, 0))),
      greatest(0::numeric, coalesce((v_broker->>'effectiveSize')::numeric, 0)),
      least(1::numeric, greatest(0::numeric, coalesce((v_broker->>'redundancyRatio')::numeric, 0))),
      coalesce((v_broker->>'articulation')::boolean, false),
      greatest(0, coalesce((v_broker->>'crossCommunityCount')::integer, 0))
    ) on conflict (epoch_id, subject_alias) do update set
      rank = excluded.rank,
      forensic_score = excluded.forensic_score,
      broker_score = excluded.broker_score,
      participation_coefficient = excluded.participation_coefficient,
      effective_size = excluded.effective_size,
      redundancy_ratio = excluded.redundancy_ratio,
      articulation = excluded.articulation,
      cross_community_count = excluded.cross_community_count;
  end loop;

  for v_motif in select value from jsonb_array_elements(coalesce(p_motifs, '[]'::jsonb))
  loop
    if nullif(v_motif->>'key', '') is null then continue; end if;
    insert into public.internal_graph_epoch_motifs (
      epoch_id, motif_key, observed_count, strength, metadata
    ) values (
      v_epoch_id,
      left(v_motif->>'key', 80),
      greatest(0, coalesce((v_motif->>'count')::integer, 0)),
      greatest(0::numeric, coalesce((v_motif->>'strength')::numeric, 0)),
      jsonb_build_object('class', left(coalesce(v_motif->>'class', 'structural'), 60))
    ) on conflict (epoch_id, motif_key) do update set
      observed_count = excluded.observed_count,
      strength = excluded.strength,
      metadata = excluded.metadata;
  end loop;

  insert into public.internal_graph_audit_log(actor_id, action, event_id, metadata)
  values (
    auth.uid(), 'graph_epoch_recorded', p_event_id,
    jsonb_build_object('epochId', v_epoch_id, 'topologyDigest', v_digest)
  );

  return v_epoch_id;
end;
$$;
revoke all on function public.record_internal_graph_epoch(uuid, jsonb, jsonb) from public;
grant execute on function public.record_internal_graph_epoch(uuid, jsonb, jsonb) to authenticated;

create or replace function public.get_internal_graph_epoch_history(p_limit integer default 48)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if not public.has_internal_operator_capability('graph_read') then
    raise exception 'Internal graph access required';
  end if;

  select coalesce(jsonb_agg(epoch_payload order by captured_at desc), '[]'::jsonb)
  into v_payload
  from (
    select
      e.captured_at,
      jsonb_build_object(
        'epochId', e.id,
        'eventId', e.event_id,
        'eventName', ev.name,
        'capturedAt', e.captured_at,
        'topologyDigest', e.topology_digest,
        'nodeCount', e.node_count,
        'edgeCount', e.edge_count,
        'communityCount', e.community_count,
        'articulationCount', e.articulation_count,
        'criticalBridgeCount', e.critical_bridge_count,
        'structuralDependence', e.structural_dependence,
        'communities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.local_community_id,
            'label', c.label,
            'size', c.total_size,
            'personCount', c.person_count,
            'cohesion', c.cohesion,
            'memberAliases', coalesce((
              select jsonb_agg(m.subject_alias order by m.subject_alias)
              from public.internal_graph_epoch_members m
              where m.epoch_id = c.epoch_id
                and m.local_community_id = c.local_community_id
            ), '[]'::jsonb)
          ) order by c.local_community_id)
          from public.internal_graph_epoch_communities c where c.epoch_id = e.id
        ), '[]'::jsonb),
        'brokers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'subjectAlias', b.subject_alias,
            'rank', b.rank,
            'forensicScore', b.forensic_score,
            'brokerScore', b.broker_score,
            'participationCoefficient', b.participation_coefficient,
            'effectiveSize', b.effective_size,
            'redundancyRatio', b.redundancy_ratio,
            'articulation', b.articulation,
            'crossCommunityCount', b.cross_community_count
          ) order by b.rank)
          from public.internal_graph_epoch_brokers b where b.epoch_id = e.id
        ), '[]'::jsonb),
        'motifs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', m.motif_key,
            'count', m.observed_count,
            'strength', m.strength,
            'class', m.metadata->>'class'
          ) order by m.motif_key)
          from public.internal_graph_epoch_motifs m where m.epoch_id = e.id
        ), '[]'::jsonb)
      ) as epoch_payload
    from public.internal_graph_epochs e
    join public.events ev on ev.id = e.event_id
    where e.expires_at > now()
    order by e.captured_at desc
    limit least(120, greatest(1, coalesce(p_limit, 48)))
  ) epochs;

  return jsonb_build_object(
    'generatedAt', now(),
    'epochs', v_payload,
    'retentionNote', 'Person membership and broker history are FK-bound to erasable graph aliases; account erasure removes those longitudinal person references.'
  );
end;
$$;
revoke all on function public.get_internal_graph_epoch_history(integer) from public;
grant execute on function public.get_internal_graph_epoch_history(integer) to authenticated;

create or replace function public.prune_internal_graph_epochs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.internal_graph_epochs where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_internal_graph_epochs() from public;
grant execute on function public.prune_internal_graph_epochs() to service_role;

comment on table public.internal_graph_epochs is
  'Bounded operator-only longitudinal structural snapshots for finalized events. Person membership lives only in erasable FK-backed child rows.';
