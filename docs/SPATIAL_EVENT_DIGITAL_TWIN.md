# Spatial Event Digital Twin

## Why this exists

Beacon's current spatial stack is strong at representing live attendee opportunity. The next leverage layer is to make the **venue itself** observable and operationally useful.

This branch introduces a privacy-preserving venue digital twin that sits above the attendee-facing world without turning Beacon into a surveillance product.

The system is designed around four production goals:

1. **Live venue awareness** — convert aggregate occupancy and flow into zone-level state.
2. **Operator control** — give organizers reversible, measurable interventions instead of dashboards full of passive charts.
3. **Scenario planning** — compare a stable baseline against deterministic aggregate what-if actions before making a venue change.
4. **Compounding event intelligence** — create structured, reusable operational evidence that can improve future events, sponsor reporting and venue configuration.

## Architecture

### 1. Venue twin

`SpatialVenueTwinEngine` consumes explicit venue zone definitions plus aggregate occupancy observations.

It produces:

- zone state: cold / forming / active / saturated / recovering;
- occupancy ratio;
- dwell pressure;
- ingress pressure;
- egress pressure;
- aggregate transition support between zones;
- confidence and operational narrative.

The engine does **not** persist identity-linked paths or person-level trajectories.

### 2. Flow control

`SpatialFlowControlEngine` translates twin state into reversible zone-level actions:

- observe;
- reroute;
- decompress;
- open capacity;
- hold while live confidence recovers.

Every intervention includes a reason and an expected operational effect.

### 3. Organizer command layer

`SpatialOrganizerCommandEngine` converts spatial evidence into operator-facing work:

- flow balancing;
- capacity management;
- multi-zone programming changes;
- safety/decompression;
- sponsor proof opportunities.

Each command includes the exact metric that should be watched after intervention, so Beacon can eventually support closed-loop operator learning.

### 4. Venue scenarios

`SpatialVenueScenarioEngine` runs deterministic aggregate what-if scenarios against the current twin.

Examples:

- maintain baseline;
- decompress saturated zones;
- activate underused capacity;
- stagger programming across active zones.

This intentionally models zone pressure, not synthetic individual people. The output is a projected flow-health delta and bottleneck count that can be measured against the actual post-action result.

### 5. Privacy budget seam

`SpatialPrivacyBudgetEngine` provides a client-side policy gate for aggregate release:

- minimum cohort size;
- bounded query count;
- explicit privacy budget exhaustion;
- suppression when cohorts are too small.

This is **not** presented as formal differential privacy by itself. It is a clean seam for a server-side DP mechanism, which is the correct place to provide formal privacy guarantees before any organizer or external aggregate release.

## Product leverage

This creates three distinct Beacon surfaces from the same spatial foundation:

### Attendee surface

"Help me understand this room and find the right opportunity."

### Organizer surface

"Show me where the event is working, where it is breaking, and what I should change now."

### Post-event intelligence surface

"Show me which zone/programming decisions changed flow and outcome quality so the next event starts smarter."

That turns Beacon from a networking interface into an **event operating system** with an accumulating venue and event-design data moat.

## Guardrails

- no individual movement dossiers;
- no person-level trajectory release;
- no small-cohort aggregate release;
- no synthetic claims about attendee intent;
- no automatic operator intervention;
- no safety claim without sufficient confidence;
- no sponsor reporting from unsupported aggregates;
- every recommended intervention remains reversible and measurable.
