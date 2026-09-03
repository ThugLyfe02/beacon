# Partner Commitment Governance

This document covers the governance layer that sits above Beacon's Partner Commitment Ledger.

The ledger already answers what each party promised, what was delivered, what was utilized, what evidence supports those quantities, and how reusable Partner Program history accumulates. The governance layer addresses a different class of failure: **what happens when the contract is technically present but operationally ambiguous, when accepted terms change, when late evidence arrives after an event, or when the two communities disagree about the closeout record?**

The design deliberately avoids partner scoring, public rankings, monetary normalization, or claims that Beacon is a legal-contract platform. It is an auditable operating-evidence system.

## 1. Accepted-contract seals

Every accepted immutable commitment revision receives a SHA-256 server-side seal. The canonical payload binds:

- scope identity;
- Partner Program / event / exchange identity where applicable;
- both community identities;
- event-host identity for event scope;
- commitment and revision identity;
- committed party;
- resource type and optional domain;
- committed quantity;
- delivery window;
- required roles;
- the identities of the actors who produced the current accepted decisions;
- the previous accepted seal in the same obligation's revision chain.

The resulting seal is useful for detecting accidental or malicious mutation/missing accepted history inside Beacon.

It is **not**:

- an external digital signature;
- blockchain notarization;
- legal enforceability;
- proof that delivery happened;
- proof that the participants or organizations were truthful.

`verify_partner_commitment_scope_integrity` recomputes the accepted-revision chains and returns an aggregate scope fingerprint. This is an internal integrity primitive, not a social trust score.

## 2. Execution preflight

A shared B2B plan should fail loudly before the event, not three months later.

`get_partner_commitment_execution_preflight` returns deterministic issue codes rather than a numerical risk score. Current checks include:

- **acceptance-pending** — no accepted operating revision exists;
- **amendment-pending** — an accepted obligation remains effective while a newer amendment awaits fresh approval;
- **schedule-not-declared** — a session-like accepted obligation has not entered scheduled state;
- **manual-measurement-route** — Beacon has no native delivery adapter for the exact resource/domain contract, so the partners should plan an explicit manual assertion + review;
- **manual-evidence-pending** — manual evidence still needs required counterparty review;
- **manual-evidence-disputed** — at least one required counterparty disputed the manual assertion;
- **window-closed-without-measurement** — an obligation reached the end of its delivery window without a measurement snapshot.

The preflight is intentionally explainable. It does not predict whether a community will “perform well.”

### Native evidence adapters

Today Beacon can directly support fulfillment measurement for a narrow set of semantics:

- general Office Hours slots, because completed Office Hours are server-recorded;
- Focus Windows, because the host/community creator and window state are server-recorded;
- community member capacity usage, because verified event affiliation exists.

Other resource types remain manual-measurement routes unless/until Beacon has a semantically valid source of delivery evidence. The system should prefer an explicit lower-authority measurement over pretending unrelated telemetry proves delivery.

## 3. Immutable closeout snapshots

An ended event is not the same thing as a final evidence record.

Participant Outcome Receipts can mature after the room closes. Manual evidence can be reviewed later. Server-side evidence can be refreshed. If Beacon simply recomputed historical partnership metrics forever, a report that two communities reviewed on Monday could silently mean something different on Friday.

The governance layer therefore captures a structured, immutable point-in-time payload for every event-scoped commitment ledger. The snapshot includes each current obligation's:

- effective and pending revision identity;
- acceptance state;
- lifecycle status;
- accepted-contract seal;
- committed quantity/window;
- latest delivered and utilized quantities;
- measurement/evidence quality;
- evidence sources;
- supported bilateral Outcome Receipt count where cohort-gated;
- supported warm-introduction count where cohort-gated;
- manual-evidence review state.

The canonical JSON payload is hashed with the scope identity, snapshot version, and event end timestamp.

The event close trigger captures the first snapshot automatically. If later supported evidence changes the live ledger, the original snapshot remains immutable and its settlement state becomes `stale`. The partners capture a new version instead of rewriting the old one.

