import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required focus-window file: ${path}`);
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

const migration = 'supabase/migrations/050_event_focus_windows.sql';
const files = [
  migration,
  'src/services/event-focus-window.service.ts',
  'src/components/EventFocusWindowCard.tsx',
  'src/components/HostFocusWindowPanel.tsx',
  'src/spatial/EventIntentProgramming.ts',
  'src/screens/EventLobbyScreen.tsx',
  'src/screens/EventIntentMixScreen.tsx',
];
for (const path of files) read(path);

requireText(migration, 'event_focus_windows', 'focus windows need durable server-owned event-scoped state');
requireText(migration, 'event_focus_window_opt_ins', 'participant enrollment must remain an explicit separate action');
requireText(migration, "capacity between 4 and 80", 'published capacity must represent a bounded real operating constraint');
requireText(migration, "ends_at <= starts_at + interval '90 minutes'", 'focus windows must remain time bounded');
requireText(migration, 'revoke all on public.event_focus_windows from authenticated, anon', 'clients must consume scoped projections rather than raw focus-window rows');
requireText(migration, 'revoke all on public.event_focus_window_opt_ins from authenticated, anon', 'participant opt-in rows must never become a client-readable roster');
requireText(migration, 'public.is_event_host(p_event_id, auth.uid())', 'only the event host may publish a focus window');
requireText(migration, 'public.is_event_operational(p_event_id)', 'focus-window publication and participant discovery must respect event lifecycle');
requireText(migration, 'v_supported_contributors < 5', 'publication must require a released cohort rather than a small declared-intent group');
requireText(migration, 'v_open_windows >= 12', 'the host cannot create an unbounded attention surface');
requireText(migration, 'w.intent_key = any(m.seeking)', 'participant projection must be scoped to the caller’s explicit event focus');
requireText(migration, 'w.intent_key = any(m.offering)', 'participant projection must support explicitly declared supply as well as need');
requireText(migration, "ep.status = 'approved'", 'focus-window access must be limited to approved event participants');
requireText(migration, 'for update;', 'capacity admission must serialize against the current window state');
requireText(migration, 'v_joined_count >= v_window.capacity', 'real capacity must be enforced by the server');
requireText(migration, 'get_host_event_focus_windows', 'hosts need an aggregate operational view of published windows');
requireText(migration, 'count(o.user_id)::integer', 'host window status may expose aggregate opt-in count only');
requireText(migration, 'c.opt_in_count >= 5', 'window outcomes must remain suppressed below the minimum cohort');
requireText(migration, "m.created_at <= w.observation_ends_at", 'outcome observation must use a bounded time window');
requireText(migration, 'not causal proof', 'window outcomes must preserve the observational-versus-causal boundary');
requireText(migration, 'count(*) >= 3', 'repeat-event focus-window learning needs multiple supported windows');
requireText(migration, 'count(distinct pw.event_id) >= 2', 'repeat-event focus-window learning needs evidence across multiple ended events');
requireText(migration, 'cannot auto-publish future programming', 'historical evidence must never grant publication authority');

requireText('src/services/event-focus-window.service.ts', ".rpc('get_my_event_focus_windows'", 'participant windows must use the scoped server projection');
requireText('src/services/event-focus-window.service.ts', ".rpc('set_my_event_focus_window_opt_in'", 'participant opt-in must use the server capacity boundary');
requireText('src/services/event-focus-window.service.ts', ".rpc('create_event_focus_window'", 'host publication must use the server cohort/lifecycle boundary');
requireText('src/services/event-focus-window.service.ts', ".rpc('get_host_event_focus_window_outcomes'", 'host outcomes must use the cohort-gated server projection');
requireText('src/services/event-focus-window.service.ts', ".rpc('get_my_focus_window_playbook'", 'repeat-event evidence must remain host private');
requireText('src/services/event-focus-window.service.ts', 'never publishes or authorizes a new window on its own', 'client semantics must preserve human publication authority');
forbidText('src/services/event-focus-window.service.ts', ".from('event_focus_window_opt_ins')", 'mobile code must never query the participant opt-in roster directly');
forbidText('src/services/event-focus-window.service.ts', ".from('event_focus_windows')", 'mobile code must consume purpose-built focus-window RPCs');

requireText('src/components/EventFocusWindowCard.tsx', 'You are never enrolled until you choose to join', 'participant UI must make the explicit opt-in boundary clear');
requireText('src/components/EventFocusWindowCard.tsx', 'not artificial scarcity', 'participant UI must distinguish real capacity from fake scarcity');
requireText('src/components/EventFocusWindowCard.tsx', 'setMyEventFocusWindowOptIn', 'participant UI must provide a functional join/leave action');
requireText('src/components/EventFocusWindowCard.tsx', 'intersect with selections you explicitly made', 'participant UI must explain why the window is visible');

requireText('src/components/HostFocusWindowPanel.tsx', 'programming.filter((action) => action.canOpenWindow', 'host publication must start from an evidence-eligible programming action');
requireText('src/components/HostFocusWindowPanel.tsx', 'Beacon will not turn a balanced cohort', 'host UI must refuse unjustified programming');
requireText('src/components/HostFocusWindowPanel.tsx', 'REAL CAPACITY', 'host UI must require an explicit physical capacity');
requireText('src/components/HostFocusWindowPanel.tsx', 'Nobody is enrolled automatically', 'host UI must preserve participant control');
requireText('src/components/HostFocusWindowPanel.tsx', 'observational outcomes', 'host UI must not overclaim causal impact');
requireText('src/components/HostFocusWindowPanel.tsx', 'at least three supported windows across at least two events', 'host UI must explain the evidence threshold for repeat-event memory');
requireText('src/components/HostFocusWindowPanel.tsx', 'not auto-publish future programming', 'historical focus-window evidence must remain advisory');

requireText('src/spatial/EventIntentProgramming.ts', 'canOpenWindow', 'programming decisions need an explicit publication eligibility boundary');
requireText('src/spatial/EventIntentProgramming.ts', 'recommendedWindowFormat', 'eligible programming should carry an explainable session format');
requireText('src/spatial/EventIntentProgramming.ts', 'will not turn an unsupported need into artificial programming', 'programming must not manufacture supply or demand');
requireText('src/spatial/EventIntentProgramming.ts', 'noMeaningfulSupply', 'need-heavy demand with almost no supply must remain blocked from publication');
requireText('src/spatial/EventIntentProgramming.ts', "recommendedWindowFormat: 'mentor-desk'", 'released excess supply needs a concrete opt-in activation format');

requireText('src/screens/EventLobbyScreen.tsx', '<EventFocusWindowCard eventId={eventId} />', 'participants need a live entry point into relevant physical focus windows');
requireText('src/screens/EventIntentMixScreen.tsx', '<HostFocusWindowPanel eventId={eventId} programming={programming} />', 'the host declared-demand surface must connect evidence to real programming');

for (const path of [
  migration,
  'src/services/event-focus-window.service.ts',
  'src/components/EventFocusWindowCard.tsx',
  'src/components/HostFocusWindowPanel.tsx',
  'src/spatial/EventIntentProgramming.ts',
]) {
  forbidText(path, 'Math.random(', 'focus-window ranking, capacity, and evidence semantics must remain deterministic');
}

for (const path of [
  'src/components/EventFocusWindowCard.tsx',
  'src/components/HostFocusWindowPanel.tsx',
  'src/spatial/EventIntentProgramming.ts',
]) {
  forbidText(path, 'targetPremium', 'focus-window access and publication must not be privileged by payment status');
  forbidText(path, 'userId:', 'focus-window product surfaces must not drift into person-level host targeting');
}

if (failures.length > 0) {
  console.error('Event focus-window architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Event focus-window architecture validation passed (${files.length} required artifacts).`);
