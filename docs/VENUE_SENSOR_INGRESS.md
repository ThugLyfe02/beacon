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

The public Edge endpoint accepts a compact camelCase envelope and maps it into the versioned database observation contract. Device ingress accepts only three aggregate observation kinds. Payload fields are allow-listed; additional fields are rejected rather than silently retained.

### Occupancy

```json
{
  "sourceId": "<source uuid>",
  "token": "bcn_<one-time provisioned secret>",
  "schemaVersion": "1.0",
  "layoutVersion": "<active release layout version>",
  "kind": "occupancy",
  "sequence": 1942,
  "observedAt": "2026-08-25T02:30:00Z",
  "confidence": 0.87,
  "payload": {
    "zoneId": "north-lounge",
    "occupancy": 47,
    "sampleSupport": 52
  }
}
```

### Transition

```json
{
  "sourceId": "<source uuid>",
  "token": "bcn_<secret>",
  "schemaVersion": "1.0",
  "layoutVersion": "<active release layout version>",
  "kind": "transition",
  "sequence": 1943,
  "observedAt": "2026-08-25T02:30:02Z",
  "confidence": 0.81,
  "payload": {
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
  "sourceId": "<source uuid>",
  "token": "bcn_<secret>",
  "schemaVersion": "1.0",
  "layoutVersion": "<active release layout version>",
  "kind": "service-point",
  "sequence": 1944,
  "observedAt": "2026-08-25T02:30:04Z",
  "confidence": 0.9,
  "payload": {
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

Production sensor adapters use the `venue-sensor-ingest` Edge Function over HTTPS. Deploy it with Supabase JWT verification disabled because the source-specific `bcn_...` token is the machine credential:

```bash
supabase functions deploy venue-sensor-ingest --no-verify-jwt
```

Then send aggregate observations to the function endpoint:

```bash
curl -X POST \
  "$SUPABASE_URL/functions/v1/venue-sensor-ingest" \
  -H "Content-Type: application/json" \
  --data @observation.json
```

The Edge Function uses the service role internally for exactly one ingestion RPC. External devices cannot call the lower-level database ingestion primitive directly. This keeps database error detail and privileged project credentials out of the device contract.

A successful request returns HTTP `202` with the accepted observation ID, server receive time, and sequence. The public response intentionally collapses internal failure detail into bounded classes such as `credential_rejected`, `rate_limited`, `sequence_conflict`, and `observation_rejected`.

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

## Live read path

Accepted observations do not become trusted venue truth just because the device credential was valid. The host/operator read path uses `get_recent_venue_sensor_observations`, which returns only:

- active sources;
- the current operational event;
- the current pinned release layout/schema;
- observations still inside the bounded raw retention window;
- a bounded recent time window and result limit.

`venue-sensor-feed.service.ts` reconstructs those rows into the same versioned `VenueObservation` union used by Beacon's existing observation buffer, sensor-health, and multi-source consensus layers. Malformed rows are dropped rather than coerced.

## Data minimization

`venue_sensor_observations` is a short-lived transport layer, not a permanent mobility database. Raw aggregate ingress receives a seven-day retention timestamp and a service-role cleanup function. Long-term value should come from bounded venue state, measured interventions, closeouts, and context-scoped venue memory rather than indefinite raw packet retention.

The device payload allow-list does not contain user IDs, attendee IDs, device IDs, email addresses, or person trajectories. A sensor integration that requires person-level identity is outside this contract and must not be smuggled through arbitrary JSON fields.

## Operational consequence

The important architectural separation is:

**device credential -> edge ingress -> bounded aggregate observation -> source health -> multi-source consensus -> venue state -> recommendation -> control admission -> human authorization**

A valid device credential proves only that a registered source submitted a syntactically valid aggregate observation. It does not prove that the observation is correct, and it never grants physical-world action authority. Independent source health, consensus, model credibility, release pinning, and human control remain separate gates.
