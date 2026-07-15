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

## Black Book systems not yet implemented

These remain separate future layers and must not be folded into unrelated work:

1. Vault recap screen and navigation entry point
2. Signal-budget UI and connection-request transaction integration
3. Office Hours host controls and queue UI
4. Invisible VIP settings UI and presence-feed enforcement
5. Verified role administration and glyph rendering
6. Limited Drops organizer and attendee screens
7. Organizer event health console
8. Beacon Index experimental formula
9. Personal event strategy
10. Signature mutual activation moment
11. Centralized high-intensity kill switches
12. Sponsor proof without surveillance
13. Repeat-event organizer memory
14. Premium Vault intelligence depth
15. Access-drop promotion from waitlist after cancellation

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
