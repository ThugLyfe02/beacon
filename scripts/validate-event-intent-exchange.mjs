import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required declared-intent file: ${path}`);
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

const migration = 'supabase/migrations/048_declared_event_intent_exchange.sql';
const outcomeMigration = 'supabase/migrations/049_declared_fit_mutual_outcomes.sql';
const files = [
  migration,
  outcomeMigration,
  'src/services/event-intent.service.ts',
  'src/screens/EventIntentScreen.tsx',
  'src/screens/EventIntentMixScreen.tsx',
  'src/screens/EventLobbyScreen.tsx',
  'src/screens/HostManagementScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/presence/PresenceEngine.ts',
  'src/hooks/usePresenceFeed.ts',
  'src/spatial/SpatialExperienceEngine.ts',
  'src/spatial/SpatialSignalLayer.tsx',
  'src/spatial/SpatialLandmarkEngine.ts',
  'src/spatial/SpatialLandmarkHUD.tsx',
  'src/spatial/AvatarActionSheet.tsx',
];
for (const path of files) read(path);

requireText(migration, 'participant_event_intents', 'event-scoped explicit seeking/offering state must have a durable server-owned contract');
requireText(migration, 'cardinality(seeking) <= 6', 'participants need a bounded declared-intent surface rather than unbounded profiling');
requireText(migration, 'cardinality(offering) <= 6', 'participants need a bounded declared-capability surface rather than unbounded profiling');
requireText(migration, 'seeking <@ array[', 'the durable table must reject domains outside the reviewed declared-intent vocabulary');
requireText(migration, 'offering <@ array[', 'the durable table must reject unreviewed declared-capability domains');
requireText(migration, 'using (user_id = auth.uid())', 'direct declaration reads must remain caller-owned');
requireText(migration, 'revoke insert, update, delete on public.participant_event_intents from authenticated', 'mobile clients must mutate declarations through the scoped RPC rather than direct rows');
requireText(migration, 'public.is_event_operational(p_event_id)', 'declared fit must respect the live event lifecycle');
requireText(migration, "ep.status = 'approved'", 'declared fit must be limited to approved event participants');
requireText(migration, 'p_target_user_ids uuid[]', 'pairwise fit release must be bounded to caller-supplied live-field targets rather than event-wide enumeration');
requireText(migration, 'limit 128', 'declared-fit target scope must remain server bounded');
requireText(migration, 'i.user_id = any(v_target_user_ids)', 'peer fit evaluation must remain restricted to the bounded current target set');
requireText(migration, 'u.is_discoverable = true', 'declared fit must preserve participant discoverability choice');
requireText(migration, 'public.user_blocks', 'declared fit must preserve bilateral block boundaries');
requireText(migration, 'they_can_help_with', 'peer release must be intersection-shaped rather than a complete intent profile');
requireText(migration, 'i_can_help_with', 'peer release must expose only the caller-relevant reverse intersection');
requireText(migration, 'Full peer declarations are never released', 'the server contract must explicitly reject full peer intent disclosure');
requireText(migration, 'not public.is_event_host(p_event_id, auth.uid())', 'host demand mix must be host scoped on the server');
requireText(migration, 'where c.contributor_count >= 5', 'host demand categories must use minimum-cohort suppression');
requireText(migration, 'never returns participant identities', 'host demand reporting must preserve the aggregate-only boundary');
requireText(migration, 'does not reveal full peer declarations, popularity, or inferred private intent', 'declared fit must not become a popularity or inferred-intent score');

requireText(outcomeMigration, 'declared_fit_mutual_contexts', 'real mutual outcomes need server-private declared-fit context for aggregate learning');
requireText(outcomeMigration, 'after insert on public.matches', 'declared-fit outcome context must be captured from the real mutual creation boundary');
requireText(outcomeMigration, 'revoke all on public.declared_fit_mutual_contexts from authenticated, anon', 'organizers and participants must never read raw mutual-pair context rows');
requireText(outcomeMigration, "fit_class in ('none','one-way','two-way')", 'mutual outcome context must use bounded explainable fit classes');
requireText(outcomeMigration, 'if coalesce(v_total, 0) < 5', 'mutual outcome summary must suppress small cohorts');
requireText(outcomeMigration, 'where g.mutual_match_count >= 5', 'domain-level mutual outcome composition must suppress small cohorts');
requireText(outcomeMigration, 'not a pairwise exposure conversion rate', 'mutual composition must not be mislabeled as conversion without an exposure denominator');
requireText(outcomeMigration, 'no participant identities', 'host mutual-domain release must remain aggregate-only');

requireText('src/services/event-intent.service.ts', ".rpc('get_event_declared_fit'", 'pairwise fit must use the server intersection RPC');
requireText('src/services/event-intent.service.ts', 'liveTargetUserIds', 'client fit requests must start from the already-visible live field');
requireText('src/services/event-intent.service.ts', 'cannot be used as an event-wide fit directory', 'service documentation must preserve data minimization');
requireText('src/services/event-intent.service.ts', ".rpc('get_event_intent_mix'", 'host demand mix must use the host-scoped server RPC');
requireText('src/services/event-intent.service.ts', ".rpc('get_declared_fit_mutual_summary'", 'host outcome composition must use a cohort-gated server RPC');
requireText('src/services/event-intent.service.ts', ".rpc('get_declared_fit_mutual_domains'", 'host mutual-domain composition must use a cohort-gated server RPC');
requireText('src/services/event-intent.service.ts', 'does not call itself a conversion rate', 'client semantics must preserve outcome-composition versus conversion distinction');
requireText('src/services/event-intent.service.ts', 'never fetches another participant', 'service documentation must preserve the intersection-only peer boundary');
forbidText('src/services/event-intent.service.ts', ".from('participant_event_intents')", 'client services must not read peer declaration rows directly');
forbidText('src/services/event-intent.service.ts', ".from('declared_fit_mutual_contexts')", 'client services must not read raw mutual-pair outcome context');

requireText('src/screens/EventIntentScreen.tsx', 'It does not infer private intent from clicks, dwell time, profile views, or movement', 'participant editor must explain that declared fit is explicit rather than behavioral inference');
requireText('src/screens/EventIntentScreen.tsx', 'Only the intersection that is relevant to you', 'participant editor must explain the pairwise disclosure boundary');
requireText('src/screens/EventIntentMixScreen.tsx', 'at least five approved participants', 'host UI must explain small-cohort suppression');
requireText('src/screens/EventIntentMixScreen.tsx', 'outcome composition, not a conversion rate', 'host mutual analytics must not overclaim causal or funnel semantics');
requireText('src/screens/EventIntentMixScreen.tsx', 'not a participant list, popularity score, lead score, or cross-customer benchmark', 'host UI must reject person-ranking and covert benchmark semantics');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('EventIntentMix'", 'declared aggregate demand must be reachable from the active host workspace');
requireText('src/navigation/RootNavigator.tsx', 'EventIntentScreen', 'participant event-focus editor must be root-routable');
requireText('src/navigation/RootNavigator.tsx', 'EventIntentMixScreen', 'host declared-demand surface must be root-routable');
requireText('src/screens/EventLobbyScreen.tsx', 'YOUR EVENT FOCUS', 'participants need a live entry point into explicit event focus');
requireText('src/screens/EventLobbyScreen.tsx', 'declared fits nearby', 'live event utility should expose private pairwise fit rather than another premium count');

requireText('src/presence/PresenceEngine.ts', 'declaredFitStrength', 'pairwise fit must be carried explicitly rather than smuggled into an opaque score');
requireText('src/presence/PresenceEngine.ts', 'not inferred from clicks, movement, dwell', 'presence schema must preserve the non-behavioral origin of declared fit');
requireText('src/hooks/usePresenceFeed.ts', 'DECLARED_FIT_REFRESH_MS = 30_000', 'declared fit should use a lower-cost cadence than core physical proximity');
requireText('src/hooks/usePresenceFeed.ts', 'targetSetKey(signals)', 'declared fit refresh must track the live physical target set');
requireText('src/hooks/usePresenceFeed.ts', 'signals.map((signal) => signal.targetId)', 'client must request fit only for targets already observed by physical proximity');
requireText('src/hooks/usePresenceFeed.ts', 'metadata RPC failure must never', 'optional fit enrichment must not become a reliability dependency for the physical field');
requireText('src/hooks/usePresenceFeed.ts', 'mergeDeclaredFit', 'live physical signals must receive pairwise fit only after the independent server projection succeeds');

requireText('src/spatial/SpatialExperienceEngine.ts', "'declared-fit'", 'explicit pairwise fit must be a first-class explainable spatial salience reason');
requireText('src/spatial/SpatialExperienceEngine.ts', 'never becomes a public popularity', 'spatial ranking must preserve the private pairwise boundary');
requireText('src/spatial/SpatialSignalLayer.tsx', "focus.reason === 'declared-fit'", 'declared fit should be visually legible in the world rather than trapped in a list');
requireText('src/spatial/SpatialSignalLayer.tsx', 'not a popularity score', 'declared-fit rendering must preserve private pairwise semantics');
requireText('src/spatial/SpatialLandmarkEngine.ts', "'declared-fit'", 'explicit fit must be camera-addressable through the same landmark/Field Scout system as other explainable world state');
requireText('src/spatial/SpatialLandmarkEngine.ts', 'do not reveal a peer\'s full declaration', 'declared-fit landmarks must preserve intersection-only evidence semantics');
requireText('src/spatial/SpatialLandmarkEngine.ts', 'evidenceLabel', 'categorical verified evidence must not be mislabeled as a probabilistic confidence score');
requireText('src/spatial/SpatialLandmarkHUD.tsx', 'state.active.evidenceLabel', 'landmark UI must distinguish verified categorical evidence from aggregate confidence');
requireText('src/spatial/AvatarActionSheet.tsx', 'DECLARED FIT', 'selected-person UI must explain the evidence behind a fit');
requireText('src/spatial/AvatarActionSheet.tsx', 'does not reveal their full declaration', 'selected-person UI must preserve the peer disclosure boundary');

for (const path of [
  'src/services/event-intent.service.ts',
  'src/spatial/SpatialExperienceEngine.ts',
  'src/spatial/SpatialSignalLayer.tsx',
  'src/spatial/SpatialLandmarkEngine.ts',
]) {
  forbidText(path, 'Math.random(', 'declared-fit semantics must remain deterministic and reviewable');
}

for (const path of [
  'src/services/event-intent.service.ts',
  'src/screens/EventIntentMixScreen.tsx',
]) {
  forbidText(path, 'targetPremium', 'declared demand/fit must not be privileged by payment status');
}

if (failures.length > 0) {
  console.error('Declared event intent architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Declared event intent architecture validation passed (${files.length} required artifacts).`);
