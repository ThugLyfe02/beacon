import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing case-rehydration file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const migration = 'supabase/migrations/074_internal_graph_case_rehydration.sql';
const visibility = 'supabase/migrations/075_internal_graph_case_question_visibility.sql';
const service = 'src/admin/internalCaseMemory.service.ts';
const screen = 'src/screens/InternalCollaborativeCaseMemoryScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[migration, visibility, service, screen, pulse].forEach(read);

for (const [text, why] of [
  ['internal_graph_case_operator_state', 'per-operator rehydration state must exist'],
  ['last_seen_graph_version', 'canonical graph-version checkpoint must be retained'],
  ['last_seen_memory_at', 'memory read pointer must be retained'],
  ['get_internal_graph_case_rehydration', 'rehydration RPC must exist'],
  ['mark_internal_graph_case_seen', 'explicit acknowledgement RPC must exist'],
  ['resolve_internal_graph_case_question', 'questions must have an analytical lifecycle'],
  ['stores no graph snapshots', 'rehydration privacy boundary must remain explicit'],
]) requireText(migration, text, why);
for (const forbidden of ['graph_payload', 'target_query', 'email', 'latitude', 'longitude', 'phone']) {
  forbidText(migration, forbidden, `rehydration state must not store ${forbidden}`);
}

for (const [text, why] of [
  ['resolvedAt', 'question resolution state must be returned'],
  ['resolvedById', 'question resolver metadata must remain bounded'],
  ['Question resolution changes operator memory state only', 'question resolution must not imply graph mutation'],
]) requireText(visibility, text, why);

for (const [text, why] of [
  ['loadInternalCaseRehydration', 'typed rehydration loader must exist'],
  ['markInternalCaseSeen', 'typed rehydration acknowledgement must exist'],
  ['resolveInternalCaseQuestion', 'typed question resolver must exist'],
  ['graphVersionChanged', 'client rehydration state must expose graph-version drift'],
  ['openQuestionCount', 'client rehydration state must expose unresolved questions'],
]) requireText(service, text, why);

for (const [text, why] of [
  ['CASE REHYDRATION', 'rehydration brief must be operator-visible'],
  ['Acknowledge current state', 'operator must explicitly advance read state'],
  ['OPEN QUESTIONS', 'unresolved analytical questions must be visible'],
  ['Resolve analytical question', 'question lifecycle must be operable'],
  ['does not clone old graph snapshots', 'UI must preserve rehydration privacy semantics'],
]) requireText(screen, text, why);

forbidText(pulse, 'Case Rehydration', 'normal-user Network Pulse must never expose case rehydration');
forbidText(pulse, 'InternalCollaborativeCaseMemory', 'normal-user Network Pulse must never expose collaborative case memory');

if (failures.length) {
  console.error('\nConstellation case-rehydration validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation Case Rehydration and resolvable-question contract passed.');
