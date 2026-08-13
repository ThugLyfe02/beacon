# Spatial Navigation and Cinematic World Architecture

## Purpose

Beacon's spatial field already understands presence, opportunity, trust, temporal phases, progression and world state. This layer makes those systems physically navigable. It is not a decorative camera animation package. It is an interaction architecture for moving between four scales of attention:

1. the complete room,
2. the shape of live activity,
3. an explainable world landmark,
4. one explicitly selected path.

The camera is treated as a product system because composition determines what users understand, what they miss and whether the world feels coherent. The HUD is treated as an attention system for the same reason: a sophisticated world becomes less desirable when every subsystem talks at once.

## Camera modes

### Overview

Frames the complete visible field and expands with crowd size. It does not hide attendees to preserve a clean shot. Instead, camera distance and field of view adapt to the number of visible people.

### Explore

Uses an angled composition to expose depth between avatars, routes, clusters and district geometry. This is the primary world-reading mode when the user wants context rather than a recommendation.

### Focus

Frames one attendee only after explicit selection. Focus mode does not infer intent, follow private movement or auto-select a person. Closing the target sheet returns the world to overview.

Focus uses the same collision-resolved position as the avatar renderer. The camera, halo and displayed model therefore cannot disagree when a crowded field moves an avatar into a neighboring radial lane.

### Landmark

Frames an explainable anchor derived from visible or aggregate state:

- a visible mutual,
- an aggregate activity cluster,
- a confidence-gated forecast sector,
- or the live field center.

Landmarks contain evidence confidence, stable IDs and user-controlled previous/next traversal. They are navigation anchors, not hidden recommendations.

### Convergence

Compresses the composition toward the active center of the field. It is designed for periods where route energy, clusters and mutuals need to read as one system rather than isolated effects.

### Reflection

Pulls the camera back after the live phase to reveal the event as a completed shape. This supports the transition from live presence into Vault follow-through.

## Field Scout

Field Scout is a user-initiated cinematic tour through the current explainable landmarks.

The tour:

- never starts automatically;
- prioritizes landmarks the user has not framed during the current event;
- opens with field orientation when a center landmark exists;
- diversifies stops across clusters, forecasts and visible mutual routes;
- allows pause, resume, previous, next, replay and immediate exit;
- skips a stop if its underlying landmark disappears;
- remembers framed landmarks for the current event session;
- and returns camera ownership to the user when it ends.

The tour step budget controls duration, not world visibility. Every attendee and every landmark remains in the scene. Field Scout only creates a concise sequence for understanding how the room has changed.

## Attention budget

Beacon has multiple legitimate explanatory surfaces: Director, world intelligence, narrative, landmarks, navigation, contracts, progression and Field Scout. Showing all of them simultaneously would turn the product into a debug dashboard.

The Spatial Attention Engine selects a small contextual set based on:

- camera mode,
- temporal phase,
- runtime health,
- quality tier,
- selected target,
- near-miss state,
- landmark availability,
- and Field Scout status.

Examples:

- Focus clears nearly every panel around the selected interaction.
- Landmark mode keeps landmark evidence, world context and camera controls.
- Peak activity prioritizes world intelligence and Director context.
- Commitment and closing prioritize narrative and the active contract.
- Reflection prioritizes narrative, progress and follow-through.
- Recovery suppresses secondary analytics and shows truthful runtime context.
- Field Scout temporarily owns the attention surface because the user explicitly requested it.

No underlying capability is deleted. The engine controls when an explanation deserves screen space.

## Adaptive quality

The quality governor maintains four tiers:

- Cinematic
- Balanced
- Efficient
- Recovery

It can reduce pixel ratio, route detail, environment-light cost, motion intensity and camera transition aggressiveness. It cannot remove attendees or change the truth represented by the field.

Quality state responds to crowd size, runtime reliability, world coherence and the operating-system reduced-motion preference.

## Reduced motion

Beacon reads the native reduced-motion preference and updates while the app is running.

When reduced motion is enabled:

- camera transitions collapse toward immediate, bounded changes;
- cinematic intensity is reduced;
- quality policy suppresses nonessential avatar motion;
- the same information and controls remain available;
- and the user does not receive a downgraded product model.

## Shared spatial address space

Crowded fields use deterministic collision-aware avatar placement. The computed layout is shared across:

- avatar rendering,
- camera focus,
- mutual landmarks,
- focus geometry,
- and future spatial-audio or interaction systems.

This prevents a common 3D-product failure where a camera focuses on the mathematical target position while the visible avatar has been displaced elsewhere for readability.

## Safety and stability constraints

- no random camera movement;
- no hidden target selection;
- no person-level movement prediction;
- no forced cinematic sequence;
- bounded FOV changes;
- damped position and look-target interpolation;
- explicit mode ownership remains with the user;
- focus requires an already-visible selected attendee;
- landmark framing uses visible or aggregate explainable state;
- reflection cannot be replaced by convergence after the event closes;
- reduced-motion preference is wired from the operating system;
- quality adaptation cannot hide people;
- Field Scout can be paused or exited at any time;
- HUD orchestration cannot remove product capability;
- and all sequencing remains deterministic.

## Why this matters

Most 3D interfaces render a world and leave the camera as a generic orbit control. They also place every available status card on screen because each system was designed independently.

Beacon now treats camera composition, world landmarks, scene cost, accessibility, guided orientation and attention allocation as one product layer. The same live data can feel chaotic or intentional depending on framing and information density. This architecture preserves the complete field while changing how the user reads it.

The market-facing value is simple:

> Open Beacon, understand what the room is doing, scout what changed, and deliberately enter the right level of attention without browsing a directory.

## Future extensions

The architecture can accept additional policies without rewriting the renderer:

- gesture-driven temporary offsets around engine-authored poses;
- organizer-authored venue landmarks;
- camera bookmarks for verified clusters;
- spatial-audio listener orientation;
- cinematic replay of aggregate event phases without movement trails;
- field-tour analytics based on completed outcomes rather than watch time;
- device-frame telemetry feeding the quality governor;
- and private post-event moment capsules that resolve into Vault actions.
