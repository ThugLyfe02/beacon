# Beacon Security Policy

Beacon handles event-scoped identity, proximity-derived state, verified access, scarce professional opportunities, and post-event opportunity memory. Security defects can therefore cause more than technical failure: they can expose identity, defeat access controls, fabricate scarcity, or damage trust inside a physical event.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Send a private report to the repository owner with:

- A concise description of the vulnerability.
- The affected branch, commit, file, RPC, or screen.
- Reproduction steps using non-production data.
- The expected and actual security behavior.
- The potential impact on identity, event isolation, access capacity, or user safety.
- Any recommended containment step.

Do not include real attendee data, authentication tokens, service-role keys, private location data, or screenshots containing sensitive event information.

## Supported security posture

The current security model assumes:

- Supabase Auth is the identity authority.
- Row Level Security remains enabled for all user-facing tables.
- Service-role credentials never ship to the client.
- Persistent data remains event-scoped unless explicitly documented otherwise.
- Raw movement trails are not retained as a product feature.
- High-impact actions use server-side authorization and replay protection.
- Scarcity, capacity, and eligibility are enforced in the database rather than trusted to UI state.
- Organizers receive aggregate outcomes, not private signals or attendee-level behavioral exports.

## Security boundaries

### Identity boundary

A user may mutate only their own participant, profile, request, policy, and memory records unless a host-only or trusted-server RPC explicitly permits otherwise.

### Event boundary

Presence, verified roles, VIP visibility, Office Hours, Drops, signal budgets, Vault entries, and organizer outcomes must remain tied to a single event. Cross-event discovery is not an implicit permission.

### Relationship boundary

Blocks are bidirectional for sensitive actions. A blocked relationship must not be bypassed through signals, Office Hours, Drops, proximity reveal, or future premium features.

### Supply-side boundary

Verified roles and VIP controls are event-scoped. They must not become permanent public status claims or popularity scores.

### Scarcity boundary

Signal budgets, Office Hours capacity, and Limited Access Drop capacity are security-sensitive state. The client must not be able to increase limits, overbook capacity, or replay a successful mutation.

### Organizer boundary

Hosts may control their events and receive aggregate outcome intelligence. Hosting an event does not grant unrestricted access to private signals, hidden Vault identities, raw proximity trails, or private notes.

## High-impact action controls

Beacon's security control plane supports event-level normal, restricted, and locked states. Sensitive actions include:

- High-intent signals.
- Office Hours requests.
- Limited Access Drop claims.
- Identity-bearing proximity reveals.
- Organizer exports.
- Role attestations.
- VIP policy changes.

Sensitive action flows should use an idempotency nonce, event membership checks, block checks, event kill switches, burst limits, and privacy-safe security logging. Newly built UI must use atomic secure mutation RPCs rather than performing authorization and mutation in separate requests.

## Prohibited implementation patterns

- Shipping a Supabase service-role key in React Native code.
- Disabling RLS to make a client query work.
- Storing raw GPS trails for later product analysis.
- Trusting premium, role, capacity, eligibility, or organizer state supplied by the client.
- Building public popularity rankings from private interaction data.
- Logging message bodies, private notes, exact coordinates, access tokens, or full authentication payloads.
- Returning hidden VIP identity from aggregate-density queries.
- Separating a security check from the mutation it is intended to protect.
- Using fabricated scarcity or fabricated participant counts.

## Incident response priorities

1. Contain the affected event using the event security control plane.
2. Disable the affected sensitive action rather than disabling the entire product when possible.
3. Preserve privacy-safe security evidence.
4. Revoke exposed credentials and invalidate compromised sessions.
5. Confirm whether event isolation, identity reveal, capacity, or organizer boundaries were crossed.
6. Notify affected users with factual scope and corrective action.
7. Add a regression test or database constraint before restoring the action.
8. Record the root cause and update the relevant threat model.

## Dependency and code security

Pull requests targeting `main` run a security gate covering strict TypeScript compilation, production dependency auditing, tracked environment-file detection, high-risk credential-pattern detection, CodeQL analysis, and dependency review. Dependabot is configured for controlled weekly updates grouped by runtime domain.

Security automation is a gate, not proof of safety. Changes to RLS, SECURITY DEFINER functions, authentication, verified access, premium state, location handling, or atomic capacity allocation require manual review.
