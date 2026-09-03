# Warm introductions

## Product purpose

A direct connection signal is not always the right first move.

At a curated event, the strongest route between two people may be a third person who already knows both sides. That third participant can contribute context and trust that an anonymous recommendation cannot provide.

Beacon's warm-introduction protocol turns that real graph structure into a functional event workflow without publishing the graph itself.

The protocol is deliberately narrow:

1. the requester selects a participant who is currently inside the requester's live physical field;
2. the requester and target must share an explicit event-scoped declared fit;
3. Beacon looks for one participant who has a verified mutual with both sides;
4. that participant must have explicitly opted in to broker introductions during the event;
5. the connector decides whether to open the bridge;
6. only after connector acceptance does the target see the introduction;
7. the target makes the final decision;
8. acceptance opens ordinary Beacon actions but does not create a match automatically.

This is not a people-recommendation feed, an event-wide connector directory, or a public social-capital score.

## Why the connector is structurally different from a recommendation

Beacon already has declared fit, live physical proximity, connection signals, mutuals, Office Hours, and outcome handshakes.

Warm introductions add one missing relationship primitive:

**verified mutual edge A → connector + verified mutual edge connector → B**

The connector is not selected because Beacon predicts they are influential. The connector is eligible because two real mutual rows already exist and the participant explicitly agreed to take a bounded number of introduction requests.

No graph degree, popularity, premium status, profile-view count, movement pattern, or response behavior participates in connector selection.

Among equally loaded eligible connectors, Beacon uses a stable pair-derived ordering. The client never receives the candidate set.

## Consent sequence

### 1. Requester intent

The requester must choose one domain already present in the current pairwise declared-fit intersection.

There is no free-text pitch in the protocol. That prevents the introduction request from becoming an unsolicited messaging surface and keeps the server contract bounded and reviewable.

The requester can have at most three unresolved introductions and at most six introduction requests in one event.

### 2. Connector consent

The selected connector must:

- be an approved participant in the same operational event;
- be discoverable;
- have a fresh live location fix;
- have a verified mutual with the requester;
- have a verified mutual with the target;
- have no active block relationship with either side;
- have enabled warm introductions for this event;
- remain below their self-selected active-request limit.

The requester does not learn the connector's identity while the connector is deciding.

The connector sees the requester, the target, and the explicit pairwise reason. The connector can accept or decline. Beacon does not ask for or release a decline explanation.

### 3. Target consent

The target does not see the request while the connector is still deciding.

After connector acceptance, the target sees:

- the requester;
- the accepted connector;
- the explicit declared-fit domain;
- the fact that the connector already has a verified mutual with both sides.

The target can accept or decline. Declining closes the route without revealing a private reason or generating another prompt.

### 4. Open introduction

After target acceptance, Beacon creates private next-action entries for the requester and target.

The introduction inbox can then open the existing Beacon actions:

- send a normal connection signal;
- request Office Hours.

Both actions preserve their existing product rules. A warm introduction does not bypass the signal budget, mutual opt-in, Office Hours authorization, event lifecycle, block controls, or premium behavior already enforced by those paths.

### 5. Measured result

If the requester and target later become a real Beacon mutual, a server trigger marks the accepted introduction as `matched` and completes its associated next-action entries.

The trigger observes the real match boundary. It does not insert a match.

## State model

The durable request state is intentionally finite:

- `connector-pending`
- `target-pending`
- `accepted`
- `declined`
- `cancelled`
- `expired`
- `matched`

The protocol records separate timestamps for connector response, connector acceptance, target response, target acceptance, final acceptance, and a resulting mutual.

This gives the organizer real denominators without requiring participant-level analytics in the client.

## Live-field admission

A modified client must not be able to submit arbitrary event participant IDs.

Server admission therefore requires:

- requester and target approved in the event;
- target discoverable;
- requester and target coordinates present;
- both location fixes no older than 90 seconds;
- physical distance no greater than 45 feet;
- a current explicit pairwise fit.

The same boundary is applied to availability reads. An outside-field target is returned as unavailable without releasing fit or connector information.

The connector must also have a fresh live fix. The connector does not need to be inside the requester's 45-foot field because their role is to provide trusted routing across the event, but they must be actively present rather than an old historical graph edge.

## Privacy boundaries

### No connector directory

There is no RPC that returns eligible connectors to the requester.

The server selects one connector and initially returns only:

- request ID;
- state;
- declared-fit domain;
- expiry.

The requester's inbox keeps connector identity null during `connector-pending`.

### No event-wide graph read

Raw introduction preference and request rows are not client-readable.

