import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required spatial-direction file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  const content = read(path);
  if (!content.includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  const content = read(path);
  if (content.includes(text)) failures.push(`${path}: ${explanation}`);
}

const files = [
  'src/spatial/SpatialExperienceEngine.ts',
  'src/spatial/SpatialLayoutEngine.ts',
  'src/spatial/SpatialPositionedAvatar.tsx',
  'src/spatial/SpatialAvatarLayer.tsx',
  'src/spatial/SpatialDirectionGuide.ts',
  'src/spatial/SpatialSignalIntegrity.ts',
  'src/spatial/SpatialSignalIntegrityLayer.tsx',
  'src/spatial/SpatialContinuityEngine.ts',
  'src/spatial/useStableSpatialLayout.ts',
  'src/spatial/SpatialFieldScreen.tsx',
  'src/spatial/AvatarActionSheet.tsx',
  'src/spatial/ARFieldScreen.tsx',
  'src/hooks/useHeading.ts',
  'src/services/proximity.service.ts',
];
for (const path of files) read(path);

requireText('src/spatial/SpatialExperienceEngine.ts', 'bearingFromObserverDeg', 'spatial placement must consume the measured observer-to-target bearing when available');
requireText('src/spatial/SpatialExperienceEngine.ts', 'Math.sin(radians) * radius', 'east/west field placement must derive from true compass bearing');
requireText('src/spatial/SpatialExperienceEngine.ts', '-Math.cos(radians) * radius', 'north/south field placement must derive from true compass bearing');
requireText('src/spatial/SpatialExperienceEngine.ts', 'compatibility fallback', 'id-derived direction must remain an explicitly labeled fallback rather than measured spatial truth');
requireText('src/spatial/SpatialPositionedAvatar.tsx', 'final world position', 'rendered geometry must be compensated to the exact shared world coordinate');
requireText('src/spatial/SpatialAvatarLayer.tsx', 'position={node.position}', 'collision layout and rendered avatar must share one resolved position');
requireText('src/services/proximity.service.ts', 'timestamp: peerFixAt', 'proximity freshness must preserve the peer fix timestamp instead of restamping stale coordinates as current');
requireText('src/services/proximity.service.ts', 'STALE_LOCATION_MS = 90 * 1000', 'multi-minute-old coordinates must not remain in the live 40-foot spatial field');
requireText('src/hooks/useHeading.ts', 'vector space', 'device heading smoothing must handle the 359-to-0 wraparound without a visual jump');
requireText('src/hooks/useHeading.ts', 'local-only', 'device heading must remain local and not become persisted movement telemetry');
requireText('src/spatial/SpatialDirectionGuide.ts', 'MAX_DIRECTION_AGE_MS = 45_000', 'participant turn guidance must expire faster than the general live presence window');
requireText('src/spatial/SpatialDirectionGuide.ts', 'does not infer attention, intent, or future trajectory', 'direction guidance must remain observational rather than predictive');
requireText('src/spatial/SpatialSignalIntegrity.ts', 'they never change whether an otherwise-visible person exists', 'confidence visualization must not become a hidden attendee filter');
requireText('src/spatial/SpatialSignalIntegrity.ts', 'keeps no trajectory history', 'spatial confidence must remain latest-signal-only rather than building movement dossiers');
requireText('src/spatial/SpatialSignalIntegrityLayer.tsx', 'Every visible attendee keeps their avatar', 'visual confidence must change the world language, not field membership');
requireText('src/spatial/SpatialContinuityEngine.ts', 'never estimates velocity', 'spatial stabilization must smooth measured jitter without predicting attendee movement');
requireText('src/spatial/SpatialContinuityEngine.ts', 'not persisted, transmitted, or accumulated', 'continuity state must remain session-local and non-dossier');
requireText('src/spatial/SpatialContinuityEngine.ts', 'MAX_AGE_FOR_DAMPING_MS = 45_000', 'stale spatial evidence must not be cosmetically smoothed into looking live');
requireText('src/spatial/useStableSpatialLayout.ts', 'render retries idempotent', 'continuity damping must not compound merely because React retries a render');
requireText('src/spatial/SpatialFieldScreen.tsx', 'useStableSpatialLayout', 'the live field must consume the bounded session-local continuity layer');
requireText('src/spatial/SpatialFieldScreen.tsx', '<SpatialSignalIntegrityLayer', 'the live field must render signal confidence around the same resolved spatial layout');
requireText('src/spatial/SpatialFieldScreen.tsx', 'focusIntegrityMultiplier', 'cinematic focus authority must soften as selected-target evidence weakens');
requireText('src/spatial/AvatarActionSheet.tsx', 'Open Camera Guide', 'focused attendees need an explicit user-initiated handoff from spatial field to camera guidance');
requireText('src/spatial/AvatarActionSheet.tsx', 'does not predict where this person will move', 'camera handoff must state the non-predictive boundary');
requireText('src/spatial/ARFieldScreen.tsx', 'targetId?: string', 'camera guidance must support an explicitly selected attendee rather than random target acquisition');
requireText('src/spatial/ARFieldScreen.tsx', 'VIEW_HALF_ANGLE_DEG = FOV_DEG / 2', 'AR visibility must use the camera half-angle rather than treating full FOV as a one-sided cone');
requireText('src/spatial/ARFieldScreen.tsx', '<SpatialPositionedAvatar', 'camera overlay must render at the computed AR coordinate instead of AvatarRenderer id-derived placement');
requireText('src/spatial/ARFieldScreen.tsx', 'Beacon does not auto-track movement', 'camera guide must keep the user in control instead of chasing people automatically');

for (const path of [
  'src/spatial/SpatialPositionedAvatar.tsx',
  'src/spatial/SpatialDirectionGuide.ts',
  'src/spatial/SpatialSignalIntegrity.ts',
  'src/spatial/SpatialSignalIntegrityLayer.tsx',
  'src/spatial/SpatialContinuityEngine.ts',
  'src/spatial/useStableSpatialLayout.ts',
  'src/hooks/useHeading.ts',
]) {
  forbidText(path, 'Math.random(', 'direction/orientation behavior must remain deterministic');
}

forbidText('src/spatial/SpatialDirectionGuide.ts', 'predicted', 'direction guidance must not expose person-level movement prediction');
forbidText('src/spatial/ARFieldScreen.tsx', 'faceRecognition', 'camera guidance must not drift into identity recognition');

if (failures.length > 0) {
  console.error('Spatial direction architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Spatial direction architecture validation passed (${files.length} required artifacts).`);
