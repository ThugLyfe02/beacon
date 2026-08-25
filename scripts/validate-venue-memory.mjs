import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required venue-memory file: ${path}`);
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
  'src/spatial/VenuePortfolioMemory.ts',
  'src/services/venue-memory.service.ts',
  'src/services/venue-portfolio.service.ts',
  'src/components/VenueMemoryCard.tsx',
  'src/screens/VenueOperationsScreen.tsx',
  'src/screens/VenuePortfolioScreen.tsx',
  'src/screens/HostManagementScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'supabase/migrations/042_repeat_event_venue_memory.sql',
  'supabase/migrations/043_host_venue_portfolio.sql',
];
for (const path of files) read(path);

requireText('src/spatial/VenuePortfolioMemory.ts', 'compareVenueLearningContexts', 'repeat-event evidence must be scoped through the existing learning-context compatibility policy');
requireText('src/spatial/VenuePortfolioMemory.ts', 'MIN_SAMPLES = 3', 'playbook entries must require repeated measured support');
requireText('src/spatial/VenuePortfolioMemory.ts', 'MIN_EVENTS = 2', 'one event must not be promoted as a repeatable playbook pattern');
requireText('src/spatial/VenuePortfolioMemory.ts', 'mayGrantOperationalAuthority: false', 'historical venue memory must never grant current-event action authority');
requireText('src/spatial/VenuePortfolioMemory.ts', 'current telemetry, release pinning, deployment maturity', 'historical priors must preserve fresh control boundaries');
requireText('src/services/venue-memory.service.ts', ".rpc('get_venue_repeat_event_measurements'", 'historical measurements must come from the server-scoped host-private RPC');
requireText('src/services/venue-memory.service.ts', ".rpc('get_venue_repeat_event_closeouts'", 'portfolio closeouts must come from the server-scoped host-private RPC');
requireText('src/services/venue-portfolio.service.ts', ".rpc('get_host_venue_portfolio'", 'portfolio analytics must be derived by a server function bound to auth.uid()');
requireText('src/services/venue-portfolio.service.ts', ".rpc('has_hosted_event_history'", 'host workspace persistence must use server-owned event history state');
requireText('src/components/VenueMemoryCard.tsx', 'No cross-customer benchmark', 'host UI must make the portfolio privacy boundary explicit');
requireText('src/components/VenueMemoryCard.tsx', 'It cannot make an intervention action-ready', 'UI must not imply that history authorizes a live intervention');
requireText('src/screens/VenueOperationsScreen.tsx', '<VenueMemoryCard', 'repeat-event memory must be reachable in the host venue operations surface');
requireText('src/screens/VenuePortfolioScreen.tsx', "navigation.navigate('VenueOperations'", 'portfolio must let a host inspect the latest preserved closeout');
requireText('src/screens/VenuePortfolioScreen.tsx', 'not an anonymous competitor leaderboard', 'portfolio UI must explicitly reject covert cross-customer comparison');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('VenuePortfolio'", 'host workspace must expose the post-event portfolio');
requireText('src/screens/HostManagementScreen.tsx', 'The live room is closed. The value is not.', 'host workspace must remain useful after live closure');
requireText('src/navigation/RootNavigator.tsx', 'hasHostedEventHistory', 'Host tab eligibility must persist for users with historical hosted events');
requireText('src/navigation/RootNavigator.tsx', 'VenuePortfolioScreen', 'venue portfolio must be reachable from the root stack');
requireText('supabase/migrations/042_repeat_event_venue_memory.sql', 'he.host_id = v_host_id', 'historical evidence must be restricted to events owned by the same host');
requireText('supabase/migrations/042_repeat_event_venue_memory.sql', 'he.id <> p_event_id', 'the current event must not be recycled as historical evidence');
requireText('supabase/migrations/042_repeat_event_venue_memory.sql', 'he.ended_at is not null', 'only ended events may contribute repeat-event memory');
requireText('supabase/migrations/042_repeat_event_venue_memory.sql', 'm.learning_context_key = hc.context_key', 'measured outcomes must remain bound to their recorded learning context');
requireText('supabase/migrations/042_repeat_event_venue_memory.sql', 'No cross-customer benchmark is exposed', 'server contract must state that competitor/cross-customer benchmarking is not released');
requireText('supabase/migrations/043_host_venue_portfolio.sql', 'where e.host_id = auth.uid()', 'host portfolio must be server-scoped to the authenticated owner');
requireText('supabase/migrations/043_host_venue_portfolio.sql', 'This is not a', 'portfolio migration must preserve the non-cross-customer boundary');
requireText('supabase/migrations/043_host_venue_portfolio.sql', 'trend_delta', 'portfolio must expose repeat-event directional change rather than only lifetime totals');

for (const path of files.filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))) {
  forbidText(path, 'Math.random(', 'repeat-event memory must remain deterministic and reviewable');
  forbidText(path, 'personId', 'repeat-event memory must not introduce identity-linked attendee history');
  forbidText(path, 'targetId', 'repeat-event memory must not repurpose attendee identifiers');
}

if (failures.length > 0) {
  console.error('Venue memory architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Venue memory architecture validation passed (${files.length} required artifacts).`);
