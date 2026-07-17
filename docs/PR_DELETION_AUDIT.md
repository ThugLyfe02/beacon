# PR #2 Deletion Audit

This audit explains the apparent deletion count in PR #2 and distinguishes necessary replacement from accidental product loss.

## Executive finding

No tracked product file was deleted from the repository. The deletion total comes from line replacement inside modified files and dependency-lockfile regeneration. The branch remains substantially net-positive in code and product capability.

## Largest deletion sources

### `package-lock.json`
Lockfile lines changed because Expo packages and vulnerable transitive dependencies were realigned. These are generated dependency graph changes, not removed Beacon features.

### `src/screens/MapScreen.tsx`
The map was refactored to remove repeated inline styles, duplicate location handling, weak coordinate truthiness checks, and invalid type casts. The event map, join/create entry points, radar, participant counts, premium markers, location streaming, pending approval state, and premium drawer remain protected by the Product Preservation Contract.

Some copy was shortened during consolidation. That was not technically necessary and must be treated as presentation review rather than assumed improvement.

### `src/services/match.service.ts`
Direct client mutation and separate mutual detection were replaced by one atomic secure transaction. This deletion was necessary because retaining the original path would permit future callers to bypass replay protection, blocking, event security state, and signal scarcity.

### `src/services/event.service.ts`
Previous deletions were mainly comments and formatting, but the service also retained weaknesses. This audit pass restores explicit lifecycle documentation and elevates the implementation with:

- nullish coordinate handling so zero remains valid,
- event timing validation,
- collision-resistant join-code retries,
- compensated cleanup if host participation creation fails,
- deterministic active/upcoming/recent ordering,
- `maybeSingle` reads for legitimate empty states,
- stronger surfaced database errors.

### `src/services/officeHours.service.ts`
The direct insert path was replaced by the secure atomic RPC. The user-facing Office Hours journey remains intact.

### Hooks and UI surfaces
Stale service references, invalid style values, duplicate JSX, and obsolete typing workarounds were removed. Protected screens and journeys are now checked automatically in CI.

## What is not acceptable to delete

The following are now merge-blocking regressions:

- Event creation, joining, approval, or host participation
- Map, radar, premium discovery, or location publishing
- Secure signal and mutual activation
- Office Hours request, inbox, call, or escort flows
- Outcome Handshake privacy and completion
- Vault actions and opportunity memory
- Opportunity intelligence and evidence-backed urgency
- Spatial, AR, avatar, camera, microphone, or LiveKit entry points
- Blocking, reporting, security modes, or privacy boundaries

## New safeguard

`scripts/validate-product-preservation.mjs` verifies protected files, critical navigation entry points, secure service integrations, enabled integrated flags, and required migrations. The Security Gate now runs this contract alongside strict TypeScript, architecture validation, dependency auditing, Expo Doctor, Android bundling, CodeQL, and dependency review.

## Decision standard going forward

A deletion is acceptable only when it is classified as:

1. a safe replacement,
2. a defect removal, or
3. presentation consolidation reviewed for product-language quality.

Anything that removes a meaningful action, state, recovery path, explanation, or integration is a capability regression and blocks merge until restored or deliberately migrated.
