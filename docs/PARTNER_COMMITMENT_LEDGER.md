# Partner Commitment Ledger

Beacon's Community Exchange and Partner Program layers answer **who agreed to collaborate**. The Partner Commitment Ledger answers the harder operating question:

> What did each organization explicitly commit to contribute, what was delivered, what was actually used, and what supported outcomes followed?

The ledger is a bilateral operating contract, not a reputation system.

## Bounded commitment vocabulary

The initial reviewed vocabulary is:

- mentor slots;
- Office Hours slots;
- hiring conversations;
- technical review sessions;
- founder seats;
- investor / advisor sessions;
- workshops;
- Focus Windows;
- speaker / session contribution;
- facilitator hours;
- community member capacity;
- domain-specific support capacity.

Each event commitment records the committed party, resource type, optional Beacon event-focus domain, committed quantity, explicit observation window, lifecycle, delivered quantity, utilized quantity, measurement state and evidence quality.

The vocabulary is intentionally bounded. New resource semantics should be added through a reviewed schema change rather than hidden inside arbitrary text.

## Two scopes

### Reusable Partner Program template

An active Partner Program can hold accepted commitment templates. These are reusable configuration only.

A template has no delivery measurement because no event has occurred yet. Both community owners must accept the template before it is considered an accepted program pattern.

### Event-specific Community Exchange

An active Community Exchange can hold binding event commitments. When an exchange came from a reusable Partner Program, accepted templates may be **prefilled** into the event ledger.

Prefill deliberately creates **proposed** event commitments. Every required party must accept again for the current event. Historical configuration never carries contractual authority forward.

## Who can commit whom

Beacon does not let a host fabricate a partner obligation.

- Community A may propose only Community A's commitment.
- Community B may propose only Community B's commitment.
- The event host may propose only an event-host commitment.

A community commitment requires acceptance from both community owners.

An event-host commitment requires acceptance from Community A, Community B and the event host.

This means one organization cannot silently create a contractual-looking row on behalf of another.

## Immutable revisions

Accepted quantities are never edited in place.

A change creates a new immutable revision that supersedes the prior revision. Required acceptance resets on the new revision. Earlier revisions, decisions, lifecycle events and measurement snapshots remain historical evidence.

The mobile client has no direct raw-table access. Writes use scoped RPCs with strong idempotency keys.

## Lifecycle

Event commitments can progress through:

`proposed -> accepted -> scheduled -> delivering -> fulfilled`

or finish as:

- `partially_fulfilled`;
- `cancelled`;
- `not_fulfilled`.

A required party can also reject a proposed revision.

Time passing does **not** mark a commitment fulfilled.

For server-supported resource types, Beacon can advance to fulfilled or partially fulfilled only when server-recorded delivery itself supports the quantity after the observation window closes. Zero delivery is never silently converted into `not_fulfilled`; the committed party must explicitly acknowledge that final state.

## Delivered vs utilized

Beacon keeps these concepts separate.

Example:

- 8 mentor slots promised;
- 8 made available;
- 6 used;
- 2 unused.

That is more useful than a synthetic fairness score.

Beacon never performs arithmetic such as:

> 8 mentor slots > 4 founder sessions, therefore Community A contributed more.

Different resources have different semantics. The ledger compares quantities only inside the same resource type and domain.

## Native evidence

The first production evidence adapters are deliberately conservative.

### Office Hours

For an `office_hours_slots` commitment made by a community, a completed Office Hours request counts only when the committed community can be attributed as the recipient/provider and the other participant belongs to the counterpart community.

Completed Office Hours are server-recorded utilization. If a community made more slots available than were completed, availability may be manually acknowledged and remains labelled manual evidence.

### Focus Windows

For a `focus_windows` commitment, Beacon counts only non-cancelled windows created by the committed actor and contained in the commitment observation window. A window is utilized when at least one participant explicitly opted in.

Beacon does not expose the opt-in roster through the commitment ledger.

### Community member capacity

For `community_member_capacity`, Beacon can count approved event participants who explicitly verified the committed community affiliation as utilization. That does not prove how much capacity was made available, so delivered capacity remains separate.

### Warm introductions

Warm-introduction result evidence is attributable to a community only when a verified member of that community acted as the connector in the exchange context.

Exact counts are withheld below the cohort boundary.

### Participant Outcome Receipts

Outcome Receipts are result evidence, not fulfillment evidence.

The ledger may show supported bilateral receipt counts only when:

- the receipts are current participant attestations;
- both sides independently confirmed the same bounded receipt type;
- the receipt is linked to the current Community Exchange context;
- the applicable commitment domain matches when a domain exists;
- at least five distinct mutuals support the released count.

A supported receipt count never means the commitment caused the outcome.

## Manual acknowledgement

Some contributions do not yet have an exact Beacon-native operational object: speaker sessions, workshops, facilitator hours and certain review-session capacities are examples.

The committed party or event host may record delivered and utilized quantities manually. The measurement is labelled `MANUAL OPERATOR` and does not become hidden server verification.