This is the core rule:

> **Late evidence can mature history. It cannot silently rewrite history.**

## 4. Bilateral evidence settlement

Only the two community owners settle a closeout. The event host can inspect event-scoped evidence but cannot manufacture bilateral partner agreement.

Each community independently records one of:

- `acknowledged`
- `disputed`

The derived state is:

- `pending` — at least one community has not acknowledged the current snapshot;
- `settled` — both communities acknowledged the exact same current snapshot;
- `disputed` — a community explicitly disputes the current snapshot;
- `stale` — the underlying evidence payload changed after the snapshot was captured.

“Settled” has intentionally narrow meaning:

> both community owners reviewed and acknowledged the same Beacon evidence snapshot.

It does **not** mean:

- the partnership was fair;
- one side was better than the other;
- a commitment caused a participant outcome;
- a commercial deal occurred;
- Beacon externally verified every real-world fact.

## 5. Reusable Partner Program evidence maturity

Partner Programs already preserve reusable bilateral configuration. Governance distinguishes that configuration memory from reviewed historical evidence.

For each Partner Program, Beacon can report the number of ended event scopes whose latest closeout is:

- settled;
- pending;
- disputed;
- stale.

This matters because a frequently reused template is not necessarily a well-supported operating pattern. A future recommendation layer should give more authority to repeated, measured, **settled** evidence while keeping pending/disputed/stale events visible as uncertainty.

No current governance function automatically creates a future commitment or bypasses fresh event acceptance.

## 6. Why this matters strategically

The practical B2B question is no longer only:

> “What did the partner promise?”

Beacon can support a stronger sequence:

**proposal**
→ **fresh bilateral acceptance**
→ **tamper-evident accepted revision**
→ **execution preflight**
→ **delivery / utilization evidence**
→ **manual counterparty review where needed**
→ **immutable event closeout snapshot**
→ **bilateral evidence settlement**
→ **repeat-program evidence maturity**

That creates an institutional memory that is substantially harder to reproduce with spreadsheets, event CRMs, or informal community partnership notes because the historical record carries explicit provenance, acceptance state, measurement quality, and evidence-review state.

## 7. Validation matrix

The repository validator should cover at least:

1. accepted revision receives a seal;
2. pending amendment does not alter prior accepted seal;
3. newly accepted amendment chains to the prior seal;
4. mutated canonical terms fail verification;
5. missing accepted seal fails scope integrity;
6. preflight emits acceptance-pending for a new proposal;
7. preflight emits amendment-pending while prior terms remain effective;
8. session-like accepted obligation emits schedule-not-declared;
9. unsupported native resource emits manual-measurement-route instead of fake server evidence;
10. disputed manual evidence is blocking preflight state;
11. event end captures the initial closeout snapshot;
12. capturing an unchanged snapshot is idempotent;
13. a changed evidence payload makes prior snapshot stale;
14. only a new snapshot version can receive current settlement decisions;
15. host cannot settle on behalf of either community;
16. one community acknowledgement remains pending;
17. two acknowledgements settle the current snapshot;
18. either community can explicitly dispute;
19. stale snapshot cannot be newly settled;
20. repeat-program summary separates settled, pending, disputed, and stale history;
21. raw governance tables remain RPC-only;
22. no numerical partner/fairness/reputation score exists;
23. no external-signature/notarization claim is made;
24. no closeout state claims causality or commercial success.

## 8. Deployment boundary

These functions remain database-sensitive. Repository validators can enforce architecture and TypeScript integration, but real deployment validation still requires applying the migrations to a clean Supabase environment and exercising:

- two distinct community owners;
- a host who is not a community owner;
- owner/host overlap cases;
- accepted and pending revisions;
- manual measurement disputes;
- event closeout;
- late Outcome Receipt evidence followed by measurement refresh;
- snapshot staleness and recapture;
- concurrent settlement decisions;
- unauthorized community/participant access.
