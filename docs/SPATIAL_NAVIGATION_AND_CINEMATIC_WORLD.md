# Spatial Navigation and Cinematic World Architecture

## Purpose

Beacon's spatial field already understands presence, opportunity, trust, temporal phases, progression and world state. This layer makes those systems physically navigable. It is not a decorative camera animation package. It is an interaction architecture for moving between three scales of attention:

1. the complete room,
2. the shape of live activity,
3. one explicitly selected path.

The camera is treated as a product system because composition determines what users understand, what they miss and whether the world feels coherent.

## Camera modes

### Overview

Frames the complete visible field and expands with crowd size. It does not hide attendees to preserve a clean shot. Instead, camera distance and field of view adapt to the number of visible people.

### Explore

Uses an angled composition to expose depth between avatars, routes, clusters and district geometry. This is the primary world-reading mode when the user wants context rather than a recommendation.

### Focus

Frames one attendee only after explicit selection. Focus mode does not infer intent, follow private movement or auto-select a person. Closing the target sheet returns the world to overview.

### Convergence

Compresses the composition toward the active center of the field. It is designed for periods where route energy, clusters and mutuals need to read as one system rather than isolated effects.

### Reflection

Pulls the camera back after the live phase to reveal the event as a completed shape. This supports the transition from live presence into Vault follow-through.

## Safety and stability constraints

- no random camera movement;
- no hidden target selection;
- no person-level movement prediction;
- bounded FOV changes;
- damped position and look-target interpolation;
- explicit mode ownership remains with the user;
- focus requires an already-visible selected attendee;
- reflection cannot be replaced by convergence after the event closes;
- reduced-motion operation is supported by the engine contract.

## Why this matters

Most 3D interfaces render a world and leave the camera as a generic orbit control. Beacon now treats the camera as a narrative and comprehension layer. The same live data can feel chaotic or intentional depending on framing. This architecture allows Beacon to preserve the full field while changing how the user reads it.

## Future extensions

The engine was designed to accept additional policies without rewriting the renderer:

- accessibility preference integration for reduced motion;
- gesture-driven temporary offsets around engine-authored poses;
- organizer-authored venue landmarks;
- camera bookmarks for verified clusters;
- spatial audio listener orientation;
- cinematic replay of aggregate event phases without movement trails;
- device performance adaptation for transition complexity.
