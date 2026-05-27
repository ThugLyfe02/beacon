# Motion clips

Higgsfield-generated MP4 loops used as backdrops for high-impact brand moments.
Files in this folder are wired through `src/lib/motionAssets.ts` and rendered by
`<MotionBackdrop />`. When a slot is empty, the screen falls back to the
animated `GridBackground` — so missing files are never a crash, just a downgrade.

## Workflow

1. Generate the clip on https://higgsfield.ai using the prompt in the table
   below. Aim for a clean **seamless loop** (Higgsfield's "loop" toggle).
2. Export at the spec given. Name it exactly as listed (e.g. `otp.mp4`).
3. Drop it into this folder.
4. Open `src/lib/motionAssets.ts` and uncomment the matching `require(...)` line.

## Spec (all clips)

| Knob          | Value                                  |
| ------------- | -------------------------------------- |
| Container     | MP4 (H.264, mp4a-free / silent)        |
| Resolution    | 1080 × 1920 (portrait)                 |
| Duration      | 6 – 10 s, seamless loop                |
| Frame rate    | 24 fps                                 |
| Bitrate       | ~2 Mbps target (file < 2 MB ideal)     |
| Color         | Dark, cool, cyan-leaning. No warm tones.|
| Audio         | None (player is muted anyway)          |

## Brand guardrails (read before prompting)

These match `beacon-design-system/project/README.md`:

- Aesthetic is **cyberpunk-signal HUD on a dark void**. Not "cinematic action."
- Palette: `#05070D` void → `#1A2236` elevated, cyan `#00E5FF`, gold `#FFD24A`.
  Higgsfield should output only these tones; reject any warm/sunset/orange.
- No people, no faces, no daylight, no nature, no text.
- Motion should feel **machine-like**: linear loops, slow drifts, no easing
  bounces. Think instrument readout, not playful UI.
- No bright flashes, no rapid cuts — anything that would compete with overlaid
  text on a phone screen.

## Prompts

### `otp.mp4` — sign-in backdrop

> Slow drift across a dark cyberpunk control room at night. Endless geometric
> floor of thin cyan grid lines stretching to the horizon, mild perspective.
> A small cyan beacon pulses softly in the upper third. A single faint
> horizontal scanline drifts down. Pure black sky, cool color temperature,
> high contrast, deep shadows, subtle film grain. Loopable. No people.
> No text. Cyan #00E5FF on near-black #05070D.

### `map-quiet.mp4` — Map empty state

> Dark city seen from above as an abstract street-grid wireframe in deep navy
> with faint cyan highlights. A single cyan beacon pulse expands and fades at
> the center every two seconds. Slow downward drift, parallax. No buildings,
> no labels, no people. Loopable. Cyan #00E5FF on near-black #05070D.

### `radar.mp4` — Radar disc backdrop (premium)

> Slow concentric gold rings expanding from the center of a black void.
> A faint gold sweep arm rotates clockwise once every three seconds.
> Cool dark backdrop, no people, no text. Loopable. Gold #FFD24A on
> near-black #05070D.

## Adding a new motion slot

1. Add a key + commented `require` line to `src/lib/motionAssets.ts`.
2. Add a row above with the file name and Higgsfield prompt.
3. Pass `source={motionAssets.yourKey}` to `<MotionBackdrop />` on the target
   screen. `tint` defaults to accent (cyan); pass `tint="premium"` for gold
   moments or `tint="none"` if the clip is already on-brand.
