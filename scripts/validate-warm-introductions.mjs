import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required warm-introduction artifact: ${path}`);
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

const protocolMigration = 'supabase/migrations/052_warm_introductions.sql';
const liveScopeMigration = 'supabase/migrations/053_warm_introduction_live_scope.sql';
const disclosureMigration = 'supabase/migrations/054_warm_introduction_live_disclosure.sql';
const service = 'src/services/warm-introduction.service.ts';
const preferenceCard = 'src/components/WarmIntroductionPreferenceCard.tsx';
const requestCard = 'src/components/WarmIntroductionRequestCard.tsx';
const preview = 'src/components/IntroductionInboxPreview.tsx';
const inbox = 'src/screens/IntroductionInboxScreen.tsx';
const evidenceCard = 'src/components/IntroductionEvidenceCard.tsx';
const docs = 'docs/WARM_INTRODUCTIONS.md';

const files = [
  protocolMigration,
  liveScopeMigration,
  disclosureMigration,
  service,
  preferenceCard,
  requestCard,
  preview,
  inbox,
  evidenceCard,
  docs,
  'src/spatial/AvatarActionSheet.tsx',
  'src/screens/EventIntentScreen.tsx',
  'src/screens/EventLobbyScreen.tsx',
  'src/screens/EventIntentMixScreen.tsx',
  'src/navigation/RootNavigator.tsx',
];
for (const path of files) read(path);

// Durable protocol and finite state.
requireText(protocolMigration, 'event_introduction_preferences', 'connector availability must be explicit, event scoped, and durable');
requireText(protocolMigration, 'event_introduction_requests', 'three-party introduction state must have a durable server-owned contract');
requireText(protocolMigration, "max_active between 1 and 4", 'connector workload must remain participant-bounded');
requireText(protocolMigration, "'connector-pending'", 'connector consent must be an explicit protocol state');
requireText(protocolMigration, "'target-pending'", 'target consent must occur only after connector consent');
requireText(protocolMigration, "'accepted'", 'accepted introductions need a distinct state before a real match');
requireText(protocolMigration, "'matched'", 'the protocol must distinguish consent from a real mutual outcome');
requireText(protocolMigration, 'requester_id <> connector_id', 'requester and connector must be different participants');
requireText(protocolMigration, 'requester_id <> target_id', 'requester and target must be different participants');
requireText(protocolMigration, 'connector_id <> target_id', 'connector and target must be different participants');
requireText(protocolMigration, 'one_active_pair', 'duplicate active requester-target routes must be prevented at the database boundary');

// Explicit connector opt in and bounded graph use.
requireText(protocolMigration, 'set_my_introduction_preference', 'participants need a scoped RPC to opt into connector work');
requireText(protocolMigration, 'get_my_introduction_preference', 'participants need a caller-owned preference projection');
requireText(protocolMigration, 'pref.enabled = true', 'connector selection must require explicit current-event opt in');
requireText(protocolMigration, "load.active_count < pref.max_active", 'connector selection must respect the participant-selected workload cap');
requireText(protocolMigration, 'event_introduction_pair_matched(p_event_id, p_requester_id, pref.user_id)', 'the connector must have a verified mutual with the requester');
requireText(protocolMigration, 'event_introduction_pair_matched(p_event_id, pref.user_id, p_target_id)', 'the connector must have a verified mutual with the target');
requireText(protocolMigration, 'not public.event_introduction_pair_blocked(p_requester_id, pref.user_id)', 'requester-connector blocks must prevent routing');
requireText(protocolMigration, 'not public.event_introduction_pair_blocked(pref.user_id, p_target_id)', 'connector-target blocks must prevent routing');
requireText(liveScopeMigration, 'md5(pref.user_id::text', 'equally loaded connectors should use stable pair-derived distribution rather than popularity');
forbidText(protocolMigration, 'is_premium', 'payment status must not influence connector eligibility');
forbidText(liveScopeMigration, 'is_premium', 'payment status must not influence live connector selection');
forbidText(protocolMigration, 'follower', 'warm introductions must not introduce a social popularity graph');
forbidText(protocolMigration, 'graph_degree', 'warm introductions must not calculate public or private graph-degree authority');

// Live physical admission and anti-enumeration.
requireText(liveScopeMigration, 'event_introduction_pair_in_live_field', 'request admission must be backed by a server-side live-field proof');
requireText(liveScopeMigration, "now() - interval '90 seconds'", 'requester, target, and connector evidence must expire when location fixes go stale');
requireText(liveScopeMigration, '* 0.3048', 'the physical boundary must convert the bounded foot radius into meters explicitly');
requireText(liveScopeMigration, 'p_max_distance_feet', 'the live-field radius must be explicit and bounded');
requireText(liveScopeMigration, "new.requester_id <> auth.uid()", 'a modified client must not submit a request on behalf of another participant');
requireText(liveScopeMigration, 'before insert on public.event_introduction_requests', 'live-field and safety checks must be enforced at the durable insertion boundary');
requireText(liveScopeMigration, 'current live field', 'rejected outside-field requests must be represented as a physical-boundary failure');
requireText(disclosureMigration, 'event_introduction_pair_in_live_field', 'availability and fit disclosure must inherit the physical admission boundary');
requireText(disclosureMigration, "'target-unavailable'", 'outside-field targets must not release separate fit or graph evidence');
requireText(disclosureMigration, 'Outside-field callers receive no domains', 'pairwise declared-fit disclosure must not become event-wide enumeration');
requireText(disclosureMigration, 'releases no connector identity', 'availability must not reveal connector identity or candidate graph structure');

// Pairwise declared-fit reason and no free-form solicitation.
requireText(protocolMigration, 'event_introduction_domains', 'request reasons must come from the existing explicit pairwise fit');
requireText(protocolMigration, 'v_intent_key = any(v_domains)', 'the chosen introduction domain must be server-verified against the current intersection');
requireText(protocolMigration, 'no connector list, graph-degree score, free-text pitch', 'the server contract must explicitly reject graph exposure and unsolicited free text');
forbidText(protocolMigration, 'pitch text', 'the protocol must not add an unbounded pitch field');
forbidText(protocolMigration, 'message_body', 'the protocol must not become an unsolicited message channel');

// Sequential consent and disclosure timing.
requireText(protocolMigration, "status = case when coalesce(p_accept, false) then 'target-pending'", 'connector acceptance must move to target decision rather than opening the introduction');
requireText(protocolMigration, "auth.uid() = v_request.target_id", 'only the target may make the final target decision');
requireText(protocolMigration, "status = 'accepted'", 'target acceptance must produce an explicit open-introduction state');
requireText(protocolMigration, "not (auth.uid() = r.target_id and r.status = 'connector-pending')", 'the target must not see a request before connector consent');
requireText(protocolMigration, "r.status in ('target-pending','accepted','matched')", 'requesters should learn connector identity only after connector acceptance');
requireText(protocolMigration, 'only the assigned connector or target may respond', 'unrelated participants must not mutate introduction consent');
requireText(protocolMigration, 'cancel_my_warm_introduction', 'the requester must retain a cancellation path while decisions are pending');

// No automatic connection; ordinary Beacon actions remain authoritative.
requireText(protocolMigration, 'mark_warm_introduction_after_match', 'the protocol should observe a real match after it occurs');
requireText(protocolMigration, 'after insert on public.matches', 'match attribution must be downstream of the existing verified mutual boundary');
forbidText(protocolMigration, 'insert into public.matches', 'warm introduction acceptance must never fabricate a match');
forbidText(protocolMigration, 'insert into public.connection_requests', 'warm introduction acceptance must not bypass the ordinary signal path');
requireText(inbox, 'sendConnectionRequest', 'accepted introductions must reuse the ordinary connection-signal service');
requireText(inbox, "navigation.navigate('OfficeHoursRequest'", 'accepted introductions must reuse the existing Office Hours path');
requireText(inbox, 'No connection was created automatically', 'participant UI must make the non-automatic boundary explicit');

// Vault and lifecycle.
requireText(protocolMigration, "'Warm introduction accepted'", 'accepted routes should become participant-owned next actions');
requireText(protocolMigration, "jsonb_build_object('origin', 'warm-introduction'", 'Vault entries need explicit origin metadata');
requireText(protocolMigration, 'expire_warm_introductions_after_event_end', 'pending introductions must lose live authority when the event ends');
requireText(protocolMigration, "r.status in ('connector-pending','target-pending')", 'event close must expire unresolved consent requests');
requireText(protocolMigration, "where v.source_id = any(v_request_ids)", 'a resulting real mutual should complete the associated Vault action');

// Scoped client service; no raw graph-table reads.
requireText(service, ".rpc('get_warm_introduction_availability'", 'selected-person availability must use the scoped server projection');
requireText(service, ".rpc('request_warm_introduction'", 'request creation must use the scoped server RPC');
requireText(service, ".rpc('get_my_event_introductions'", 'inbox reads must use the role-aware server projection');
requireText(service, ".rpc('respond_to_warm_introduction'", 'connector and target decisions must use the server state machine');
requireText(service, ".rpc('cancel_my_warm_introduction'", 'requester cancellation must use the scoped server path');
requireText(service, ".rpc('get_event_introduction_summary'", 'host evidence must use a host-scoped cohort-gated projection');
forbidText(service, ".from('event_introduction_requests')", 'mobile code must never read the raw three-party request table');
forbidText(service, ".from('event_introduction_preferences')", 'mobile code must never enumerate connector preference rows');

// Functional participant integration.
requireText(preferenceCard, 'Open to introducing people?', 'participants need a clear explicit connector opt-in surface');
requireText(preferenceCard, 'Your identity stays hidden until you accept one specific introduction', 'preference UI must explain delayed connector disclosure');
requireText(preferenceCard, 'SIMULTANEOUS REQUESTS', 'connector workload must be configurable in the participant UI');
requireText(requestCard, 'A verified mutual can open this conversation', 'the selected-person UI needs a functional warm-introduction action');
requireText(requestCard, 'You will not see who it is unless they accept', 'requester UI must explain connector privacy');
requireText(requestCard, 'No connection is created automatically', 'request UI must preserve independent downstream consent');
requireText(preview, "navigation.navigate('IntroductionInbox'", 'the live event lobby needs an entry point into active introduction work');
requireText(inbox, 'Warm introductions with three real decisions', 'the inbox must explain the sequential consent model');
requireText(inbox, 'NEEDS YOUR DECISION', 'connector and target decisions must be operationally prominent');
requireText(inbox, 'Beacon never exposes a connector list', 'inbox UI must preserve graph privacy');
requireText(inbox, 'private decline reason', 'inbox UI must explain that decline explanations are not exposed');
requireText('src/spatial/AvatarActionSheet.tsx', '<WarmIntroductionRequestCard', 'warm introductions must be reachable from a current declared-fit target');
requireText('src/screens/EventIntentScreen.tsx', '<WarmIntroductionPreferenceCard', 'connector opt in must be reachable from the participant event-focus surface');
requireText('src/screens/EventLobbyScreen.tsx', '<IntroductionInboxPreview', 'active introductions must remain visible during the live event');
requireText('src/navigation/RootNavigator.tsx', 'IntroductionInboxScreen', 'the full introduction inbox must be routable');

// Host evidence with true denominators and cohort protection.
requireText(protocolMigration, 'if coalesce(v_total, 0) < 5', 'host introduction evidence must suppress small cohorts');
requireText(protocolMigration, 'v_connector_accepts::numeric / greatest(1, v_total)', 'connector acceptance needs the persisted request denominator');
requireText(protocolMigration, 'v_target_accepts::numeric / greatest(1, v_connector_accepts)', 'target acceptance needs the persisted connector-accept denominator');
requireText(protocolMigration, 'v_matched::numeric / greatest(1, v_target_accepts)', 'match-after-acceptance needs the persisted accepted-introduction denominator');
requireText(protocolMigration, 'where g.request_count >= 5', 'domain evidence must have its own minimum cohort');
requireText(evidenceCard, 'persisted protocol states with explicit denominators', 'host UI must explain why the rates are defensible');
requireText(evidenceCard, 'never the identities or connection graph', 'host UI must preserve the aggregate-only boundary');
requireText(evidenceCard, 'is not an endorsement', 'host UI must not overclaim connector consent or resulting mutuals');
requireText('src/screens/EventIntentMixScreen.tsx', '<IntroductionEvidenceCard', 'host declared-demand view must connect trusted routing to cohort-gated outcomes');

// No artificial ranking or stochastic behavior.
for (const path of [
  protocolMigration,
  liveScopeMigration,
  disclosureMigration,
  service,
  preferenceCard,
  requestCard,
  preview,
  inbox,
  evidenceCard,
]) {
  forbidText(path, 'Math.random(', 'warm-introduction selection and product semantics must remain deterministic');
  forbidText(path, 'targetPremium', 'payment status must not affect introduction availability, routing, or consent');
  forbidText(path, 'influence score', 'warm introductions must not become a connector influence ranking');
  forbidText(path, 'connector leaderboard', 'warm introductions must not create public connector competition');
}

requireText(docs, 'The requester does not learn the connector', 'documentation must preserve delayed connector disclosure');
requireText(docs, 'does not create a match automatically', 'documentation must preserve the ordinary mutual boundary');
requireText(docs, 'actual persisted protocol denominators', 'documentation must distinguish measured rates from invented analytics');
requireText(docs, 'not an endorsement', 'documentation must preserve the interpretation boundary');
requireText(docs, 'Database integration', 'the feature must carry an explicit multi-user integration test plan');

if (failures.length > 0) {
  console.error('Warm introduction architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Warm introduction architecture validation passed (${files.length} required artifacts).`);
