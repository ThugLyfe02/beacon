# Venue Operations Learning

## Why this exists

Beacon's venue layer should not stop at recommending an operator action. The valuable loop is:

1. establish an aggregate baseline;
2. predeclare what success means;
3. record the action the operator actually took;
4. measure the venue after the observation window;
5. keep only repeated patterns with enough support;
6. use those measured patterns to inform future venue setup and live operations.

This is deliberately stricter than an analytics dashboard. A recommendation is not evidence that an intervention worked.

## Measurement discipline

Before an intervention is applied, `VenueExperimentDesign` creates a measurement contract containing a primary metric, baseline, observation window, confidence threshold, and stop conditions. This prevents post-hoc metric selection.

The current plans are observational rather than randomized causal experiments. Beacon must not claim causality from a single before/after comparison. If future deployments support controlled staggered rollouts, matched zones, or randomized signage/programming treatments, those can be introduced as stronger evaluation designs without changing the ledger contract.

## Intervention ledger

`VenueInterventionLedger` records the operator command, aggregate baseline, target zones, action state, and measured aggregate outcome. It intentionally excludes identity-linked attendee trajectories.

A record is only considered learnable after it reaches `measured`. Proposed or accepted recommendations never count as successful interventions.

## Repeat-event learning

`VenueOutcomeLearning` groups measured interventions by command and target-zone set. Patterns remain suppressed until at least three measured examples exist. This is a minimum maturity gate, not statistical proof. Confidence increases with repeated observations and effect consistency.

The long-term target is a venue-specific playbook such as:

- which decompression actions repeatedly reduce saturation;
- which programming adjustments improve cross-zone utilization;
- which zones serve as reliable headroom;
- which sponsor areas show consistent activation under comparable programming.

## Sponsor evidence

`SponsorEvidenceLedger` separates marketing claims from operational intuition. Sponsor-facing evidence is released only when aggregate support and confidence clear explicit thresholds.

Useful outputs include zone activation, supported cross-zone flow, and measured effects of organizer interventions. The report intentionally does not expose attendee paths or re-identifiable movement histories.

## Privacy posture

Mobility data can remain sensitive even after direct identifiers are removed. Beacon should therefore prefer the least granular data that supports the operational purpose, cohort-gate releases, and keep identity-linked paths out of the organizer surface.

The current client privacy budget is a policy seam, not a claim of formal differential privacy. A server-side implementation should define contribution bounds, an adjacency model, privacy accounting, and tested DP mechanisms before Beacon advertises mathematical privacy guarantees.

## Production next steps

- persist intervention records server-side with append-only audit semantics;
- bind records to event, venue-layout version, and operator identity/role;
- ingest venue geometry from GeoJSON or BIM-derived semantic zones;
- timestamp configuration changes so outcome windows cannot span incompatible layouts;
- add queue/service-point metrics where venues expose them;
- calibrate intervention thresholds on real events before treating them as safety-critical;
- separate operational recommendations from emergency-management controls unless independently validated for that use.
