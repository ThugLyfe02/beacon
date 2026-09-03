# Outcome Handshake Protocol

Beacon should not stop at the moment two people become mutuals. A mutual proves reciprocal connection intent; it does not prove that either person knows what should happen next.

The Outcome Handshake Protocol converts a mutual into a **private next-step alignment pathway** without exposing one-sided intent.

It is important to distinguish this protocol from **Participant-Owned Outcome Receipts**. The handshake coordinates what both people would accept doing next. A receipt separately records what a participant deliberately attests actually happened.

## Core mechanism

Each participant privately chooses the next step they would genuinely accept. Beacon stores the choice independently and reveals nothing to the counterpart unless the two choices are compatible.

Examples:

- `raise_capital` + `invest` becomes a capital conversation pathway.
- `hire` + `explore_role` becomes a talent conversation pathway.
- `mentor` + `seek_mentorship` becomes a mentorship conversation pathway.
- `make_intro` + `request_intro` becomes an introduction exchange pathway.
- matching collaboration intents become a build-together pathway.

When alignment exists, Beacon creates a private actionable Vault entry for each participant.

Marking that alignment handled means the private coordination task is closed. It does **not** establish that a meeting occurred, a hire progressed, a deal closed, or another real-world result happened.

## Participant-Owned Outcome Receipts

Migration `061_participant_outcome_receipts.sql` introduces the explicit evidence layer that follows this protocol.

The distinction is:

**Outcome Handshake**

> What would both participants independently accept doing next?

**Participant-Owned Outcome Receipt**

> What bounded fact does each participant deliberately attest actually happened?

A completed handshake therefore remains useful product state, but it is not ground-truth outcome evidence.

Examples of receipt evidence include:

- spoke;
- contact details exchanged;
- follow-up sent;
- meeting scheduled;
- Office Hours occurred;
- mentor session occurred;
- partnership conversation continued;
- no further action.

Receipts can become stronger when both participants independently submit compatible or identical facts, while still remaining participant attestations rather than Beacon claiming independent verification of a commercial result.

## Why this is difficult to copy well

A superficial competitor can add a “next step” button. The defensible system is the surrounding chain:

1. The relationship must be an event-scoped mutual.
2. Each intent remains independently concealed.
3. Compatibility is evaluated by a typed protocol rather than keyword matching.
4. Submission is replay-protected through the security control plane.
5. Alignment creates private opportunity memory for both parties.
6. Participant-Owned Outcome Receipts separately capture explicit real-world attestation evidence.
7. Cohort-gated organizer evidence can learn from receipts without exposing pairs.
8. No one-sided intent or receipt becomes a public signal, organizer export, or reputation score.

This creates a controlled path from a relationship graph toward outcome evidence without turning private relationship state into surveillance telemetry.

## Privacy boundary

Clients may read their own intent only. The handshake table is not directly readable because it contains both sides. A security-definer read function returns counterpart intent only after the handshake is aligned or completed.

Organizers cannot see who selected an intent, which intent was selected, private notes, or which specific pair aligned.

The newer receipt layer is independently protected: raw receipt streams, revisions, and provenance links are RPC-only, while host/community output is cohort-gated and aggregate-only.

## Legacy metric interpretation

Migration `026_outcome_conversion_metrics.sql` introduced `mutual_to_outcome_rate` as:

> completed outcome handshakes / mutuals formed

That field predates Participant-Owned Outcome Receipts.

It should now be interpreted only as a **legacy private next-step alignment completion share**. It must not be presented as verified real-world conversion.

Migration 061 updates the database comment accordingly.

The more defensible outcome measures now come from explicit receipt composition, for example:

> share of supported mutuals carrying a current participant-owned outcome receipt

or:

> share of supported mutuals where both participants independently confirmed the same bounded fact

Even those are observational composition metrics unless a separate valid causal/funnel design establishes a stronger interpretation.

## Guardrails

- Intent windows expire.
- A strong idempotency nonce is required.
- Blocked relationships cannot use the protocol.
- Locked events fail closed through the security control plane.
- The counterpart’s intent is concealed until compatibility exists.
- Closing alignment updates only the acting user’s private Vault item.
- The protocol never sends messages, schedules meetings automatically, or exposes private demand.
- Handshake completion does not auto-create an Outcome Receipt.
- Participant-Owned Outcome Receipts remain a separate deliberate attestation action.
