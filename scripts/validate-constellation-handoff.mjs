import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing handoff file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const files = [
  'supabase/migrations/070_internal_graph_case_handoffs.sql',
  'supabase/migrations/071_internal_graph_case_handoff_hardening.sql',
  'src/admin/internalGraphHandoff.service.ts',
  'src/screens/InternalHandoffLabScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['internal_graph_case_handoffs', 'bounded handoff table must remain available'],
  ['internal_graph_case_handoff_notes', 'bounded collaboration notes must remain available'],
  ["expires_at <= created_at + interval '90 days'", 'handoff retention must remain capped at 90 days'],
  ["'graph_manage' = any(access.capabilities)", 'recipient must be an active standing graph-management operator'],
  ['get_internal_intelligence_graph', 'server must rederive authorized graph before accepting handoff'],
  ['internal_graph_entity_alias_version', 'handoff graph version must include canonicalization state'],
  ['Handoff graph version is stale', 'stale analytical context must be rejected'],
  ["digest(p_evidence_summary::text, 'sha256')", 'handoff evidence summary must be retained only as a digest'],
  ['internal_handoff_text_safe', 'handoff text must pass bounded contact/link safety guard'],
  ["!~* 'https?://'", 'handoff text must reject external URLs'],
  ['Handoff text must not contain direct email addresses', 'handoff text must reject direct email dumping'],
  ['from_operator = auth.uid() or h.to_operator = auth.uid()', 'handoff read scope must remain sender/recipient only'],
  ['v_count >= 50', 'handoff notes must remain bounded'],
  ['prune_internal_graph_case_handoffs', 'handoff retention pruning must remain available'],
  ["auth.role() <> 'service_role'", 'handoff pruning must remain service-role-only'],
  ['graph payloads are not copied', 'handoff data-minimization contract must remain explicit'],
]) requireText('supabase/migrations/070_internal_graph_case_handoffs.sql', text, why);
forbidText('supabase/migrations/070_internal_graph_case_handoffs.sql', 'graph_payload', 'handoffs must never store duplicated graph payloads');
forbidText('supabase/migrations/070_internal_graph_case_handoffs.sql', 'person_node_id', 'handoffs must not introduce person watch targets');

for (const [text, why] of [
  ['v_is_sender := v_handoff.from_operator is not null', 'sender checks must be NULL-safe after account erasure'],
  ['v_is_recipient := v_handoff.to_operator = auth.uid()', 'recipient ownership must remain explicit'],
  ['Terminal handoff status cannot transition again', 'handoff state machine must remain monotonic'],
  ['Only an accepted handoff can be resolved', 'resolution must require recipient acceptance first'],
  ['Notes are closed for terminal handoffs', 'terminal handoffs must not accumulate new notes'],
  ['Sender erasure cannot accidentally broaden participant authorization', 'account-erasure authorization boundary must remain explicit'],
]) requireText('supabase/migrations/071_internal_graph_case_handoff_hardening.sql', text, why);

for (const [text, why] of [
  ["rpc('get_internal_handoff_operator_directory'", 'client directory reads must use controlled RPC'],
  ["rpc('get_internal_graph_case_handoffs'", 'handoff reads must use controlled RPC'],
  ["rpc('create_internal_graph_case_handoff'", 'handoff creation must use controlled RPC'],
  ["rpc('set_internal_graph_case_handoff_status'", 'status changes must use controlled RPC'],
  ["rpc('add_internal_graph_case_handoff_note'", 'notes must use controlled RPC'],
]) requireText('src/admin/internalGraphHandoff.service.ts', text, why);
forbidText('src/admin/internalGraphHandoff.service.ts', ".from('internal_graph_case_handoff", 'handoff client must never directly query private tables');

for (const [text, why] of [
  ['INVESTIGATION CONTEXT TRANSFER', 'Handoff Lab must be explicit operator tooling'],
  ['HANDOFF CONTRACT', 'data-minimization and action boundary must be visible'],
  ['NEXT FALSIFIABLE QUESTION', 'handoffs must transfer a next question rather than an opaque summary'],
  ['No graph payload duplication', 'handoff UI must explain graph data minimization'],
  ["operator.has('graph_manage')", 'Handoff Lab must remain graph-manage gated'],
  ['Perspective fingerprint', 'handoff context must preserve analytical lens identity'],
]) requireText('src/screens/InternalHandoffLabScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalHandoffLab'", 'Handoff Lab must remain reachable only from sealed Ops');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalHandoffLab"', 'Handoff Lab route must remain registered');
forbidText('src/components/NetworkPulseCard.tsx', 'InternalHandoffLab', 'normal-user Network Pulse must not expose internal handoffs');
forbidText('src/components/NetworkPulseCard.tsx', 'evidenceDigest', 'normal-user preview must not expose handoff evidence digests');

if (failures.length) {
  console.error('\nConstellation investigation handoff validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation bounded investigation handoff, privacy, ownership, and erasure boundary passed.');
