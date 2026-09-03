# Participant spatial guidance

Beacon's participant spatial surfaces now share one explicit contract: the interface may become more immersive only when it becomes more truthful about the physical room.

This document covers the field-to-camera path, signal freshness, spatial stabilization, and participant-safe service guidance. It intentionally does not define person-level movement prediction, indoor emergency routing, face recognition, or hidden-attention inference.

## Coordinate contract

`ProximitySignal.bearingFromObserverDeg` is the measured observer-to-target compass bearing. When it is present, the field uses the following world frame:

- north = negative Z;
- east = positive X;
- south = positive Z;
- west = negative X.

Distance is still represented at the field's existing scale of roughly four physical feet per scene unit.

The id-derived angle that existed in the original avatar renderer is no longer allowed to become physical direction. It remains a deterministic compatibility fallback only when a legacy/incomplete signal lacks a bearing.

`SpatialLayoutEngine` still owns collision resolution. `SpatialPositionedAvatar` then compensates the mature `AvatarRenderer` so the final rendered mesh lands at the exact resolved world coordinate used by focus, camera, landmarks, and interaction layers. This avoids the subtle but damaging state where the camera points to one coordinate while the avatar is visibly somewhere else.

## Freshness contract

A live spatial interface should not be more current-looking than its source data.

The proximity service now preserves the peer's actual `last_location_at` timestamp instead of stamping every fetched coordinate with the current poll time.

There are deliberately different freshness windows for different claims:

- **90 seconds:** hard live-field cutoff for a peer coordinate. Older positions are removed from the live proximity result rather than displayed as current.
- **45 seconds:** direction/continuity authority cutoff. Beacon may still know the attendee is within the broader live presence window, but it will not keep giving turn guidance or cosmetically smooth an aging coordinate as though it were a precise new fix.
- **10 seconds:** full directional freshness band before confidence begins to decay.

These windows can be tuned from physical-device evidence, but they should remain semantically distinct. “Still visible in the live field” is a weaker claim than “safe to tell me which way to turn right now.”

## Spatial confidence in the world

`SpatialSignalIntegrity` evaluates only the latest visible signal using:

- peer-fix freshness;
- availability of a measured bearing;
- live presence runtime health.

It produces a bounded confidence band without changing attendee membership.

`SpatialSignalIntegrityLayer` renders that confidence into the field floor around each avatar. A fresh, bearing-backed signal gets a clearer marker; aging or incomplete evidence becomes visually restrained. Mutual status can still use its existing distinct language.

No attendee disappears merely because their confidence ring is weak. The field remains complete; the world simply becomes less visually certain when its evidence is less certain.

Selected-target cinematic emphasis is also bounded by the same signal confidence. The camera can still focus on a user-selected attendee, but the focus language softens as that position loses authority.

## Bounded continuity instead of teleporting avatars

GPS and indoor location estimates jitter. Rendering every small coordinate change literally makes an otherwise correct spatial system feel unstable.

`SpatialContinuityEngine` handles this with a deliberately narrow, session-local rule set:

1. tiny fresh changes inside a deadband keep the last resolved coordinate;
2. modest fresh changes are damped toward the new measured coordinate;
3. materially large changes snap to the new measurement immediately;
4. signals older than the 45-second directional authority window are never damped.

The engine never estimates velocity and never extrapolates a future position.

`useStableSpatialLayout` keeps only the immediately previous resolved layout for the mounted screen. Its input signature makes React render retries idempotent so a repeated render of the same source snapshot cannot repeatedly apply damping.

This cache is not persisted, transmitted, written to analytics, or accumulated into a movement history.

## Live direction

When a participant explicitly selects an attendee, `SpatialDirectionGuide` can translate the latest target bearing and the local device compass into:

- absolute cardinal direction;
- absolute bearing degrees;
- relative turn direction;
- current distance;
- signal age;
- bounded directional confidence.

The device compass is smoothed in vector space so the 359° -> 0° wraparound does not produce a false visual spin.

