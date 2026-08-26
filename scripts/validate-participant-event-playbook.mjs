import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required participant-playbook file: ${path}`);
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

const migration = 'supabase/migrations/051_participant_event_playbook.sql';
const service = 'src/services/participant-event-playbook.service.ts';
const engine = 'src/intents/ParticipantEventPlaybook.ts';
const component = 'src/components/ParticipantEventPlaybookCard.tsx';
const editor = 'src/screens/EventIntentScreen.tsx';
const documentation = 'docs/PARTICIPANT_EVENT_PLAYBOOK.md';

const files = [migration, service, engine, component, editor, documentation];
for (const path of files) read(path);

requireText(migration, 'get_my_event_playbook', 'the private longitudinal projection needs a server-owned RPC');
requireText(migration, 'if auth.uid() is null then', 'anonymous callers must receive no participant history');
requireText(migration, 'public.is_event_operational(p_current_event_id)', 'playbook access must be tied to an operational current event');
requireText(migration, "ep.status = 'approved'", 'the caller must be an approved participant in the current and historical events');
requireText(migration, 'i.user_id = auth.uid()', 'historical declarations must be caller-owned');
requireText(migration, 'auth.uid() in (m.user_a_id, m.user_b_id)', 'historical mutual evidence must involve the caller');
requireText(migration, 'e.ended_at is not null', 'only ended events may become longitudinal evidence');
requireText(migration, 'public.user_blocks', 'active bilateral blocks must remove counterpart match evidence');
requireText(migration, 'public.declared_fit_mutual_contexts', 'mutual evidence must use captured declared-fit context rather than reconstructed inference');
requireText(migration, 'public.outcome_handshakes', 'outcome evidence must come from the existing private handshake contract');
requireText(migration, 'completed_outcome_count integer', 'participant-confirmed completion must remain a distinct bounded count');
requireText(migration, 'last_outcome_at timestamptz', 'recency must come from explicit historical evidence rather than behavioral activity');
requireText(migration, 'no counterpart identities', 'the database contract must explicitly document identity minimization');
requireText(migration, 'no counterpart identities, behavioral inference, host access', 'the function comment must preserve the private participant-only boundary');
requireText(migration, 'revoke all on function public.get_my_event_playbook(uuid) from public', 'the history projection must not inherit broad execution rights');
requireText(migration, 'grant execute on function public.get_my_event_playbook(uuid) to authenticated', 'approved authenticated participants need the scoped RPC');
forbidText(migration, 'public.is_event_host', 'host authority must not grant access to participant playbook history');
forbidText(migration, 'insert into public.participant_event_intents', 'historical evidence must not write into the current declaration');
forbidText(migration, 'update public.participant_event_intents', 'historical evidence must never mutate declarations');
forbidText(migration, 'latitude', 'participant playbook evidence must not depend on stored location');
forbidText(migration, 'longitude', 'participant playbook evidence must not depend on stored location');

requireText(service, ".rpc('get_my_event_playbook'", 'the mobile client must use the caller-private server projection');
requireText(service, 'no counterpart identities', 'service documentation must preserve the identity boundary');
requireText(service, 'normalizeHistoryRow', 'RPC output needs strict client validation before entering the engine');
requireText(service, 'Math.min(completedOutcomeCount, alignedOutcomeCount, observedMutualCount)', 'client normalization must preserve count monotonicity');
forbidText(service, ".from('participant_event_intents')", 'the client must not query historical declaration rows directly');
forbidText(service, ".from('matches')", 'the client must not assemble private longitudinal history from raw matches');
forbidText(service, ".from('declared_fit_mutual_contexts')", 'the client must not read raw mutual-pair context');
forbidText(service, ".from('outcome_handshakes')", 'the client must not inspect raw private handshake rows for playbook construction');

requireText(engine, "ParticipantPlaybookTier = 'established' | 'supported' | 'building'", 'evidence maturity needs explicit bounded states');
requireText(engine, "ParticipantPlaybookMode = 'seeking' | 'offering' | 'both'", 'the suggested declaration side must be explicit and reviewable');
requireText(engine, 'row.declaredEventCount >= 3', 'established evidence needs repeated ended-event support');
requireText(engine, 'row.observedMutualCount >= 3', 'declaration repetition alone must not establish a playbook item');
requireText(engine, "mayApplyToDraft: tier !== 'building'", 'weak history may remain visible but cannot be one-tap applied');
requireText(engine, 'not a recommender trained on behavior', 'engine semantics must reject behavioral-model framing');
requireText(engine, 'not a probability of success', 'evidence coverage must not be represented as predicted success');
requireText(engine, 'evidenceWeight', 'deterministic ranking needs a bounded transparent support value');
forbidText(engine, 'Math.random(', 'participant playbook ordering must remain deterministic');
forbidText(engine, 'targetPremium', 'payment status must not influence participant history');
forbidText(engine, 'isPremium', 'payment status must not influence participant history');
forbidText(engine, 'profileView', 'profile browsing must not influence longitudinal evidence');
forbidText(engine, 'responseTime', 'communications responsiveness must not influence longitudinal evidence');

requireText(component, 'PRIVATE EVENT PLAYBOOK', 'the participant needs a clear private longitudinal surface');
requireText(component, 'Hosts cannot read this view', 'the UI must explain the host privacy boundary');
requireText(component, 'movement, clicks, profile views, messages, and reply speed are not inputs', 'the UI must state what is excluded from learning');
requireText(component, 'NOT A SUCCESS PROBABILITY', 'the support score must not be mistaken for predictive confidence');
requireText(component, 'changes only this unsaved draft', 'applying history must remain a local draft action');
requireText(component, 'will not silently displace something you chose', 'a full current selection set must not be overwritten');
requireText(component, 'MORE HISTORY NEEDED', 'building evidence must be legible without being action-authoritative');
forbidText(component, 'setMyEventIntent', 'the playbook card must not save the current event declaration');
forbidText(component, 'Math.random(', 'participant playbook presentation must remain deterministic');

requireText(editor, '<ParticipantEventPlaybookCard', 'the private playbook must be reachable from the current event-focus editor');
requireText(editor, 'applyPlaybookSuggestion', 'playbook suggestions need a bounded draft integration path');
requireText(editor, 'seeking.length >= 6', 'playbook application must preserve the seeking-domain limit');
requireText(editor, 'offering.length >= 6', 'playbook application must preserve the offering-domain limit');
requireText(editor, 'never evicts a current choice', 'the editor must preserve participant-authored current context');
requireText(editor, 'SAVE EVENT FOCUS', 'the participant must still perform the final explicit save');

requireText(documentation, 'Private Participant Event Playbook', 'the longitudinal participant contract needs reviewable documentation');
requireText(documentation, 'It is a draft aid, not an autonomous recommender', 'documentation must preserve participant authority');
requireText(documentation, 'does not invent or backfill outcome context', 'missing historical context must remain missing');
requireText(documentation, 'not causal proof', 'outcome history must remain observational');
requireText(documentation, 'no empty playbook shell', 'the physical-device matrix must include the new-user state');

if (failures.length > 0) {
  console.error('Participant event playbook architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Participant event playbook architecture validation passed (${files.length} required artifacts).`);
