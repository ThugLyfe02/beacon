# Participant-Owned Outcome Receipts

A Beacon mutual is a reciprocal connection event. It is not evidence that the people spoke, scheduled time, exchanged details, continued a hiring conversation, or created any other real-world result.

Participant-Owned Outcome Receipts add a second, deliberately narrower evidence layer:

> Beacon records only the bounded fact a participant deliberately attests to. It does not inspect private communications to manufacture an outcome.

The protocol is designed to create useful real-world ground truth without becoming a relationship dossier.

## Receipt vocabulary

The initial receipt vocabulary is intentionally finite and reviewable:

- `spoke` — the participant attests that a real conversation happened;
- `contact_exchanged` — contact details were deliberately exchanged;
- `follow_up_sent` — the participant sent a follow-up;
- `meeting_scheduled` — a future meeting was scheduled;
- `office_hours_occurred` — the participant attests that the Office Hours conversation actually happened;
- `warm_introduction_completed` — an accepted warm introduction became an actual introduction;
- `hiring_conversation_continued` — an additional hiring / role conversation occurred;
- `partnership_conversation_continued` — an additional partnership conversation occurred;
- `mentor_session_occurred` — a mentorship or advisory session occurred;
- `collaboration_continued` — the relationship progressed into additional collaboration discussion or work;
- `feedback_received` — substantive feedback was received;
- `still_open` — the relationship is still open without a more specific recorded next step;
- `no_further_action` — the participant does not currently expect another step.

The system deliberately avoids generic claims such as `successful`, `high-value`, `converted`, or `deal`.

There is no free-text receipt note field. If free-form qualitative evidence is ever added, it should be treated as a separate privacy/compliance system rather than smuggled into the structured evidence contract.

## Evidence levels

### Participant-attested

One participant deliberately records a receipt.

Beacon may say:

> You recorded: Meeting scheduled.

It may not say:

> This meeting was verified by Beacon.

### Counterpart-compatible

Both participants independently submit semantically compatible receipt types under a small, deterministic compatibility map.

The initial non-identical compatibility pairs are intentionally conservative:

- `meeting_scheduled` ↔ `office_hours_occurred`;
- `mentor_session_occurred` ↔ `office_hours_occurred`;
- `spoke` ↔ `office_hours_occurred`;
- `partnership_conversation_continued` ↔ `collaboration_continued`.

Loosely related states such as `follow_up_sent` and `meeting_scheduled` are **not** silently declared compatible.

### Bilaterally-confirmed

Both participants independently submit the same receipt type.

Beacon may then say:

> Both participants independently confirmed this next step.

This still means two participant attestations. It does not mean Beacon independently verified the business fact or that the relationship was commercially successful.

## System-supported context

A submitted receipt snapshots relevant Beacon-native context that already exists. Current evidence classes include:

- verified mutual;
- declared-fit mutual;
- explicit local physical handshake;
- live-server physical handshake;
- completed Office Hours record;
- accepted warm introduction;
- shared focus-window opt-in;
- approved community-exchange context.

These facts strengthen provenance; they do not create the receipt.

For example:

- `office_hours_requests.status = completed` can become **system context**;
- only the participant can submit `office_hours_occurred` as their semantic receipt.

Similarly, a shared focus-window opt-in is not represented as proof that either participant physically attended the entire session.

## Origin context is descriptive, not causal

A receipt may say:

> This receipt followed a Beacon warm introduction.

or:

> This mutual carried explicit declared-fit context.

It must not say:

> The warm introduction caused the outcome.

When multiple contexts exist, Beacon chooses a deterministic primary context for explanation and privately records all qualifying provenance links so authorized aggregate evidence can later be scoped correctly.

## Append-only revision model

Every participant has at most one receipt stream per real mutual.

The stream is immutable identity. Changes are events:

`submitted revision 1`

→ `submitted revision 2` (supersedes revision 1)

→ `withdrawn revision 3` (supersedes revision 2)

Prior evidence is not edited in place. The current projection is the latest event in the participant's stream.

A withdrawal removes the previous receipt from current aggregate evidence while preserving the append-only historical sequence.

The database rejects in-place updates to streams, receipt events, and context links.

## Observation window

Receipts remain useful after an event closes because professional outcomes often happen later.

A participant may submit or revise a receipt for up to **60 days after the mutual was created**.

This is intentionally different from live-event authority. Event closure shuts down live discovery and physical operations; it does not imply that participant-owned follow-through has stopped.

An active bilateral block prevents new receipt submissions and hides counterpart alignment disclosure. A participant can still withdraw their own existing receipt.

## Anti-gaming semantics

Beacon does not claim to solve truth philosophically.

A unilateral record means:

> Participant attested.

Two compatible records mean:

> Both participants independently recorded compatible facts.

An exact bilateral record means:

> Both participants independently recorded the same fact.

That wording remains correct even if a malicious pair coordinates false attestations. The system does not upgrade those records into `verified deal`, `verified hire`, or another unsupported business claim.

Additional safeguards include:

