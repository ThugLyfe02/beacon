# Beacon Internal Intelligence Graph

## Purpose

Constellation is Beacon's operator-only relationship intelligence layer. It exists to help a very small, explicitly provisioned internal operator set understand how first-party Beacon entities connect across events, mutuals, Office Hours, roles, venues, outcomes, and safety state.

It is designed as an internal forensic/strategy substrate, not a user-facing recommender and not a people-scraping system.

## Graphify-inspired, not Graphify-copied

The design borrows several architectural ideas from the public `Graphify-Labs/graphify` project while reimplementing them for Beacon's event domain:

- deterministic graph identity rather than opaque vector similarity;
- explicit node/edge schemas;
- confidence on every relationship;
- community detection with super-hub suppression;
- "god node" / hub analysis;
- surprising cross-community connections;
- graph diffs over time;
- every edge explainable from provenance.

Beacon does **not** copy Graphify's AST/code extractors. Beacon's source systems are its own Postgres event, social, Office Hours, outcome, safety, and venue-memory tables.

## Operator model

**Zero default operators.** Migrations create the capability system but provision nobody.

Provision intended operators only from a service-role environment after deployment:

```sql
select public.provision_internal_operator(
  '<OPERATOR_USER_UUID>'::uuid,
  array['graph_read', 'graph_restricted', 'graph_manage', 'graph_export'],
  'Founding operator'
);
```

Run the call once for each intended operator UUID. Never place operator UUIDs, names, or email addresses in a client bundle or migration.

Capabilities:

- `graph_read` — standard graph read/refresh.
- `graph_restricted` — block/report topology.
- `graph_manage` — all graph capabilities plus Bridge Builder assertions.
- `graph_export` — reserved for future controlled export surfaces.

`internal_operator_access` has no client table policy. Capability checks occur through caller-scoped `SECURITY DEFINER` RPCs.

## Evidence model

The graph is derived from Beacon source-of-truth tables and then materialized as bounded edge memory.

Representative relations:

- `hosted`
- `attended`
- `join_requested` / `join_rejected` (restricted)
- `has_role`
- `follows`
- `signaled`
- `mutual_with`
- `office_hours_with`
- `outcome_aligned`
- `outcome_completed`
- `aligned_to_outcome`
- `at_venue`
- `has_room`
- `blocked` (restricted)
- `reported` (restricted)

Each edge records:

- source / target key;
- relation;
- directedness;
- confidence (`VERIFIED`, `DERIVED`, `AMBIGUOUS`);
- sensitivity (`standard`, `restricted`);
- strength;
- first seen / last seen;
- evidence count;
- latest structured evidence pointer;
- expiry.

Refresh is idempotent: evidence counts come from authoritative source rows, not refresh-call count.

## Person identity and erasure

Person nodes never use a raw user UUID as their graph key. `internal_graph_subject_aliases` maps a current user to a random graph alias.

The client resolves the alias to current name/role only through the operator graph RPC.

When a user account is erased, the alias row cascades and a trigger purges that person's graph node and every edge containing it. Constellation therefore does not become a permanent pseudonymous dossier after account erasure.

Aggregate event intelligence remains separate from person graph state.

## Retention

The graph uses bounded retention windows rather than permanent raw history:

- standard relationship memory: generally up to ~730–1095 days depending on durable event/outcome value;
- current role context: ~365 days;
- restricted block/report topology: ~180 days;
- manual Bridge Builder assertions: default ~365 days unless explicitly shortened;
- operator audit rows: ~365 days.

`prune_internal_graph_memory()` is service-role-only.

## Restricted forensics

Block and abuse-report topology is sensitivity-labeled `restricted` and is returned only when the caller has `graph_restricted`.

Free-text safety report reasons are **not** copied into graph memory. The graph can reveal that a safety relationship exists without turning the visualization into a replica of sensitive moderation text.

## Bridge Builder

`add_internal_graph_assertion()` provides a controlled Maltego-like point of entry for internal context that Beacon does not currently derive automatically.

