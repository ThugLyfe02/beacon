import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required file: ${path}`);
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

const requiredFiles = [
  'src/presence/SurgeEngine.ts',
  'src/vault/VaultEngine.ts',
  'src/outcomes/OutcomeHandshakeEngine.ts',
  'src/security/SecurityRiskEngine.ts',
  'src/access/VerifiedAccessEngine.ts',
  'src/organizer/OutcomeIntelligenceEngine.ts',
  'src/reliability/RuntimeReliabilityEngine.ts',
  'src/components/RuntimeStatusCard.tsx',
  'src/spatial/OpportunityField.tsx',
  'src/spatial/SpatialExperienceEngine.ts',
  'src/spatial/SpatialSignalLayer.tsx',
  'src/spatial/SpatialLayoutEngine.ts',
  'src/spatial/SpatialAvatarLayer.tsx',
  'src/spatial/SpatialProgressionEngine.ts',
  'src/spatial/SpatialProgressHUD.tsx',
  'src/spatial/SpatialMilestoneLayer.tsx',
  'src/spatial/SpatialContractEngine.ts',
  'src/spatial/SpatialContractHUD.tsx',
  'src/spatial/SpatialDistrictLayer.tsx',
  'src/spatial/SpatialDirectorEngine.ts',
  'src/spatial/SpatialDirectorLayer.tsx',
  'src/spatial/SpatialDirectorHUD.tsx',
  'src/spatial/SpatialWorldIntelligenceEngine.ts',
  'src/spatial/SpatialWorldIntelligenceLayer.tsx',
  'src/spatial/SpatialWorldIntelligenceHUD.tsx',
  'src/spatial/TemporalArchitectureEngine.ts',
  'src/spatial/SpatialInteractionEngine.ts',
  'src/spatial/SpatialInteractionLayer.tsx',
  'src/spatial/SpatialWorldOrchestrator.ts',
  'src/spatial/SpatialNarrativeHUD.tsx',
  'src/spatial/SpatialNavigationEngine.ts',
  'src/spatial/SpatialCameraRig.tsx',
  'src/spatial/SpatialNavigationHUD.tsx',
  'src/spatial/SpatialFocusLayer.tsx',
  'src/spatial/SpatialLandmarkEngine.ts',
  'src/spatial/SpatialLandmarkHUD.tsx',
  'src/spatial/SpatialQualityGovernor.ts',
  'src/spatial/SpatialAttentionEngine.ts',
  'src/spatial/SpatialTourEngine.ts',
  'src/spatial/useSpatialTour.ts',
  'src/spatial/SpatialTourHUD.tsx',
  'src/hooks/useReducedMotionPreference.ts',
  'src/services/world-memory.service.ts',
  'src/screens/MatchesScreen.tsx',
  'supabase/migrations/019_vault_signal_scarcity.sql',
  'supabase/migrations/020_verified_access_protocol.sql',
  'supabase/migrations/021_outcome_intelligence_spine.sql',
  'supabase/migrations/022_security_control_plane.sql',
  'supabase/migrations/023_sensitive_action_transactions.sql',
  'supabase/migrations/024_outcome_handshake_protocol.sql',
  'supabase/migrations/025_outcome_handshake_privacy_boundary.sql',
  'supabase/migrations/026_outcome_conversion_metrics.sql',
  'supabase/migrations/027_secure_connection_activation.sql',
  'supabase/migrations/028_decision_provenance.sql',
  'supabase/migrations/029_spatial_world_memory.sql',
];

for (const path of requiredFiles) read(path);

requireText('src/services/match.service.ts', "rpc('secure_send_connection_request'", 'connection signals must use the atomic secure activation RPC');
forbidText('src/services/match.service.ts', ".from('connection_requests')\n    .insert", 'legacy direct connection-request inserts are not allowed');
requireText('src/services/officeHours.service.ts', "rpc('secure_create_office_hours_request'", 'Office Hours creation must use the atomic security wrapper');
forbidText('src/services/officeHours.service.ts', ".from('office_hours_requests')\n    .insert", 'legacy direct Office Hours inserts are not allowed');
requireText('src/services/access-drop.service.ts', "rpc('secure_claim_access_drop'", 'Access Drop claims must use the atomic security wrapper');
requireText('src/screens/MatchesScreen.tsx', 'OutcomeHandshakeCard', 'Outcome Handshake must be integrated into the mutual surface');
requireText('src/screens/MatchesScreen.tsx', 'buildVaultSummary', 'Vault opportunity memory must be integrated into the mutual surface');

requireText('src/hooks/usePresenceFeed.ts', "AppState.addEventListener('change'", 'live presence must pause and recover with the native app lifecycle');
requireText('src/hooks/usePresenceFeed.ts', 'computeRetryDelayMs', 'live presence must use bounded backoff rather than a fixed retry storm');
requireText('src/hooks/usePresenceFeed.ts', 'shouldDiscardPresence', 'stale proximity must expire instead of remaining falsely live');
forbidText('src/hooks/usePresenceFeed.ts', 'setInterval(', 'presence polling must remain single-flight and self-scheduled');

for (const [text, explanation] of [
  ['<OpportunityField', 'the spatial field must retain aggregate live-state geometry'],
  ['<SpatialSignalLayer', 'the spatial field must retain real target route visualization'],
  ['detailBudget={trustedDetailBudget}', 'route detail must scale down when trust confidence falls'],
  ['<SpatialAvatarLayer', 'all visible avatars must pass through collision-aware layout'],
  ['layout={spatialLayout}', 'camera systems and avatar rendering must share one collision-resolved layout'],
  ['<SpatialFocusLayer', 'explicit person focus must remain physically visible in the world'],
  ['buildSpatialExperience', 'the spatial field must derive its visual hierarchy from live presence state'],
  ['buildSpatialProgression', 'the spatial field must retain verified event-session progression'],
  ['<SpatialMilestoneLayer', 'verified progress must remain visible inside the 3D scene'],
  ['<SpatialProgressHUD', 'the user must receive a clear explanation of live field progress'],
  ['buildSpatialContractBoard', 'the spatial field must retain verified contract progression'],
  ['<SpatialDistrictLayer', 'the adaptive district must remain connected to verified progress'],
  ['buildSpatialDirector', 'the field must retain deterministic world-state direction'],
  ['<SpatialDirectorLayer', 'the director must remain visible inside the 3D scene'],
  ['<SpatialDirectorHUD', 'the current world act must remain explainable to the user'],
  ['buildSpatialWorldIntelligence', 'the field must retain aggregate world learning and prediction'],
  ['<SpatialWorldIntelligenceLayer', 'social emergence and trust must remain visible in the world'],
  ['<SpatialWorldIntelligenceHUD', 'world intelligence must remain explainable rather than subliminal'],
  ['buildTemporalArchitecture', 'event time must change world rules rather than only copy'],
  ['buildSpatialWorldOrchestration', 'major systems must remain causally coupled'],
  ['<SpatialInteractionLayer', 'taps and verified departures must receive physical acknowledgement'],
  ['<SpatialNarrativeHUD', 'temporal and system causality must remain legible'],
  ['detectAlmostDiscoveredMoments', 'near-miss learning must remain grounded in verified field changes'],
  ['buildSpatialNavigation', 'camera behavior must remain policy driven and explainable'],
  ['selectedTargetPosition', 'focus camera must use the collision-resolved avatar position'],
  ['buildSpatialLandmarks', 'aggregate and visible world state must remain navigable'],
  ['buildSpatialQualityState', 'spatial cost must adapt before frame failure'],
  ['buildSpatialAttentionPlan', 'HUD visibility must be governed by an explicit attention budget'],
  ['useSpatialTour', 'the field must retain user-initiated guided scouting'],
  ['<SpatialTourHUD', 'guided scouting must remain visible and controllable'],
  ['useReducedMotionPreference', 'native reduced-motion preference must reach the spatial policy'],
]) requireText('src/spatial/SpatialFieldScreen.tsx', text, explanation);

requireText('src/spatial/OpportunityField.tsx', 'mutualMatches > 0', 'the mutual beacon must remain grounded in a real mutual');
requireText('src/spatial/OpportunityField.tsx', 'depthWrite: false', 'additive field effects must avoid corrupting scene depth');
requireText('src/spatial/SpatialExperienceEngine.ts', 'Every visible attendee remains represented', 'spatial hierarchy must preserve the full visible field');
requireText('src/spatial/SpatialExperienceEngine.ts', "tier: tierForRank", 'spatial detail must be tiered by salience');
forbidText('src/spatial/SpatialExperienceEngine.ts', '.slice(0, 3)', 'spatial experience cannot return to a fixed three-person cap');
requireText('src/spatial/SpatialSignalLayer.tsx', '<AmbientMarker', 'lower-priority attendees must remain represented as ambient markers');
requireText('src/spatial/SpatialSignalLayer.tsx', 'detailBudget', 'route complexity must use an adaptive detail budget');
requireText('src/spatial/SpatialSignalLayer.tsx', 'depthWrite={false}', 'spatial routes must not corrupt avatar scene depth');
requireText('src/spatial/SpatialLayoutEngine.ts', 'collision-aware placement', 'crowded fields must preserve readable avatar separation');
requireText('src/spatial/SpatialLayoutEngine.ts', 'deterministic across refreshes', 'avatar placement must remain stable rather than jumping between polls');
forbidText('src/spatial/SpatialLayoutEngine.ts', 'Math.random(', 'crowded-field layout must remain deterministic');
requireText('src/spatial/SpatialAvatarLayer.tsx', 'layout.map', 'every collision-resolved attendee must remain rendered by the avatar layer');
requireText('src/spatial/SpatialAvatarLayer.tsx', 'precomputed layout', 'rendering must support a layout shared with camera and landmarks');
requireText('src/spatial/SpatialProgressionEngine.ts', 'verifiedActionPoints', 'progression must be grounded in verifiable event actions');
requireText('src/spatial/SpatialProgressionEngine.ts', 'does not use', 'progression must preserve its anti-dark-pattern contract');
forbidText('src/spatial/SpatialProgressionEngine.ts', 'Math.random(', 'progression must remain deterministic and cannot use random rewards');
requireText('src/spatial/SpatialDirectorEngine.ts', 'runtime.health', 'world detail must respond to live runtime reliability');
requireText('src/spatial/SpatialDirectorEngine.ts', 'computeDetailBudget', 'the Director must scale scene detail with field size and reliability');
requireText('src/spatial/SpatialDirectorEngine.ts', 'not a people cap', 'adaptive detail must remain distinct from attendee visibility');
requireText('src/spatial/SpatialDirectorEngine.ts', 'never invents people', 'the spatial director must preserve honest world-state constraints');
forbidText('src/spatial/SpatialDirectorEngine.ts', 'Math.random(', 'world direction must remain deterministic');
requireText('src/spatial/SpatialDirectorLayer.tsx', 'depthWrite={false}', 'director geometry must not corrupt avatar scene depth');
requireText('src/spatial/SpatialWorldIntelligenceEngine.ts', 'predicts opportunity density, never a person', 'forecasting must remain aggregate and non-creepy');
requireText('src/spatial/SpatialWorldIntelligenceEngine.ts', 'sample-size gated', 'historical claims must remain evidence gated');
forbidText('src/spatial/SpatialWorldIntelligenceEngine.ts', 'Math.random(', 'world intelligence must remain deterministic');
requireText('src/spatial/TemporalArchitectureEngine.ts', "'arrival'", 'temporal architecture must preserve an arrival phase');
requireText('src/spatial/TemporalArchitectureEngine.ts', "'reflection'", 'temporal architecture must preserve reflection and handoff');
requireText('src/spatial/TemporalArchitectureEngine.ts', 'availableContractKinds', 'temporal phases must change available objectives');
forbidText('src/spatial/TemporalArchitectureEngine.ts', 'Math.random(', 'temporal world rules must remain deterministic');
requireText('src/spatial/SpatialInteractionEngine.ts', 'does not infer rejection', 'near-miss messaging must avoid manipulative inference');
requireText('src/spatial/SpatialInteractionEngine.ts', 'previousTargets', 'almost-discovered moments must be derived from verified transitions');
forbidText('src/spatial/SpatialInteractionEngine.ts', 'Math.random(', 'micro-interactions and near misses must remain deterministic');
requireText('src/spatial/SpatialInteractionLayer.tsx', 'depthWrite={false}', 'interaction effects must not corrupt scene depth');
requireText('src/spatial/SpatialWorldOrchestrator.ts', 'runtime confidence constrains the Director', 'system coupling must preserve explicit causal direction');
requireText('src/spatial/SpatialWorldOrchestrator.ts', 'vaultGravity', 'live systems must hand unfinished value into the Vault');

requireText('src/spatial/SpatialNavigationEngine.ts', 'never chases private movement', 'camera navigation must preserve its privacy boundary');
requireText('src/spatial/SpatialNavigationEngine.ts', 'selectedTargetPosition', 'focus must address the actual rendered avatar position');
forbidText('src/spatial/SpatialNavigationEngine.ts', 'Math.random(', 'camera composition must remain deterministic');
requireText('src/spatial/SpatialFocusLayer.tsx', 'resolved render position', 'focus geometry must align with crowded-field displacement');
requireText('src/spatial/SpatialLandmarkEngine.ts', 'layoutByTarget', 'mutual landmarks must use collision-resolved positions');
requireText('src/spatial/SpatialQualityGovernor.ts', 'never removes attendees', 'quality adaptation must never become a visibility cap');
requireText('src/spatial/SpatialAttentionEngine.ts', 'rendering every explanation at once', 'HUD orchestration must protect the world from dashboard clutter');
requireText('src/spatial/SpatialAttentionEngine.ts', "tourStatus === 'running'", 'guided scouting must receive a dedicated attention state');
requireText('src/spatial/SpatialTourEngine.ts', 'user-initiated cinematic tour', 'Field Scout must remain explicitly user initiated');
requireText('src/spatial/SpatialTourEngine.ts', 'step budget controls tour length, not world visibility', 'tour length must remain separate from attendee visibility');
forbidText('src/spatial/SpatialTourEngine.ts', 'Math.random(', 'tour sequencing must remain deterministic');
requireText('src/spatial/useSpatialTour.ts', 'never starts or advances unless the user explicitly begins', 'guided scouting cannot become a forced cinematic');
requireText('src/hooks/useReducedMotionPreference.ts', 'reduceMotionChanged', 'spatial motion must respond live to OS accessibility settings');
requireText('.github/workflows/security-gate.yml', "'feature/**'", 'stacked feature branches must receive push-based validation');

requireText('src/services/world-memory.service.ts', 'sample_size < 3', 'immature venue memory must remain hidden');
requireText('supabase/migrations/029_spatial_world_memory.sql', 'No attendee movement trails', 'world memory must preserve its privacy boundary');
requireText('supabase/migrations/029_spatial_world_memory.sql', 'service_role', 'aggregate memory refresh must remain server controlled');

const flags = read('src/config/featureFlags.ts');
for (const enabledFlag of [
  'vault: true',
  'signalScarcity: true',
  'securityControlPlane: true',
  'outcomeHandshakeProtocol: true',
  'decisionProvenance: true',
  'runtimeReliability: true',
  'spatialOpportunityField: true',
  'spatialProgression: true',
  'spatialContracts: true',
  'spatialDistrict: true',
  'spatialDirector: true',
  'spatialWorldIntelligence: true',
  'spatialTemporalNarrative: true',
  'spatialMicroInteractions: true',
  'spatialAlmostDiscovered: true',
  'spatialWorldOrchestration: true',
]) {
  if (!flags.includes(enabledFlag)) failures.push(`src/config/featureFlags.ts: integrated flag must remain enabled: ${enabledFlag}`);
}

const migrationDirectory = join(root, 'supabase', 'migrations');
if (existsSync(migrationDirectory)) {
  const migrationNumbers = readdirSync(migrationDirectory)
    .map((name) => Number.parseInt(name.slice(0, 3), 10))
    .filter(Number.isFinite);
  const duplicates = migrationNumbers.filter((number, index) => migrationNumbers.indexOf(number) !== index);
  if (duplicates.length > 0) failures.push(`Duplicate migration prefixes detected: ${[...new Set(duplicates)].join(', ')}`);
}

if (failures.length > 0) {
  console.error('\nOpportunity architecture validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Opportunity architecture integration contract passed.');