The compass subscription is active only while a directional surface needs it. Heading remains local to the device.

If the peer fix ages beyond the directional authority window, the guide becomes unavailable instead of extrapolating where the person probably went.

## Field -> Camera Guide

The attendee action sheet now offers an explicit **Open Camera Guide** action when a selected target has usable live bearing evidence.

Camera Guide is target-specific. It receives an explicit `targetId`; it does not scan the room and auto-acquire a person according to a ranking model.

The camera view:

- uses the device heading to determine the target's relative horizontal angle;
- uses the correct half-FOV visibility test;
- renders the avatar at the computed AR coordinate through `SpatialPositionedAvatar`;
- shows a turn instruction when the target is outside the current view cone;
- changes the reticle when the selected target is inside the view cone;
- stops projecting the selected target if the live signal disappears.

The phone does not chase the attendee. The participant moves the camera naturally.

This is a bearing guide, not a claim of centimeter-accurate indoor AR registration. Pitch/roll fusion and calibrated indoor anchors would require an additional sensing contract and should not be implied by the current implementation.

## Participant-safe venue service guidance

Venue operations already observe aggregate service points such as check-in, food, coat check, restrooms, booths, and normal service/security desks.

`get_live_venue_service_guidance` creates a separate participant projection. It releases only:

- service-point label/id;
- semantic zone;
- service kind;
- coarse state (`clear`, `steady`, `busy`, `unknown`);
- coarse wait band;
- coarse direction of change (`easing`, `stable`, `building`, `unknown`);
- confidence;
- observation timestamp.

It does **not** release queue length, arrival count, completion count, or raw service history.

The latest public sample must be recent, support-gated, confidence-gated, and attached to an operational event. A prior aggregate sample is used only to classify the coarse observed trend.

The participant guide ranks this already-redacted projection deterministically. It is not a popularity score and it does not infer hidden demand.

“Easing” means the latest supported aggregate queue evidence improved relative to the previous supported sample. It does not mean Beacon predicts the line will be shorter in ten minutes.

## Physical-device validation matrix

The next device pass should exercise the system as one experience rather than testing files individually.

### Bearing truth

- Place two controlled devices approximately north/east/south/west of the observer.
- Confirm field position matches physical bearing rather than user identity.
- Rotate the observer without changing peer positions; the north-locked 3D field should remain spatially consistent while Camera Guide relative instructions change with device heading.

### Jitter

- Hold both devices stationary for several minutes indoors.
- Record small GPS/bearing changes.
- Verify small changes remain stable, modest changes damp, and a genuinely large reposition snaps rather than slowly drifting.

### Freshness

- Stop one target device from updating location.
- Verify directional confidence decays.
- Verify Camera Guide stops directional authority at the configured window.
- Verify the attendee is removed from the live proximity field after the hard live cutoff rather than remaining as a false current location.

### Camera Guide

- Select a target from the 3D field and open Camera Guide.
- Test target ahead, left, right, and behind.
- Verify the 60° camera FOV uses a 30° one-sided half-angle.
- Verify the target cannot be auto-selected without the participant explicitly choosing it.
- Walk the target materially; confirm fresh updates replace the old bearing without predictive chasing.

### Weak runtime

- Background/foreground the app.
- Simulate failed proximity polls.
- Confirm confidence markers become less assertive before the field becomes less truthful.
- Confirm last-known-good behavior does not reset peer timestamps to “now.”

### Service utility

- Feed two supported service-point samples with improving queue evidence.
- Confirm the participant sees only an `EASING` trend and coarse wait band.
- Confirm raw queue counts are available only on authorized operations surfaces.
- Close the event and verify participant live guidance disappears while host closeout evidence remains.

## Product boundary

The intended user experience is straightforward:

**see the room -> trust what is current -> select deliberately -> understand direction -> open the camera when useful -> act in the physical world**

The immersion comes from reducing the gap between Beacon's world and the real venue, not from inventing certainty the sensors do not provide.