- a real match is required;
- only a match party may write their own stream;
- strong client-generated idempotency keys;
- transaction-scoped database locking for revision ordering;
- duplicate same-type submissions collapse rather than generating artificial revision volume;
- bounded revision velocity and lifetime revision count;
- active blocks fail closed for new submissions;
- raw receipt rows are not host/community readable.

## Host evidence

Hosts consume purpose-built aggregate RPCs.

Receipt-specific counts remain withheld until at least five distinct mutuals carry a current participant receipt.

Supported host evidence includes:

- total supported mutuals;
- mutuals with at least one current participant receipt;
- mutuals with compatible independent receipts;
- mutuals with the same receipt independently confirmed by both sides;
- supported receipt-type composition;
- supported declared-domain composition.

Receipt-type and domain rows independently require at least five distinct mutuals before release.

The host never receives:

- a receipt pair;
- participant identity attached to a receipt;
- revision history;
- who withdrew;
- an incompatible counterpart's private receipt;
- message/calendar evidence.

### No fake funnel language

Beacon may say:

> 42% of supported mutuals currently carry a participant outcome receipt.

It should not automatically call that a `conversion rate`.

Migration `026_outcome_conversion_metrics.sql` predates participant-owned receipts. Its legacy `mutual_to_outcome_rate` reflects completion of Beacon's **private next-step intent handshake**, not independently attested real-world outcome evidence. Migration 061 explicitly updates the database comment to prevent that legacy field from being represented as verified real-world conversion.

## Community-exchange evidence

A community owner may inspect receipt composition only for an exchange they own (or the event host may inspect it).

Release requires:

1. at least five exchange-enabled participants in Community A;
2. at least five exchange-enabled participants in Community B;
3. at least five cross-community mutuals carrying current participant receipts linked to that exchange.

The aggregate can describe:

- supported cross-community mutuals;
- mutuals with a receipt;
- compatible bilateral evidence;
- exact bilateral confirmation;
- receipt share among the supported cross-community mutual denominator.

It cannot identify the members who produced those counts.

## Relationship deletion

Receipt streams cascade with the underlying match. If the underlying relationship record is removed through an authorized lifecycle path, the pair-level receipt evidence and its private provenance are removed with it rather than becoming an orphaned relationship dossier.

## Real-device / multi-user validation matrix

Before deployment validation, exercise the following against a clean Supabase environment with real authenticated identities:

1. A submits `meeting_scheduled`; B has no receipt → A sees participant-attested only.
2. B independently submits `meeting_scheduled` → both see bilaterally-confirmed.
3. A submits `meeting_scheduled`; B submits `office_hours_occurred` → both see counterpart-compatible.
4. A submits `follow_up_sent`; B submits `meeting_scheduled` → neither receives incompatible counterpart disclosure.
5. A changes a receipt → a new revision supersedes the old row; old row remains immutable.
6. A withdraws → withdrawal appends; the prior receipt no longer contributes to current aggregate evidence.
7. Retry an identical submit with the same idempotency key → one durable command outcome.
8. Submit the same current receipt type with a new idempotency key → no artificial duplicate revision.
9. Concurrent two-device revisions from the same account → database lock produces deterministic sequence ordering.
10. Create a bilateral block after a compatible receipt → counterpart alignment disclosure disappears and new submissions fail closed.
11. A withdraws while blocked → own withdrawal remains possible.
12. Event ends → existing match parties can still submit within the 60-day observation window.
13. Observation window passes → new submissions fail while current evidence remains readable to the participant.
14. Under five attested mutuals → host receipt counts remain suppressed.
15. At least five attested mutuals → host summary releases aggregate counts only.
16. A receipt type with fewer than five distinct mutuals → type row remains suppressed.
17. A declared domain with fewer than five attested mutuals → domain row remains suppressed.
18. Two community sides satisfy five-person exchange cohorts but fewer than five exchange-linked receipt mutuals → community receipt evidence remains suppressed.
19. Supported community receipt cohort → owners receive aggregate composition without pair identities.
20. Completed Office Hours exists but neither party submits an outcome receipt → no semantic receipt is created automatically.
21. Explicit physical handshake exists but neither party submits → no semantic receipt is created automatically.
22. Accepted warm introduction exists but neither party submits → no semantic receipt is created automatically.
23. Shared focus-window opt-in exists → it appears only as supporting context, not proof of attendance.
24. Delete the underlying match through an authorized lifecycle test → receipt stream/context rows cascade and no orphan is readable.
25. Verify UI copy never describes participant attestations as `verified deal`, `high-value`, `success score`, or causal conversion.

## Strategic role

Outcome Receipts let Beacon accumulate higher-signal evidence than clicks, profile views, message response times, or generic engagement metrics because the participant deliberately states what happened.

The compounding loop becomes:

**explicit event focus**

→ **physical relevance**

→ **verified mutual**

→ **optional Beacon-native context**

→ **participant-owned outcome receipt**

→ **compatible / bilateral evidence when independently confirmed**

→ **cohort-gated organizer/community learning**

→ **better future event structure without person-level reputation scoring**

The product aim is not to know everything about a relationship. It is to know a small number of useful facts at exactly the level participants were willing to attest.
