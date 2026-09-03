# Community exchange

Beacon's community partnership layer is designed around a **network of networks**, not a centralized member directory.

A professional community should be able to bring Beacon into an event and create value for its members without handing Beacon a reusable roster, exposing its relationship graph to another community, or reducing its members to leads. The exchange rail therefore separates five kinds of authority:

1. **community identity** — a durable partner operator identity;
2. **event partnership** — a host invitation that the community owner must accept;
3. **member affiliation** — a participant verifies affiliation for one event with a partner-issued code;
4. **community exchange** — two community owners approve a bounded set of domains where their communities want to make complementary value easier to discover;
5. **participant exchange** — each participant independently opts into exchange and separately chooses whether their community badge can be shown.

No layer automatically grants the next one.

## Why this exists

Most community partnerships stop at co-marketing, logo placement, shared Slack channels, or manually curated introductions. Those can be valuable, but they do not create a reusable measurement loop.

Beacon can create a stronger partnership primitive:

**community A brings explicit needs + community B brings explicit supply + both appear in the same physical event + individual participants opt in + Beacon reveals only pairwise declared-fit intersections + real mutuals become cohort-gated evidence.**

That gives community operators something they usually cannot measure cleanly:

- whether a partner community actually created useful cross-community relationships;
- which explicit domains were represented in those relationships;
- whether the same partner creates value across repeat events;
- whether a partnership should be repeated, widened, narrowed, or stopped.

This is descriptive evidence, not causal proof that the partnership created every resulting relationship.

## Community partner identity

`community_partners` is intentionally small:

- owner;
- name;
- stable slug;
- description;
- active/paused state.

Beacon does not ingest a reusable community member list as part of community creation.

A community owner may be invited to many events over time. That is the durable B2B identity that lets Beacon accumulate owner-private partnership evidence without turning participant identity into a global community graph.

## Event partnership

An event host invites an existing community partner by slug and may attach up to six reviewed Beacon domains representing the intended purpose of the partnership.

The invitation remains inert until the community owner accepts it.

An active partnership permits the community owner to issue event-scoped verification codes. It does not enroll anyone automatically and does not reveal a roster to the event host.

## Event-scoped verification codes

A community owner can issue a bounded, expiring code for an active event partnership.

The plaintext code is returned once. Beacon stores only a SHA-256 digest.

A participant who is already an approved event participant can use the code to establish:

`event + participant + community`

The participant then controls two independent settings:

- **badge visibility** — private or visible in eligible community-bridge context;
- **exchange enabled** — whether the affiliation may participate in approved bilateral exchange.

An affiliation can remain verified while exchange is disabled.

This matters because **membership verification is not consent to be routed through a partnership**.

## Bilateral exchange agreement

The event host can propose an exchange between two active partner communities and choose one to six reviewed domains.

The database canonicalizes the community pair so A/B and B/A cannot become parallel agreements.

The exchange does not activate until **both community owners approve it**.

An active exchange means only:

> these two partner operators agreed that Beacon may use this event-scoped community relationship as additional context inside the chosen domains for participants who independently opt in.

It does not mean members of either community are exposed to the other community.

## Live community bridge

`get_live_community_bridges` is intentionally target-bounded.

The caller supplies at most 40 target IDs already present in the live application flow. For any returned bridge, the server rechecks:

- operational event;
- approved participation;
- target discoverability;
- fresh target position;
- bilateral block boundaries;
- caller exchange opt-in;
- target exchange opt-in;
- target badge visibility;
- active bilateral community exchange;
- current enabled declared intent for both participants;
- an actual pairwise declared-fit domain that is also inside the exchange's approved domain set.

Only then can Beacon return:

- caller community name;
- target community name;
- exchange identity;
- intersecting domains.

It does **not** return:

- community member counts;
- community rosters;
- graph degree;
- how many peers in the community could connect to the caller;
- hidden connector counts;
- another participant's complete declared intent;
- a public community quality score.

