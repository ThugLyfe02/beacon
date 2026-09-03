# Offline event continuity and explicit physical handshakes

Beacon is designed for physical events, which means unreliable connectivity is a normal operating condition rather than an exceptional one. Convention centers, university buildings, conferences, community gatherings, accelerator demo days, campuses, and dense venues routinely produce saturated Wi-Fi, overloaded cellular radios, app backgrounding, and intermittent backend reachability.

The offline handshake protocol keeps one narrow, high-value participant action useful through that failure mode:

> Two authenticated event participants intentionally confirm that they met under the same short-lived event capability, then allow Beacon to verify that bilateral confirmation when connectivity returns.

It is intentionally **not** passive encounter logging.

## Product invariant

**Explicit action > passive inference.**

Beacon does not create a physical-interaction record because:

- two phones were near each other;
- BLE advertisements were observed;
- GPS points overlapped;
- a camera saw two people;
- a participant remained in the same zone;
- one person scanned a screenshot without completing the two-device acknowledgement path.

Both participants must act.

## Why the protocol is two-step

A one-way QR scan is insufficient. A QR can be screenshotted or forwarded.

Beacon therefore uses a short-lived offer plus a responder-generated acknowledgement:

1. Participant A obtains a pool of short-lived, server-minted capabilities while connectivity is available.
2. A explicitly chooses **Confirm & show my code**.
3. A presents an opaque QR or one-time manual code. The transport contains no reusable participant identifier.
4. Participant B scans or enters the offer.
5. B explicitly taps **I confirm this meeting**.
6. B's device generates a random acknowledgement nonce and stores a minimal pending record locally.
7. B displays the acknowledgement back to A by QR or manual code.
8. A scans or enters that acknowledgement and stores its own pending confirmation.
9. Either device may reconnect first and upload its side.
10. The server verifies the meeting only after both authenticated sides reconcile the same acknowledgement nonce under the same capability.

This is stronger than a single QR scan while remaining honest about its limitations.

## What a verified handshake means

`server-live-handshake`

Both sides reached Beacon during the short-lived capability window and reconciled the same acknowledgement while the event remained operational.

`explicit-local-handshake`

Both sides later reconciled the same explicit acknowledgement under the short-lived event capability, but at least one side arrived after the live capability window or after event closure within the bounded reconciliation grace period.

Neither class is cryptographic distance-bounding.

Beacon should describe the evidence precisely:

> Both participants explicitly confirmed on-device and Beacon reconciled the same one-time event handshake.

It should not claim:

> Beacon cryptographically proved the two bodies were physically within N centimeters.

Consumer phones and this protocol do not provide that guarantee.

## Capability model

Capabilities are minted by `prepare_event_handshake_capabilities` only for the authenticated caller when:

- the event is operational;
- the caller is an approved participant.

The default pool contains overlapping short windows. Each individual capability is valid for at most twenty minutes. Eight capabilities cover roughly ninety minutes, and the client opportunistically refreshes the pool whenever connectivity returns.

A capability contains server state for:

- event;
- initiating authenticated participant;
- protocol version;
- digest of the QR offer token;
- digest of the manual fallback code;
- validity window;
- reconciliation deadline;
- lifecycle state.

Only digests are stored server-side. Plaintext offer material is returned once to the participant and cached in device-secure storage where supported.

The QR contains:

- protocol marker/version;
- event ID;
- opaque capability ID;
- short-lived random offer token;
- expiry hint.

It deliberately does **not** contain:

- participant ID;
- email;
- profile URL;
- reusable member identifier;
- long-lived authorization credential.

The server resolves the capability back to its initiator during reconciliation.

## Manual fallback

Camera access is not required.

The server also returns a high-entropy one-time manual offer code. B may type this code instead of scanning.

After B confirms, B's device creates a random acknowledgement nonce that can also be displayed as a grouped manual code. A may type that acknowledgement rather than scan the response QR.

The manual path uses the same server capability and same reconciliation contract as QR.

It is not a lower-trust parallel state machine.

## NFC and Bluetooth

`HandshakeTransport.ts` defines QR, manual, NFC, and BLE as transport classes under one trust contract.

QR and manual are implemented in this PR.

NFC and BLE are deliberately reserved as future native adapters. When implemented they must transfer the same offer/ack envelopes after explicit user action.

They may not establish evidence through passive detection.

In particular:

> BLE is transport, not consent.

Beacon must never build a background encounter dossier merely because Bluetooth radios detected each other.

## Local persistence

Mobile devices store each capability and pending confirmation as an individually scoped record through `expo-secure-store`, using device-only keychain accessibility where available.

An event index contains only bounded local record identifiers. One-time material is not placed in general analytics storage.

Records are bound to the authenticated Beacon user. If another account opens the same event on the same device, the previous account's event-scoped handshake material is purged rather than inherited.

On platforms where secure durable storage is not available, Beacon falls back to volatile process memory and tells the user that offline continuity is not durable on that platform.

After server verification, local one-time offer and acknowledgement material is deleted.

## Reconciliation semantics

Reconciliation is server-authoritative and idempotent.

