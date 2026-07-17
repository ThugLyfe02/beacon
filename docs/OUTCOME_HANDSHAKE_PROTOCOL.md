# Outcome Handshake Protocol

Beacon should not measure success at the moment two people become mutuals. A mutual proves reciprocal curiosity; it does not prove that either person knows what should happen next.

The Outcome Handshake Protocol converts a mutual into a permissioned real-world pathway without exposing one-sided intent.

## Core mechanism

Each participant privately chooses the next step they would genuinely accept. Beacon stores the choice independently and reveals nothing to the counterpart unless the two choices are compatible.

Examples:

- `raise_capital` + `invest` becomes a capital conversation.
- `hire` + `explore_role` becomes a talent conversation.
- `mentor` + `seek_mentorship` becomes a mentorship conversation.
- `make_intro` + `request_intro` becomes an introduction exchange.
- matching collaboration intents become a build-together pathway.

When alignment exists, Beacon creates a private actionable Vault entry for each participant. The parties can later confirm that the real-world next step occurred.

## Why this is difficult to copy well

A superficial competitor can add a “next step” button. The defensible system is the surrounding chain:

1. The relationship must be an event-scoped mutual.
2. Each intent remains independently concealed.
3. Compatibility is evaluated by a typed protocol rather than keyword matching.
4. Submission is replay-protected through the security control plane.
5. Alignment creates private opportunity memory for both parties.
6. Completion feeds a privacy-safe mutual-to-outcome metric for organizers.
7. No one-sided intent becomes a public signal, organizer export, or reputation score.

This creates an outcome graph rather than another contact graph.

## Privacy boundary

Clients may read their own intent only. The handshake table is not directly readable because it contains both sides. A security-definer read function returns counterpart intent only after the handshake is aligned or completed.

Organizers receive aggregate conversion counts only. They cannot see who selected an intent, which intent was selected, private notes, or which specific pair aligned.

## Product metric

The strongest metric introduced by this protocol is `mutual_to_outcome_rate`:

> completed outcome handshakes / mutuals formed

It measures whether Beacon created useful professional movement rather than digital activity.

## Guardrails

- Intent windows expire.
- A strong idempotency nonce is required.
- Blocked relationships cannot use the protocol.
- Locked events fail closed through the security control plane.
- The counterpart’s intent is concealed until compatibility exists.
- Completion updates only the acting user’s private Vault item.
- The protocol never sends messages, schedules meetings automatically, or exposes private demand.