All participant views are role-aware server projections. The target cannot see a request before connector acceptance. A requester cannot read candidate connectors. A connector sees only requests assigned to them.

### No private decline reason

The database records only whether the connector or target declined. It does not store a free-text reason.

### No public reputation layer

Beacon does not calculate or display:

- connector rank;
- connector acceptance score;
- number of people a participant can reach;
- graph centrality;
- public introduction success rate;
- popularity or influence.

Host evidence is cohort-gated and identity-free.

### Blocks remain bilateral

A block between any two members of the three-party path cancels or prevents the introduction.

Block checks occur during:

- availability;
- connector selection;
- request insertion;
- inbox projection;
- connector or target response.

## Capacity and anti-spam controls

Connector capacity is participant-owned. A connector selects an active limit between one and four.

Requester limits are server-enforced:

- no more than three unresolved introduction requests;
- no more than six total requests in the event;
- only one active introduction for a requester-target pair.

A target can have no more than six target-pending decisions at once.

Requests expire within 45 minutes or at event end, whichever is sooner. An accepted introduction can remain actionable for up to two hours, bounded by event time.

These are operational limits, not artificial scarcity or monetized access.

## Host evidence

Hosts receive no participant identities or raw three-party records.

The summary is released only after at least five requests and includes:

- total requests;
- connector accepts;
- target accepts;
- resulting mutuals;
- connector acceptance rate: connector accepts / requests;
- target acceptance rate: target accepts / connector accepts;
- match-after-acceptance rate: resulting mutuals / target accepts.

Domain rows require at least five requests in the domain.

Unlike an exposure-based recommendation funnel, these rates have actual persisted protocol denominators. They still do not establish causality or commercial value.

A connector acceptance is not an endorsement. A target acceptance is not proof of a successful relationship. A resulting mutual is not proof of a deal, hire, investment, or partnership.

## Compounding value

Warm introductions create a short-cycle network effect without requiring behavioral surveillance:

**explicit fit**
→ **live co-presence**
→ **verified two-edge connector path**
→ **connector consent**
→ **target consent**
→ **ordinary Beacon next action**
→ **real mutual**
→ **cohort-gated event evidence**

The participant benefit appears immediately when the graph has one valid bridge.

The organizer benefit appears after enough requests exist to reveal aggregate protocol performance.

The long-term advantage is not a hidden social graph. It is a growing body of privacy-preserving evidence about which event structures and declared domains repeatedly produce trusted, consented introductions.

## Failure behavior

- If no connector is available, the requester sees that no opted-in mutual connector is available right now.
- If a connector becomes stale or reaches capacity before insertion, the request fails rather than selecting an unsupported route.
- If the requester or target leaves the live field, insertion is rejected.
- If the event closes, pending requests expire.
- If any participant blocks another, the route is removed or cancelled.
- If the connector declines, the requester does not receive the private reason.
- If the target declines, the connector and requester see only that the introduction did not open.
- If a normal connection signal fails, the accepted introduction remains open and no match is fabricated.

## Required validation

### Database integration

Apply migrations 052–054 to a clean Supabase environment and exercise the protocol with three authenticated users plus a host.

Validate:

1. requester and target have explicit fit but no connector mutual path;
2. connector has only one of the required mutual edges;
3. connector has both edges but has not opted in;
4. connector opts in with capacity one;
5. requester and target are inside 45 feet with fresh fixes;
6. requester is outside the live field;
7. connector accepts;
8. target declines;
9. new request where target accepts;
10. accepted introduction followed by one-sided signal;
11. reciprocal signal creates a real match and marks the introduction matched;
12. block inserted at each protocol phase;
13. connector capacity reached concurrently;
14. duplicate requester-target request race;
15. event close while connector or target decision is pending;
16. host summary below and above the five-request threshold.

### Device validation

- selected-person card appears only for current declared-fit targets;
- availability failures never break the base avatar action sheet;
- connector identity remains hidden during requester waiting state;
- target receives no UI before connector acceptance;
- inbox refresh preserves the latest server state;
- accepted route opens the existing connection and Office Hours paths;
- reduced network quality does not optimistically invent state;
- app background/foreground refreshes before enabling a decision;
- block/report controls continue working around the new card.

## Architectural non-goals

This implementation is not:

- an AI matchmaking agent;
- a public professional graph;
- a connector marketplace;
- a referral bounty system;
- an endorsement score;
- a contact-import product;
- an automated messaging agent;
- a guarantee of outcome;
- a replacement for human judgment.

The system earns leverage by making one real, consented bridge actionable—not by exposing the network behind it.