Allowed entity kinds are intentionally limited to:

- organization
- domain
- project
- topic
- venue
- event
- role

Every assertion has a confidence label, optional `http(s)` provenance URI, optional note, observation time, expiry, creator, and audit event.

The Bridge Builder does **not** fetch people, phone numbers, home addresses, devices, hidden identifiers, or arbitrary personal dossiers. It is a provenance-entry surface, not an OSINT crawler.

## Analysis engine

The React Native analysis layer is dependency-free and deterministic.

### Communities

Weighted label propagation groups the graph into communities. High-degree super-hubs are temporarily excluded from propagation and reattached by weighted neighbor vote to avoid one utility node collapsing unrelated clusters.

### Hubs

Weighted degree identifies the most structurally connected nodes.

### Broker score

Broker score weights cross-community connectivity and community diversity. High broker score is a candidate indicator for:

- introduction leverage;
- event programming leverage;
- network boundary spanners;
- people/entities that connect otherwise separate ecosystems.

It is an internal structural metric, not a public social ranking.

### Structural-hole bridges

Constellation searches for two people who are not directly connected but share an explainable intermediate entity. Examples:

- same event;
- same role;
- same organization asserted through Bridge Builder;
- shared project/topic;
- shared venue context.

Candidates receive a score and human-readable reason. The feature identifies **points of entry for introductions**, not hidden intent.

### Surprising connections

Cross-community edges are ranked by relation rarity, evidence confidence, edge strength, and peripheral-to-hub structure. The output is meant to answer: "What connection in this graph deserves an operator's attention because it is structurally non-obvious?"

### Pathfinding

The workbench can set any two nodes as endpoints and compute an explainable weighted path. Strong verified edges cost less; derived/ambiguous edges receive a confidence penalty.

This turns the graph into a practical "How could we get from person A to person B?" tool.

### Graph diff

The client keeps the previous authorized graph snapshot in memory and computes added/removed nodes and edges on refresh. First/last-seen timestamps remain in durable edge memory for longer historical analysis.

## Native workbench

`InternalGraphScreen` / "Constellation" includes:

- Three.js/R3F interactive graph;
- deterministic community layout;
- broker-node elevation/pulse;
- node click-to-focus camera framing;
- search;
- global or event-scoped graphs;
- restricted forensics toggle when authorized;
- edge provenance detail;
- hub and broker ranking;
- structural-hole bridge candidates;
- surprising connections;
- explainable pathfinding;
- Bridge Builder for managed assertions;
- visible retention contract.

The route is registered for authenticated users, but the screen itself rechecks server-side operator capability. Normal users do not receive an entry control on their profile.

## Future high-value extensions

The architecture intentionally leaves controlled points of entry for:

1. **Graph snapshot manifests** — persistent topology diffs without retaining erased identity mappings.
2. **Operator notes / cases** — case folders referencing graph nodes without copying raw PII.
3. **Event programming simulator** — model which invited bridge nodes could increase cross-community connectivity before an event.
4. **Introduction outcome attribution** — measure whether a suggested structural-hole bridge later produced a mutual, Office Hours session, or two-party outcome.
5. **Authorized connectors** — organization/domain context from explicitly approved data sources, always with source URI + retention + confidence.
6. **Neo4j / GraphML export** — service-generated, access-logged exports for offline analysis, gated by `graph_export`.
7. **Temporal replay** — reconstruct graph topology at time T from first/last-seen edge memory without reconstructing raw GPS or private intent history.
8. **Community drift** — alert when a cluster splits, merges, or gains a new high-broker boundary node.

## Non-goals

Constellation does not:

- expose graph access to regular Beacon users;
- rank users publicly;
- infer private intent from movement;
- retain raw GPS trails;
- retain erased person graph aliases;
- expose email addresses through the graph payload;
- scrape external people data;
- automate sensitive-trait inference;
- replace primary Beacon tables with graph assertions.

The graph is powerful because it remains evidence-native and operator-auditable, not because it silently accumulates everything available about a person.
