# Beacon Black Book Implementation Status

This document is the repository-level source of truth for translating the Beacon Black Book into code without duplicating engines, schemas, screens, or behavioral concepts.

## Current product substrate

The repository already contains the following major systems on `main`:

- Presence evaluation and urgency scoring
- Live proximity feed and event navigation
- Spatial field and avatar rendering foundations
- Premium gating
- Regret recording and telemetry
- Office-hours requests and LiveKit call support
- Escort queue and venue-room workflows
- AR-lite camera overlay
- RLS-scoped proximity, blocking, reporting, and rate limits
- Photoreal avatar generation pipeline

These systems must be extended rather than recreated.

## Implemented in this branch

### Event Phase Engine

Classifies arrival, exploration, peak, closing, and recap states from event timing. The phase output is pure, deterministic, and reusable by surge, Vault, drops, and organizer-health systems.

### Signal Velocity Tracker

Measures rolling event activity without persistent behavioral surveillance. It supports sent signals, received signals, mutuals, and office-hours openings inside a five-minute derived window.

### Opportunity Surge Engine

Combines presence density, premium density, activity velocity, momentum, event phase, and time compression into an auditable surge state. It produces stable, building, peak, or closing states and never fabricates urgency.

### Opportunity Window Banner

Provides a restrained in-app opportunity window with evidence, expiry, and optional next action. It intentionally avoids push notifications, public rankings, and hardcoded fake counts.

### Next Best Action Engine

Chooses one explainable action at a time. It can prioritize profile completion, presence activation, mutual resolution, office-hours requests, high-intent signals, Vault review, or deliberate waiting.

### Event Lobby integration

The live lobby now reflects event phase, opportunity readiness, evidence-backed windows, derived field metrics, and private missed-opportunity memory. Existing auth, event join, location, mutual, and regret flows remain intact.

### Vault opportunity memory

Adds an event-scoped private memory model for mutuals, missed categories, Office Hours outcomes, notes, and next actions. The pure Vault engine produces follow-up priorities, completion metrics, expiring-item counts, and privacy-safe summaries without turning Beacon into a social inbox.

### Signal scarcity foundation

Adds atomic per-event high-intent signal budgets, RPC-only budget consumption, and a deterministic candidate scoring engine. Scarcity is real and enforceable; the client cannot grant itself more signals, and ordinary discovery remains separate from high-intent actions.

### Trust receipts

Adds an auditable trust-receipt engine and reusable component for opt-in, private signals, Office Hours, mutual reveals, Vault saves, and Invisible VIP controls. Each receipt states what was shared, what stayed private, who can see the action, and when access expires.

### Verified Access Protocol

Adds event-scoped role attestations, typed role glyph semantics, and eligibility evaluation. High-trust labels can be organizer-verified without creating global status claims. The pure access engine decides whether a participant contributes only to aggregate density, reveals a role hint, reveals identity, accepts signals, or opens Office Hours.

### Invisible VIP controls

Adds per-event visibility modes: visible, aggregate-only, eligible-only, and invisible. VIPs can cap inbound access, selectively expose Office Hours, contribute to aggregate opportunity density without identity exposure, and permit reveal only after mutual or accepted access.

### Office Hours queue quality

Adds host controls for accepted roles, accepted intents, verification requirements, capacity, and minimum fit. The pure queue engine ranks requests privately using role fit, intent fit, verified status, mutual readiness, proximity state, request specificity, recency, and cancellation risk. No public ranking is introduced.

### Limited Access Drops

Adds real, time-bound professional access windows with hard capacity, role eligibility, verified-role requirements, confirmed claims, and ordered waitlists. Claims are atomic through a database RPC; the client cannot overbook capacity or fabricate scarcity.

### Organizer Outcome Intelligence Spine

Adds a private, host-only outcome ledger that captures event activation, verified supply, high-intent conversion, Office Hours fulfillment, Drop demand, Vault follow-through, and missed-opportunity volume. The database generates snapshots through a host-authorized RPC, so clients cannot fabricate organizer metrics.

The private Beacon Index is explicitly experimental and confidence-weighted. It combines activation strength, signal-to-mutual conversion, Office Hours completion, Vault follow-through, and verified supply. It remains hidden from public marketing and degrades to `insufficient_data` when the room has not produced a responsible sample.

### Outcome diagnostics and repeat-event fingerprints

Adds a pure organizer engine that translates raw aggregates into explainable operating constraints rather than a vanity dashboard. It can identify activation failure, weak signal quality, access-fulfillment leakage, verified-supply shortages, post-event decay, and excess demand pressure. It also creates outcome fingerprints that compare events across activation, relationship conversion, access conversion, follow-through, verified supply, demand pressure, and opportunity waste.

### Sponsor proof without surveillance

Adds an aggregate-only sponsor proof model that reports demand signals, completed access moments, and waitlist pressure only when minimum confidence requirements are met. The model never exposes private signals, proximity trails, Vault contents, or attendee identities.

### Event Security Control Plane