The bridge is therefore context for an already-real pairwise opportunity, not a discovery directory.

## Participant surface

The Event Lobby contains a Community Exchange preview when partner state exists.

The full Community Exchange screen lets participants:

- verify an affiliation with an event code;
- choose private or badge-visible affiliation;
- enable or disable cross-community exchange independently;
- inspect which partner communities are active;
- inspect active bilateral exchanges.

The same screen becomes an operator surface when the caller is a host or community owner.

## Host surface

The event host can:

- invite an existing community by slug;
- define partnership goals using the existing bounded event-focus vocabulary;
- propose a bilateral exchange between two active partners;
- define the domains the exchange is meant to support;
- inspect cohort-gated exchange evidence.

A host cannot create or approve a community owner's side of the bilateral agreement.

## Community owner surface

A community owner can:

- create a durable Beacon community identity;
- accept or decline event partnership invitations;
- issue event verification codes;
- approve or decline exchange proposals involving their community;
- inspect supported exchange evidence;
- inspect owner-private repeat-event portfolio evidence.

## Evidence release

`get_community_exchange_summary` releases operator evidence only when at least five participants in **each** community explicitly enabled exchange for the event.

When supported, the host and the two community owners can see:

- opted participant count for each side;
- cross-community mutual count;
- cross-community mutuals with captured declared fit;
- two-way declared-fit mutual count;
- declared-fit share among cross-community mutuals;
- two-way share among declared-fit mutuals.

They never receive the identities of the participants who produced those outcomes.

## Longitudinal community portfolio

A community owner can inspect owner-private evidence across ended Beacon events:

- number of ended partner events;
- number of distinct partner communities represented in supported exchanges;
- number of supported exchanges;
- cross-community mutuals;
- cross-community mutuals carrying declared fit;
- latest ended event represented.

This creates a compounding B2B asset:

**community joins one event → community learns which partnerships create supported outcomes → community repeats the strongest partnerships → Beacon becomes more useful as the community's event network grows.**

Historical evidence does not automatically activate a future exchange and does not grant authority to target a participant.

## Growth properties

The product-level leverage is that Beacon can grow through **partner edges**, not only individual signups.

One community can bring its members to one event. Two communities can create one approved exchange. Several events can establish repeat evidence. A later event can bring the same communities back or introduce a third partner.

The valuable state that compounds is not raw identity volume. It is:

- verified event partnerships;
- explicit participant opt-in;
- which community pairs repeatedly produce supported cross-community outcomes;
- which domains were represented in those outcomes;
- which partnerships do not justify repetition.

That can make Beacon useful to accelerators, alumni networks, founder groups, professional associations, technical communities, university programs, investor communities, creator communities, and other curated networks without requiring all of them to surrender their private member graphs.

## Credential interoperability seam

Community identity and event affiliation are deliberately separated from portable credential issuance.

Open Badges 3.0 provides an interoperable, cryptographically verifiable credential format in which an issuing organization can assert an achievement or participation record under the recipient's control. Beacon should not claim Open Badges compatibility until it implements the required credential, proof, issuer, status, and verification semantics.

The current community exchange tables create a clean future seam for a community to issue a portable credential after a separately defined criterion is actually met—for example, mentor contribution or program completion—without changing the exchange protocol into a badge factory.

## Invariants

- no reusable member roster is required to create a partner;
- no host-created affiliation for a participant;
- no automatic affiliation from email domain or profile text;
- no exchange without both community owners approving;
- no participant exchange without explicit event-scoped opt-in;
- no target community badge without target visibility opt-in;
- no community bridge without a real pairwise declared-fit intersection;
- no hidden graph-degree or popularity score;
- no community leaderboard;
- no cross-customer benchmark hidden inside the portfolio;
- no operator outcome release below the bilateral cohort threshold;
- no historical partnership evidence can authorize future participant targeting;
- no claim that a cross-community mutual proves partnership causality or business value.
