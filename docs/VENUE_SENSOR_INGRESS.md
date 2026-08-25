# Venue sensor ingress

Beacon's venue operations layer now has an explicit machine-to-machine ingress path for aggregate physical telemetry. The goal is to make a real BLE gateway, Wi-Fi counter, camera occupancy service, or edge aggregator replaceable without letting any device become a privileged Beacon user or an unquestioned source of truth.

## Trust boundary

A venue sensor source is provisioned by the event host against the currently pinned venue-operations release. Provisioning returns a unique high-entropy `bcn_...` token exactly once. Beacon stores only the token's SHA-256 digest.

The sensor token authorizes telemetry for one event source. It does **not** authorize:

- reading attendee profiles;
- reading other sensor streams;
- writing venue commands;
- acting as an operator;
- manual operator confirmation;
- changing venue geometry or release state.

Tokens can be rotated or revoked independently. Rotation immediately invalidates the previous token.

## Accepted payloads

Device ingress accepts only three aggregate observation kinds. Payload fields are allow-listed; additional fields are rejected rather than silently retained.

### Occupancy

```json
{
  "p_source_id": "<source uuid>",
  "p_ingress_token": "bcn_<one-time provisioned secret>",
  "p_schema_version": "1.0",
  "p_layout_version": "<active release layout version>",
  "p_kind": "occupancy",
  "p_sequence": 1942,
  "p_observed_at": "2026-08-25T02:30:00Z",
  "p_confidence": 0.87,
  "p_payload": {
    "zoneId": "north-lounge",
    "occupancy": 47,
    "sampleSupport": 52
  }
}
```

### Transition

```json
{
  "p_source_id": "<source uuid>",
  "p_ingress_token": "bcn_<secret>",
  "p_schema_version": "1.0",
  "p_layout_version": "<active release layout version>",
  "p_kind": "transition",
  "p_sequence": 1943,
  "p_observed_at": "2026-08-25T02:30:02Z",
  "p_confidence": 0.81,
  "p_payload": {
    "fromZoneId": "main-hall",
    "toZoneId": "north-lounge",
    "support": 9,
    "sampleSupport": 14
  }
}
```

### Service point

```json
{
  "p_source_id": "<source uuid>",
  "p_ingress_token": "bcn_<secret>",
  "p_schema_version": "1.0",
  "p_layout_version": "<active release layout version>",
  "p_kind": "service-point",
  "p_sequence": 1944,
  "p_observed_at": "2026-08-25T02:30:04Z",
  "p_confidence": 0.9,
  "p_payload": {
    "servicePointId": "checkin-west",
    "zoneId": "west-entry",
    "queueLength": 12,
    "arrivals": 21,
    "completions": 17,
    "windowMinutes": 2,
    "sampleSupport": 34
  }
}
```

Manual confirmations intentionally do not exist in the device contract. They belong to authenticated human operators.

## HTTP transport

A sensor adapter can call the Supabase RPC over TLS using the project's public client key and its unique sensor credential. The public project key identifies the Supabase project; the `bcn_...` token is the source-specific authentication secret.

```bash
curl -X POST \
  "$SUPABASE_URL/rest/v1/rpc/ingest_venue_sensor_observation" \
  -H "apikey: $SUPABASE_PUBLIC_KEY" \
  -H "Authorization: Bearer $SUPABASE_PUBLIC_KEY" \
  -H "Content-Type: application/json" \
  --data @observation.json
```

Production gateways should protect the source token as a device credential, avoid logging it, and use TLS certificate verification. A compromised source should be revoked or rotated from the Beacon host workspace rather than sharing one credential across devices.

## Replay and ordering behavior

Each source owns a monotonically increasing sequence space.

- A duplicate `(source, sequence)` with the identical payload is idempotent and returns the previously accepted record.
- Reusing the same sequence with a different payload is rejected as a replay/mutation attempt.
- Packets more than 64 sequence positions behind the source high-water mark are rejected.
- This bounded late window allows modest packet reordering without accepting an unbounded historical replay.
- Observations more than ten minutes old or materially future-dated are rejected.

The existing venue observation buffer can still normalize the accepted event-time stream before multi-source consensus.

## Rate and lifecycle controls

Each source has its own maximum observations per minute. The default is 120 and the host can provision a different bounded limit when an adapter legitimately needs a different cadence.

Ingress also checks that:

- the event is still operational;
- the source is active and not revoked;
- the observation schema is supported;
- the observation layout exactly matches the source's pinned layout;
- confidence and numeric payload fields are in valid ranges.

Closing an event therefore cuts off device telemetry automatically through the same server-owned lifecycle boundary used by participants and venue commands.

## Data minimization

`venue_sensor_observations` is a short-lived transport layer, not a permanent mobility database. Raw aggregate ingress receives a seven-day retention timestamp and a service-role cleanup function. Long-term value should come from bounded venue state, measured interventions, closeouts, and context-scoped venue memory rather than indefinite raw packet retention.

The device payload allow-list does not contain user IDs, attendee IDs, device IDs, email addresses, or person trajectories. A sensor integration that requires person-level identity is outside this contract and must not be smuggled through arbitrary JSON fields.

## Operational consequence

The important architectural separation is:

**device credential -> bounded aggregate observation -> source health -> multi-source consensus -> venue state -> recommendation -> control admission -> human authorization**

A valid device credential proves only that a registered source submitted a syntactically valid aggregate observation. It does not prove that the observation is correct, and it never grants physical-world action authority. Independent source health, consensus, model credibility, release pinning, and human control remain separate gates.
