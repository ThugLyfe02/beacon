import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing collaborative-case-memory file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

for (const file of [
  'supabase/migrations/072_internal_graph_collaborative_case_memory.sql',
  'src/admin/internalCaseMemory.service.ts',
  'src/screens/InternalCollaborativeCaseMemoryScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
]) read(file);

for (const [text, why] of [
  ['internal_graph_case_memory_entries', 'bounded shared case-memory table must exist'],
  ['assigned_operator', 'Casebook must support explicit operator assignment'],
  ['internal_current_canonical_graph_version', 'case memory must bind to server-recomputed canonical graph version'],
  ["encode(digest(p_evidence_summary::text, 'sha256'), 'hex')", 'case evidence summaries must be digest-only'],
  ['Case-memory graph version is stale', 'stale analytical checkpoints must be rejected'],
  ['internal_handoff_text_safe', 'case-memory text must reject obvious email/URL dumping'],
  ["'graph_manage' = any(access.capabilities)", 'case assignment must target active graph-management operators'],
  ['capture_internal_handoff_case_memory', 'handoff transitions must feed durable shared case memory'],
  ['prune_internal_graph_case_memory', 'case-memory retention must remain bounded'],
  ["auth.role() <> 'service_role'", 'case-memory pruning must remain service-role-only'],
  ['Evidence summaries are retained only as SHA-256 digests', 'database memory boundary must remain explicit'],
]) requireText('supabase/migrations/072_internal_graph_collaborative_case_memory.sql', text, why);
forbidText('supabase/migrations/072_internal_graph_collaborative_case_memory.sql', 'graph_payload', 'collaborative memory must never copy graph payloads');

for (const [text, why] of [
  ['loadInternalCaseCollaboration', 'collaborative memory loader must exist'],
  ['assignInternalGraphCase', 'case assignment service must exist'],
  ['appendInternalCaseMemory', 'bounded shared-memory append must exist'],
]) requireText('src/admin/internalCaseMemory.service.ts', text, why);
forbidText('src/admin/internalCaseMemory.service.ts', 'from(\'internal_graph_case_memory_entries\')', 'client must not bypass RPC boundary with direct table access');

for (const [text, why] of [
  ['COLLABORATIVE INVESTIGATION MEMORY', 'shared-memory workbench must be explicit'],
  ['COLLABORATION CONTRACT', 'memory truth boundary must be visible'],
  ['APPEND ANALYTICAL MEMORY', 'operators must be able to add bounded analytical checkpoints'],
  ['CASE CHRONOLOGY', 'shared case chronology must be inspectable'],
  ["operator.has('graph_manage')", 'collaborative memory must remain management-gated'],
]) requireText('src/screens/InternalCollaborativeCaseMemoryScreen.tsx', text, why);

for (const path of ['src/navigation/RootNavigator.tsx', 'src/screens/InternalOperatorHubScreen.tsx']) {
  requireText(path, 'InternalCollaborativeCaseMemory', 'Collaborative Case Memory must remain inside sealed operator navigation');
}
forbidText('src/components/NetworkPulseCard.tsx', 'InternalCollaborativeCaseMemory', 'normal-user Network Pulse must never expose collaborative case memory');
forbidText('src/components/NetworkPulseCard.tsx', 'evidenceDigest', 'normal-user preview must not expose operator evidence-digest memory');

if (failures.length) {
  console.error('\nConstellation collaborative case-memory validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation collaborative Casebook assignment, canonical checkpoint, evidence-digest, and handoff-memory boundary passed.');
