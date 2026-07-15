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

## Black Book systems not yet implemented

These remain separate future layers and must not be folded into unrelated work:

1. Vault core schema and post-event recap
2. Signal scarcity budgets
3. Trust receipts
4. Office-hours request queue quality and capacity integrity
5. Invisible VIP mode
6. Verified role glyph grammar
7. Limited drops and waitlists
8. Organizer event health console
9. Beacon Index experimental formula
10. Personal event strategy
11. Signature mutual activation moment
12. Centralized high-intensity kill switches
13. Sponsor proof without surveillance
14. Repeat-event organizer memory

## Implementation rules

- Inspect existing files before every write.
- Extend an existing engine before creating a second engine with overlapping responsibility.
- Keep pure logic independent from React Native and Supabase.
- Keep all persistent records event-scoped.
- Do not store raw movement trails.
- Do not add chat, feed, public rankings, global discovery, or pay-to-message mechanics.
- Every urgency cue must be supported by density, time, capacity, availability, or mutual activity.
- Every high-intensity layer must be feature-flagged and removable without breaking the core mutual loop.
- One coherent layer per pull request whenever practical.

## Acceptance gate for this branch

Before merge:

- TypeScript must compile under strict mode.
- Auth, join-event, location, and mutual flows must remain unchanged.
- Opportunity windows must not appear without evidence.
- No raw coordinates are introduced by the new engines.
- The event lobby must render safely when activity history is empty.
- Feature flags must disable the new UI without broken imports.