Adds database-enforced normal, restricted, and locked event modes. Hosts can independently disable signals, Office Hours, Access Drops, identity-bearing proximity reveal, and organizer exports without taking the entire event offline. Controls are event-scoped, readable only by approved participants, and mutable only by the event host.

### Sensitive-action replay protection and audit trail

Adds single-use action nonces, burst protection, block enforcement, security outcome logging, and privacy-safe reason codes for high-impact actions. Security logs contain action metadata and outcomes rather than private notes, message content, or raw location trails. Expired nonces and old security events can be pruned through a controlled maintenance function.

### Atomic secure mutation wrappers

Adds transaction-safe wrappers that combine authorization and mutation for scarce signals, Access Drop claims, and Office Hours requests. This closes the time-of-check/time-of-use gap that would otherwise exist if the client authorized an action and executed it in separate calls.

### Adaptive Security Risk Engine

Adds a pure, deterministic risk evaluator for replay attempts, blocked-relationship actions, abnormal recipient breadth, burst velocity, denial rates, new-account risk, and event security state. The output is explainable and can recommend cooldowns, reauthentication, reveal suppression, or event lock without creating a hidden user reputation score.

### Premium escalation hardening

The development-only RPC that allowed users to toggle their own premium status is revoked and replaced with a fail-closed function. Premium state must now come from a future trusted server or payment workflow.

### Application security automation

Adds a pull-request security gate with strict TypeScript compilation, production dependency auditing, environment-file detection, credential-pattern detection, CodeQL analysis, and dependency review. Dependabot is configured for guarded weekly updates grouped by runtime domain.

## Black Book systems not yet implemented

These remain separate future layers and must not be folded into unrelated work:

1. Vault recap screen and navigation entry point
2. Signal-budget UI and connection-request transaction integration
3. Office Hours host controls and queue UI
4. Invisible VIP settings UI and presence-feed enforcement
5. Verified role administration and glyph rendering
6. Limited Drops organizer and attendee screens
7. Organizer outcome console and event-comparison UI
8. Personal event strategy
9. Signature mutual activation moment
10. Premium Vault intelligence depth
11. Access-drop promotion from waitlist after cancellation
12. Automatic organizer-learning memory persistence after event close
13. Payment-backed premium enforcement and webhook verification
14. Moderator-facing security event review and incident workflow
15. Reauthentication UX for critical-risk actions
16. Migration of all legacy sensitive actions onto secure transaction wrappers

## Implementation rules

- Inspect existing files before every write.
- Extend an existing engine before creating a second engine with overlapping responsibility.
- Keep pure logic independent from React Native and Supabase.
- Keep all persistent records event-scoped.
- Do not store raw movement trails.
- Do not add chat, feed, public rankings, global discovery, or pay-to-message mechanics.
- Every urgency cue must be supported by density, time, capacity, availability, or mutual activity.
- Every high-intensity layer must be feature-flagged and removable without breaking the core mutual loop.
- Scarcity must be database-enforced whenever capacity or budget is shown to users.
- Verified roles must be event-scoped and must never silently become global reputation claims.
- Invisible participants may contribute only to aggregate intelligence until policy explicitly permits reveal.
- Organizer metrics must remain private until confidence and methodology are proven.
- Sponsor reports must be aggregate-only and must suppress claims when the sample is too small.
- Sensitive actions must fail closed when security state cannot be verified.
- Authorization and mutation must occur atomically for replay-sensitive or capacity-sensitive actions.
- Service-role credentials must never ship in the mobile bundle.
- Security telemetry must exclude private notes, exact movement trails, authentication payloads, and message content.
- One coherent layer per pull request whenever practical.

## Acceptance gate for this branch

Before merge:

- TypeScript must compile under strict mode.
- Auth, join-event, location, and mutual flows must remain unchanged.
- Opportunity windows must not appear without evidence.
- No raw coordinates are introduced by the new engines.
- The event lobby must render safely when activity history is empty.
- Feature flags must disable the new UI without broken imports.
- Vault identities must remain hidden unless mutual or explicitly permitted.
- Signal budgets must be consumed atomically through the database RPC.
- Trust receipts must describe actual data behavior and never promise protections the implementation does not enforce.
- VIP visibility must remain event-scoped and identity reveal must follow explicit policy.
- Access Drops must not exceed hard capacity and waitlist order must be deterministic.
- Office Hours fit scores must remain private to the host and must never become a public reputation score.
- Verified role indicators must be backed by an active event-role attestation.
- Outcome snapshots must be generated only by the event host through the database RPC.
- Beacon Index values must remain private and confidence-weighted.
- Sponsor proof must suppress claims below the minimum aggregate sample.
- Organizer diagnostics must be explainable from stored aggregate evidence.
- Development-only premium self-escalation must remain disabled.
- Sensitive action nonces must be single-use and event-scoped.
- Locked events must block sensitive mutations at the database layer.
- Blocked relationships must not bypass security checks through alternate features.
- Security event logs must not contain private content or raw location trails.
- Secure signal and Drop services must use the atomic wrapper RPCs.
- The security workflow must pass before the PR is marked ready for review.
