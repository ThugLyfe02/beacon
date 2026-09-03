# Private Participant Event Playbook

## Purpose

Beacon already has durable host memory for venue operations. The participant side needed a different kind of longitudinal memory: a way to carry forward what a person's own ended events actually supported without turning the product into behavioral profiling.

The Private Participant Event Playbook sits inside the current event-focus editor. It answers a narrow question:

> Which domains from my own previous events have enough explicit and outcome-backed history to deserve consideration in this event?

It is a draft aid, not an autonomous recommender. The participant must choose whether to apply a suggestion and must still save the current event focus explicitly.

## Source evidence

The playbook uses only server-owned evidence connected to the authenticated participant:

1. explicit `looking for help` and `can help` declarations from ended events;
2. real mutual matches involving the caller;
3. server-captured declared-fit domains attached to those mutuals;
4. private outcome-handshake alignment and participant-confirmed completion;
5. the latest declaration or outcome timestamp for a mild recency tie-breaker.

It does not use:

- movement or trajectory history;
- dwell time;
- profile views;
- taps, scrolling, or browsing behavior;
- message contents;
- response speed;
- social popularity;
- premium status;
- another participant's full declaration;
- host-created labels or lead scores.

## Server projection

`get_my_event_playbook(current_event_id)` is the only client-facing history boundary.

The RPC requires:

- an authenticated caller;
- approved participation in the current event;
- a current event that is still operational.

Historical evidence is limited to ended events where the caller was an approved participant. The RPC returns one row per supported intent domain with bounded counts only:

- seeking event count;
- offering event count;
- total declared event count;
- captured mutual count;
- two-way declared-fit mutual count;
- aligned outcome count;
- completed outcome count;
- latest declaration time;
- latest outcome time.

No counterpart identifiers leave the database. Matches involving an active bilateral block are excluded.

## Deterministic interpretation

`ParticipantEventPlaybook` converts those rows into a bounded suggestion list.

### Suggested mode

- `seeking`: the caller historically carried the domain primarily as a need;
- `offering`: the caller historically carried it primarily as a capability;
- `both`: the caller repeatedly carried both sides and neither side dominates enough to justify collapsing the posture.

### Evidence tiers

- `building`: declaration history exists, but outcome support is not yet strong enough to apply automatically to the draft;
- `supported`: at least two ended events plus a captured mutual or aligned outcome;
- `established`: at least three ended events, at least three captured mutuals, and repeated alignment or participant-confirmed completion.

The tiers describe evidence depth, not predicted success.

### Evidence coverage

The client computes a bounded ordering score from:

- declaration depth;
- mutual depth;
- share of captured mutuals that were two-way declared fits;
- aligned outcome depth;
- completed outcome depth;
- a small recency contribution.

The UI labels this value **evidence coverage**, never probability, fit quality, or expected conversion.

## Participant control

A playbook item can add a domain only to the unsaved local draft.

It cannot:

- remove or replace an existing current-event selection;
- exceed the six-domain limit on either side;
- enable declared fit when the participant turned it off;
- save the event focus;
- publish the evidence to another participant;
- grant a host access to private history.

A `building` item remains visible for transparency but cannot be applied from the playbook card. The participant can still select the domain manually.

## Historical limits

The playbook does not invent or backfill outcome context for events that predate the declared-fit capture boundary. Missing historical context remains missing.

A completed outcome means only that Beacon's existing outcome-handshake record reached its participant-confirmed completed state. It does not prove a deal, hire, investment, partnership, or relationship succeeded.

Aligned and completed counts are observational records. They are not causal proof that selecting a domain created the outcome.

## Strategic value

This closes a participant-side compounding loop:

**explicit event focus**
→ **live physical relevance**
→ **real mutual**
→ **private outcome alignment**
→ **ended-event evidence**
→ **better prepared next event**

The loop can become useful after only a few events because it does not require a black-box model or a large behavioral dataset. Its defensibility comes from verified event-scoped outcomes and explicit participant control rather than surveillance volume.

## Validation matrix

The dedicated architecture check verifies that:

- the RPC is caller-private;
- current approved participation is required;
- only ended historical events contribute;
- blocked counterpart matches are excluded;
- the client never reads historical intent, match-context, or outcome tables directly;
- counterpart identities are absent from the return contract;
- no behavioral or premium input enters the engine;
- ranking is deterministic;
- evidence tiers are explicit;
- the UI calls the score evidence coverage rather than probability;
- playbook application changes only the local draft;
- existing selections are never silently evicted;
- the participant still performs the final save.

## Physical-device review

Before treating the experience as product-complete, validate:

1. a new participant with no ended-event history sees no empty playbook shell;
2. one historical declaration appears as `building` and cannot auto-apply;
3. supported and established rows can add the correct side of the current draft;
4. `both` respects capacity on both arrays atomically;
5. a full six-item side blocks application without displacing another choice;
6. disabled declared fit stays disabled after applying a draft suggestion;
7. saving persists only the participant-approved current selections;
8. hosts cannot retrieve another participant's playbook through the RPC;
9. active bilateral blocks remove the relevant historical mutual evidence;
10. events without captured declared-fit context are not silently reconstructed.
