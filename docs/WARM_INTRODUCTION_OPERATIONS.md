# Warm introduction operations

This document covers the production details that keep warm introductions stable under concurrent event traffic and repeated React Native rendering.

## Concurrency-safe admission

Warm-introduction limits are not enforced only in the client.

The durable insertion boundary serializes the requester and target capacity checks with transaction-scoped PostgreSQL advisory locks. The two lock keys are acquired in numeric order so reciprocal requests cannot deadlock by taking requester and target locks in opposite order.

After the locks are held, the database rechecks:

- unresolved introductions owned by the requester;
- total introduction requests created by the requester during the event;
- unresolved requests aimed at the target;
- decisions already waiting directly on the target;
- active work assigned to the selected connector;
- the connector's current self-selected capacity.

The connector preference row is locked before its active count is admitted. The partial unique index on requester and target remains a separate final defense against duplicate active pair routes.

This matters because two mobile clients can pass a read-time capacity check simultaneously. Without transaction admission, both could insert and exceed the intended limit.

## Bounded queues

Current server limits are:

- requester: no more than three active/open introductions;
- requester: no more than six total requests in one event;
- target: no more than eight unresolved routes, including connector decisions that may later reach them;
- target: no more than four decisions currently waiting directly on them;
- connector: between one and four active requests, chosen by the connector.

These values are operational safety limits. They are not scarcity mechanics, premium entitlements, or indicators of participant importance.

## Connector withdrawal

A participant can disable warm-introduction availability at any time while the event is operational.

Disabling does two things:

1. removes the participant from all future connector selection;
2. closes requests still in `connector-pending` that were assigned to them.

It does not cancel a request already moved to `target-pending`. In that state, the connector explicitly accepted the individual bridge and the target now owns the final decision. Silently revoking it through a general preference toggle would override both prior connector consent and the target's pending choice.

Accepted and matched introductions are historical or actionable state, not connector workload, and are not rewritten by the preference toggle.

## Render-stable availability

The live avatar sheet may re-render frequently as proximity, heading, freshness, and camera state change.

The declared-fit domain array is derived from live signal metadata and can therefore receive a new array identity even when its contents are unchanged.

`WarmIntroductionRequestCard` canonicalizes the domain set into a sorted primitive key. The memoized domain list depends on that content key rather than the caller's array identity.

This prevents an otherwise equivalent avatar-sheet render from restarting the availability RPC and creating a request storm while the sheet remains open.

The card performs one availability read for a stable event, target, and domain set. It does not create its own interval.

## Quiet inbox reconciliation

Connector and target decisions can change while the introduction inbox is open.

The inbox reconciles with the server every 30 seconds, but the periodic path uses a `quiet` load mode. It updates state without displaying pull-to-refresh chrome.

The visible refresh indicator is reserved for the user's explicit pull gesture. Post-decision, cancellation, and connection-signal reconciliation also use the quiet path.

This prevents the screen from appearing to refresh itself aggressively while still keeping state transitions current.

## Source of truth

The client never advances the introduction lifecycle optimistically beyond a confirmed server response.

After every mutation it rereads the role-aware inbox projection. The projection determines:

- current status;
- whether the caller can accept;
- whether the caller can decline;
- whether the requester can cancel;
- whether connector identity is releasable;
- whether ordinary connection or Office Hours actions are available.

The client does not reconstruct protocol authority from local timestamps.

## Pressure-test cases

The following tests should run against a real Supabase environment with multiple authenticated sessions:

1. two requester tabs submit to the same target simultaneously;
2. two requesters submit the fourth and fifth target-visible decisions concurrently;
3. two requests race for the last connector capacity slot;
4. requester A targets B while B targets A;
5. connector disables availability while a request is `connector-pending`;
6. connector disables availability after accepting and moving a request to `target-pending`;
7. an avatar sheet re-renders repeatedly with equivalent fit domains;
8. the inbox remains open through connector and target decisions made on another device;
9. pull-to-refresh and quiet reconciliation overlap;
10. a resulting mutual is created while the inbox is backgrounded.

Expected behavior is deterministic rejection or one admitted transition—never duplicate active routes, excess capacity, visible polling churn, or client-invented state.
