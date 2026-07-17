import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing protected file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireAll(relativePath, needles, label) {
  const content = read(relativePath);
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`${label}: ${relativePath} no longer contains ${JSON.stringify(needle)}`);
    }
  }
}

const protectedFiles = [
  'src/screens/MapScreen.tsx',
  'src/screens/MatchesScreen.tsx',
  'src/screens/EventLobbyScreen.tsx',
  'src/screens/OfficeHoursRequestScreen.tsx',
  'src/screens/OfficeHoursInboxScreen.tsx',
  'src/screens/OfficeHoursCallScreen.tsx',
  'src/spatial/SpatialFieldScreen.tsx',
  'src/spatial/ARFieldScreen.tsx',
  'src/screens/ChooseAvatarScreen.tsx',
  'src/services/event.service.ts',
  'src/services/match.service.ts',
  'src/services/officeHours.service.ts',
  'src/services/outcome-handshake.service.ts',
  'src/services/vault.service.ts',
];

for (const file of protectedFiles) read(file);

requireAll('src/screens/MapScreen.tsx', [
  "navigation.navigate('JoinEvent')",
  "navigation.navigate('CreateEvent')",
  "navigation.navigate('Radar'",
  '<PremiumDrawer',
  'watchLocation',
  'getNearbyPremium',
], 'Map journey regression');

requireAll('src/screens/MatchesScreen.tsx', [
  '<OutcomeHandshakeCard',
  'PRIVATE VAULT',
  "navigation.navigate('OfficeHoursInbox')",
  'completeVaultEntry',
], 'Mutual and Vault journey regression');

requireAll('src/screens/EventLobbyScreen.tsx', [
  'OpportunityWindowBanner',
  'useOpportunityIntelligence',
], 'Opportunity intelligence regression');

requireAll('src/services/event.service.ts', [
  'export async function createEvent',
  'export async function updateEvent',
  'export async function deleteEvent',
  'export async function getEventByCode',
  'export async function getUserEvents',
  'export async function getHostedEvent',
  'eventPriority',
  'latitude: eventData.latitude ?? null',
], 'Event lifecycle regression');

requireAll('src/services/match.service.ts', [
  'secure_send_connection_request',
], 'Secure mutual activation regression');

requireAll('src/services/officeHours.service.ts', [
  'secure_create_office_hours_request',
], 'Secure Office Hours regression');

requireAll('src/services/outcome-handshake.service.ts', [
  'propose_outcome_handshake',
  'complete_outcome_handshake',
  'recordDecisionProvenance',
], 'Outcome privacy and provenance regression');

requireAll('src/config/featureFlags.ts', [
  'vault: true',
  'signalScarcity: true',
  'securityControlPlane: true',
  'outcomeHandshakeProtocol: true',
  'decisionProvenance: true',
], 'Integrated feature flag regression');

const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const requiredMigrationPrefixes = ['019_', '020_', '021_', '022_', '023_', '024_', '025_', '026_', '027_', '028_'];
for (const prefix of requiredMigrationPrefixes) {
  if (!migrations.some((file) => file.startsWith(prefix))) {
    failures.push(`Missing protected migration prefix: ${prefix}`);
  }
}

if (failures.length > 0) {
  console.error('\nBeacon product preservation contract failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Beacon product preservation contract passed (${protectedFiles.length} protected files, ${requiredMigrationPrefixes.length} migrations).`);