Either side may arrive first.

For each capability, the database allows at most one initiator confirmation and one responder confirmation.

The capability row is protected with a transaction-scoped advisory lock during reconciliation/finalization.

The finalizer requires:

- capability identity and offer digest match;
- matching acknowledgement digest from both roles;
- initiator confirmation belongs to the participant for whom the capability was minted;
- responder is a different participant;
- both participants remain approved for the event;
- no active block or pairwise abuse-report safety hold exists at reconciliation;
- reconciliation occurs before the bounded grace deadline;
- both bounded client time claims describe approximately the capability window and approximately the same interaction.

Client timestamps are never treated as authoritative clocks. They exist only to reject obviously stale or mutated offline records. Device clock manipulation therefore cannot upgrade an evidence class or bypass current authorization/safety checks.

## Replay and conflict behavior

A repeated upload from the same authenticated participant with the same acknowledgement is idempotent.

A second responder or different acknowledgement against a capability is treated as replay/conflict evidence and does not replace the first accepted confirmation.

Once a capability is server-verified, a later request cannot mutate the immutable verification.

The initiator may cancel an unverified capability. Cancellation becomes terminal.

## Event closure

A short-lived capability must have been minted while the event was operational.

If the event closes before a locally confirmed handshake reaches the server, Beacon permits reconciliation for a bounded post-event grace period of at most six hours.

The finalizer still checks:

- participant approval;
- block state;
- abuse-report safety hold;
- capability identity;
- matching bilateral acknowledgement.

The grace period exists to tolerate connectivity loss, not to extend the live event indefinitely.

## Safety behavior

Current safety state wins over historical local intent.

If either participant blocks the other before reconciliation, verification fails closed.

If either participant has filed a pairwise abuse report relevant to the event before reconciliation, the handshake is placed behind a safety hold and cannot verify.

If either participant is no longer approved for the event, verification fails closed.

A locally saved handshake is therefore not an irrevocable capability to force a relationship into Beacon later.

## Relationship semantics

A physical handshake does **not** automatically:

- send a connection request;
- create a mutual match;
- create an Office Hours request;
- create a warm introduction;
- mark follow-through complete;
- prove a deal, hire, partnership, or successful outcome.

It is interaction evidence only.

After verification, existing Beacon relationship systems remain separate consensual actions.

## Local retry policy

Pending confirmations retry opportunistically when:

- the Meet in Beacon screen is open;
- the event lobby is open;
- the app returns to the foreground.

Failures use bounded exponential backoff capped at five minutes. After repeated failure, the local record becomes `needs-attention` instead of creating a tight request loop.

Explicit refresh may force another attempt.

Network failure is distinct from terminal server rejection.

Terminal server states cause the one-time local secret material to be destroyed.

## Accessibility

The protocol does not require AR, accurate bearing, or physical device alignment.

Supported pathways include:

- QR camera scan;
- high-contrast manual offer code;
- high-contrast manual acknowledgement code;
- screen-reader-labelled actions;
- selectable codes for accessibility tooling.

Future NFC/BLE cannot become the sole method.

## Operational health

The server can provide a host-only cohort-gated health summary after at least five capabilities exist.

It can report aggregate counts for:

- prepared/presented capabilities;
- verified handshakes;
- pending handshakes;
- expired capabilities;
- conflict/replay state;
- safety blocks;
- offline-reconciled verification;
- live-server verification.

It does not expose participant pairs, offer tokens, acknowledgement nonces, device identifiers, or interaction histories.

The append-only protocol audit likewise contains only capability/event identity plus bounded reason codes.

## Required physical-device tests

Before describing this feature as deployment-validated, run at least the following with two real authenticated devices and a clean Supabase environment containing migration 059:

1. online offer -> online confirmation -> server-live verification;
2. offer prepared online -> both devices lose network -> complete two-way QR exchange -> reconnect A first -> reconnect B -> explicit-local verification;
3. same as above with B reconnecting first;
4. manual offer and manual acknowledgement with both devices offline;
5. duplicate uploads from both sides;
6. screenshot/replayed offer used by a second responder;
7. expired capability;
8. wrong event QR;
9. initiator removed before reconciliation;
10. responder removed before reconciliation;
11. block added after local confirmation but before reconciliation;
12. abuse report added after local confirmation but before reconciliation;
13. event closes before either device reconnects, then reconciliation within grace;
14. reconciliation after grace;
15. device clock several minutes ahead/behind;
16. malicious mutated acknowledgement;
17. concurrent two-device reconnect;
18. app background/foreground while pending;
19. logout followed by login as a different account on the same device;
20. camera permission denied and manual fallback used successfully.

## Non-goals for this iteration

- passive Bluetooth encounter history;
- continuous NFC discovery;
- device fingerprinting;
- cryptographic distance bounding;
- root/jailbreak attestation;
- automatic connection creation;
- emergency/life-safety identity proof;
- a formal proof that a human remained in a particular physical location.

The protocol intentionally solves a narrower and highly valuable problem: preserve explicit bilateral event interaction through temporary network failure while maintaining Beacon's consent, privacy, and server-authority boundaries.