If server evidence and manual acknowledgement both exist, the ledger labels the result `MIXED EVIDENCE`.

## Event closeout

When an event receives its durable `ended_at` closeout, Beacon snapshots which current commitment revisions belonged to that event. This gives later measurement an explicit closeout provenance point.

Closeout does not mark outstanding commitments fulfilled or not fulfilled.

If an event is operationally cancelled, commitments can be cancelled explicitly. Historical contract rows remain append-only.

## Bilateral visibility

Raw commitment tables are not client-readable.

Purpose-built projections are available only to:

- the owner of Community A;
- the owner of Community B;
- the event host for event-exchange scope.

Unrelated communities cannot enumerate the ledger. No participant-level evidence pair is returned.

## Longitudinal institutional memory

For a reusable Partner Program, Beacon can summarize ended events by the same:

- committed party;
- commitment type;
- domain.

Within that semantic group Beacon can show:

- number of ended events;
- number of commitment occurrences;
- average promised quantity;
- average delivered quantity;
- average utilized quantity;
- number of events with actual utilization;
- latest observed event.

A historical starting quantity appears only after at least two ended events. The suggested quantity is a median starting point, not a score, benchmark or future obligation.

Every future event still requires a newly proposed or prefilled commitment and fresh acceptance.

## Abuse and failure handling

The control plane specifically addresses:

- **commitment without counterparty approval** — required-party acceptance is server enforced;
- **host fabricating a partner commitment** — a caller may propose only the party it owns;
- **quantity edited after acceptance** — revisions are immutable and superseding;
- **historical record rewritten** — decisions, lifecycle events and measurements are append-only;
- **partner withdrawal** — a withdrawal is another decision event and can cancel a not-yet-delivering commitment;
- **partial fulfillment** — represented explicitly from measured quantities;
- **resource delivered but unused** — delivered and utilized quantities remain separate;
- **duplicate activity evidence** — native source references are deduplicated per commitment revision;
- **duplicate client submission** — strong idempotency keys are enforced server-side;
- **small participant evidence** — Outcome Receipt and warm-introduction result counts remain suppressed below cohort support;
- **social shaming** — there is no public leaderboard, fairness rank, monetary conversion or cross-resource contribution score.

## Contract-integrity layer

### Accepted terms remain effective during amendment review

Creating a revision does not silently replace an accepted obligation. If an 8-slot commitment is accepted and one party proposes 12 slots, the shared ledger continues to show 8 as the effective contract while the 12-slot amendment waits for fresh required acceptance. A rejected or withdrawn amendment therefore cannot erase the prior operating agreement.

### Manual evidence is reviewable, not self-verifying

A community can manually assert delivery only for its own commitment; the host cannot author that community's delivery quantity. Host commitments are similarly authored by the host. The other required parties can independently acknowledge or dispute the underlying manual assertion. Pending or disputed manual evidence may remain visible for audit, but it cannot finalize fulfilled / partially fulfilled / not fulfilled state.

This is deliberately different from asking Beacon to decide who is telling the truth. Beacon records who asserted the quantity and whether the other contractual parties acknowledged or disputed it.

### No double-claiming indistinguishable obligations

Two accepted commitments from the same party with the same resource type, same domain and overlapping delivery window are rejected as operationally ambiguous. The party must revise the existing obligation or use a genuinely distinct time/domain contract. This prevents one Office Hours session or Focus Window from being presented as fulfillment of two indistinguishable promises.

### Evidence semantics must match the source

A server event may support only the semantics it actually records. For example, current Office Hours rows do not carry a reviewed domain field. Beacon therefore refuses to auto-verify a domain-specific Office Hours commitment from generic completed Office Hours traffic; the contribution needs stronger provenance or an explicit manual assertion subject to counterpart review.

### Longitudinal memory carries measurement coverage

Historical delivery and utilization averages exclude events with missing, insufficient, disputed or still-pending manual evidence. The memory surface reports how many ended events actually had admissible measurement and the corresponding coverage share. Unknown evidence is never coerced to zero use.

This allows Beacon to say that a commitment pattern was repeatedly unused only when it was repeatedly **measured** as delivered but unused.

### Delete-path hardening

Core revisions, decisions, lifecycle events, measurements, source links, closeout rows and manual-review events reject both in-place updates and deletes at the database boundary. The normal product lifecycle is supersession and explicit terminal events, not history rewriting. Any future compliance erasure path deserves a separate, auditable system rather than a generic mutation endpoint.

## Product language

Good:

> 8 mentor slots promised · 8 delivered · 6 used.

> 20 founder places promised · 20 delivered · 14 used.

> 7 supported bilateral next-step receipts followed this exchange context.

Bad:

> Community A won the partnership.

> Community B contributed 42% less value.

> This program converted 7 deals.

The Partner Commitment Ledger exists to make institutional operating agreements inspectable, not to manufacture reputation or causal certainty.
