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
  'src/spatial/SpatialProgressionEngine.ts',
  'src/spatial/SpatialProgressHUD.tsx',
  'src/spatial/SpatialMilestoneLayer.tsx',
  'src/spatial/SpatialContractEngine.ts',
  'src/spatial/SpatialContractHUD.tsx',
  'src/spatial/SpatialDistrictLayer.tsx',
  'src/spatial/SpatialDirectorEngine.ts',
  'src/spatial/SpatialDirectorLayer.tsx',
  'src/spatial/SpatialDirectorHUD.tsx',
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
  ['buildSpatialExperience', 'the spatial field must derive its visual hierarchy from live presence state'],
  ['buildSpatialProgression', 'the spatial field must retain verified event-session progression'],
  ['<SpatialMilestoneLayer', 'verified progress must remain visible inside the 3D scene'],
  ['<SpatialProgressHUD', 'the user must receive a clear explanation of live field progress'],
  ['buildSpatialContractBoard', 'the spatial field must retain verified contract progression'],
  ['<SpatialDistrictLayer', 'the adaptive district must remain connected to verified progress'],
  ['buildSpatialDirector', 'the field must retain deterministic world-state direction'],
  ['<SpatialDirectorLayer', 'the director must remain visible inside the 3D scene'],
  ['<SpatialDirectorHUD', 'the current world act must remain explainable to the user'],
]) requireText('src/spatial/SpatialFieldScreen.tsx', text, explanation);

requireText('src/spatial/OpportunityField.tsx', 'mutualMatches > 0', 'the mutual beacon must remain grounded in a real mutual');
requireText('src/spatial/OpportunityField.tsx', 'depthWrite: false', 'additive field effects must avoid corrupting scene depth');
requireText('src/spatial/SpatialExperienceEngine.ts', '.slice(0, 3)', 'spatial prioritization must remain intentionally restrained');
requireText('src/spatial/SpatialExperienceEngine.ts', 'never fabricates demand', 'spatial experience must preserve honest urgency constraints');
requireText('src/spatial/SpatialSignalLayer.tsx', 'depthWrite={false}', 'spatial routes must not corrupt avatar scene depth');
requireText('src/spatial/SpatialProgressionEngine.ts', 'verifiedActionPoints', 'progression must be grounded in verifiable event actions');
requireText('src/spatial/SpatialProgressionEngine.ts', 'does not use', 'progression must preserve its anti-dark-pattern contract');
forbidText('src/spatial/SpatialProgressionEngine.ts', 'Math.random(', 'progression must remain deterministic and cannot use random rewards');
requireText('src/spatial/SpatialDirectorEngine.ts', 'runtime.health', 'world detail must respond to live runtime reliability');
requireText('src/spatial/SpatialDirectorEngine.ts', 'never invents people', 'the spatial director must preserve honest world-state constraints');
forbidText('src/spatial/SpatialDirectorEngine.ts', 'Math.random(', 'world direction must remain deterministic');
requireText('src/spatial/SpatialDirectorLayer.tsx', 'depthWrite={false}', 'director geometry must not corrupt avatar scene depth');

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
