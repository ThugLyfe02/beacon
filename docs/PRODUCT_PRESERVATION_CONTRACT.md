# Beacon Product Preservation Contract

This contract exists because production-grade evolution must not confuse code reduction with capability loss. Refactoring is allowed to remove duplication, stale adapters, insecure paths, and invalid types. It is not allowed to silently remove a user journey, host control, privacy promise, recovery path, or meaningful product expression.

## Protected product journeys

The following journeys must remain available unless a dedicated migration plan explicitly replaces them:

1. Authentication and profile completion
2. Event creation, joining, approval, and host participation
3. Map discovery, location publishing, radar, and event navigation
4. Participant discovery and secure connection signaling
5. Mutual creation and profile context
6. Office Hours request, inbox, call, and escort workflows
7. Opportunity intelligence and evidence-backed urgency
8. Outcome Handshake privacy and reciprocal alignment
9. Vault memory, next actions, and completion
10. AR, spatial field, avatar, camera, microphone, and LiveKit entry points
11. Blocking, reporting, event security controls, and privacy boundaries
12. Organizer outcome snapshots and aggregate-only sponsor proof

## Protected product qualities

- Empty states must still explain what the user can do next.
- Error states must remain actionable rather than silently swallowing failure.
- A refactor may condense JSX, but it must not weaken the product language or remove a meaningful action.
- Coordinates must treat zero as valid.
- Event selection must be deterministic rather than relying on accidental database order.
- Sensitive mutations must use atomic server-side authorization and mutation.
- One-sided professional intent must remain concealed until compatible reciprocal intent exists.
- Hidden identities must not leak through stored metadata, diagnostics, analytics, or error reporting.
- Existing hardware-dependent surfaces must remain represented in CI and manual acceptance plans.

## Deletion taxonomy

Every significant deletion belongs to one of four categories:

### Safe replacement
The old implementation was replaced by a more secure, typed, or atomic path while preserving the behavior.

Examples: direct connection inserts replaced by a secure transaction; direct Office Hours creation replaced by a guarded RPC.

### Defect removal
The removed code was invalid, stale, unreachable, contradictory, or responsible for a real defect.

Examples: stale hook/service names, invalid React Native style values, unsafe truthiness checks for coordinates.

### Presentation consolidation
Repeated styles, comments, or JSX were condensed without changing the journey. This requires explicit review to ensure product language did not become weaker.

### Capability regression
A meaningful action, state, explanation, recovery path, or integration disappeared without a documented replacement. This category blocks merge until restored or intentionally migrated.

## Review rule

A large pull request must include an automated preservation check and a human-readable deletion audit. Green TypeScript and security checks are necessary but not sufficient: the branch must also prove that Beacon's critical product journeys still exist.
