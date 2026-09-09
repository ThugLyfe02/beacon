import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing internal-intelligence file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  if (!read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  if (read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

const files = [
  'supabase/migrations/045_internal_intelligence_graph_core.sql',
  'supabase/migrations/046_internal_intelligence_graph_runtime.sql',
  'supabase/migrations/047_internal_bridge_feedback_loop.sql',
  'supabase/migrations/048_internal_bridge_feedback_hardening.sql',
  'supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql',
  'supabase/migrations/050_internal_graph_retention_guardrails.sql',
  'src/admin/InternalGraphEngine.ts',
  'src/admin/InternalGraphCanvas.tsx',
  'src/admin/internalGraph.service.ts',
  'src/admin/useInternalOperator.ts',
  'src/screens/InternalGraphScreen.tsx',
  'src/screens/InternalBridgeLabScreen.tsx',
  'src/screens/ProfileScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'docs/internal-intelligence-graph.md',
];
for (const file of files) read(file);

for (const [text, explanation] of [
  ['internal_operator_access', 'operator access must be server-provisioned rather than a client flag'],
  ['revoke all on table public.internal_operator_access from anon, authenticated', 'operator access table must have no direct client read/write surface'],
  ['provision_internal_operator', 'operator provisioning must have a dedicated service-role function'],
  ["auth.role() <> 'service_role'", 'operator provisioning must remain service-role-only'],
  ['internal_graph_subject_aliases', 'person graph identity must be indirect through erasable aliases'],
  ['purge_internal_graph_subject_on_alias_delete', 'account erasure must purge person graph topology'],
  ['internal_graph_edge_memory', 'graph topology must retain first/last seen and evidence counts'],
  ['internal_graph_assertions', 'manual business-context bridges need a provenance table'],
  ["'organization', 'domain', 'project', 'topic', 'venue', 'event', 'role'", 'manual assertions must stay restricted to non-sensitive business/event entity kinds'],
  ['source_uri', 'manual bridges must support explicit provenance'],
  ['graph_restricted', 'restricted safety topology must require a separate capability'],
]) requireText('supabase/migrations/045_internal_intelligence_graph_core.sql', text, explanation);

forbidText('supabase/migrations/045_internal_intelligence_graph_core.sql', '@', 'operator bootstrap must not hardcode personal addresses in the migration');

for (const [text, explanation] of [
  ['refresh_internal_intelligence_graph', 'the graph must adapt from current Beacon source tables'],
  ['get_internal_intelligence_graph', 'operators need one narrow graph read RPC'],
  ['connection_requests', 'high-intent signals must feed graph evidence'],
  ['matches', 'mutuals must feed graph evidence'],
  ['office_hours_requests', 'Office Hours must feed graph evidence'],
  ['outcome_handshakes', 'verified outcomes must feed graph evidence'],
  ['user_blocks', 'restricted safety topology must be derivable'],
  ['abuse_reports', 'restricted report topology must be derivable'],
  ["'restricted'", 'safety edges must remain sensitivity-labeled'],
  ["'graph_read'", 'graph refresh/read must remain capability-gated'],
  ['evidenceCount', 'read payload must expose evidence multiplicity'],
  ['firstSeenAt', 'read payload must expose graph chronology'],
  ['lastSeenAt', 'read payload must expose graph chronology'],
]) requireText('supabase/migrations/046_internal_intelligence_graph_runtime.sql', text, explanation);

for (const [text, explanation] of [
  ['internal_graph_bridge_watches', 'bridge learning must remain explicit and bounded'],
  ['observed_stage', 'bridge calibration needs monotonic downstream evidence'],
  ['correlation', 'bridge feedback must preserve a non-causal attribution boundary'],
  ['get_internal_bridge_suppressions', 'block safety must be independent of restricted visualization mode'],
  ['user_blocks', 'bridge suppressions must derive from authoritative block state'],
  ['A block is a hard bridge-suppression boundary', 'watch creation itself must reject blocked pairs'],
]) requireText('supabase/migrations/047_internal_bridge_feedback_loop.sql', text, explanation);

for (const [text, explanation] of [
  ['delete from public.internal_graph_bridge_watches', 'later blocks must invalidate watched introductions'],
  ['blocked-pair watches are purged', 'hardening must document post-watch block invalidation'],
  ['event_scope', 'global watches must remain idempotent despite NULL event ids'],
]) requireText('supabase/migrations/048_internal_bridge_feedback_hardening.sql', text, explanation);

for (const [text, explanation] of [
  ['get_internal_graph_event_sequence', 'event-to-event strategy needs an ordered evidence catalog'],
  ['get_internal_bridge_pattern_calibration', 'historical bridge archetypes need sample-aware calibration'],
  ['get_internal_graph_export_payload', 'bulk export must have a separate capability boundary'],
  ['graph_export', 'export privilege must remain independent of graph management'],
  ['not causal estimates', 'historical bridge calibration must remain explicitly non-causal'],
]) requireText('supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql', text, explanation);

for (const [text, explanation] of [
  ['prune_internal_graph_memory', 'graph memory must have a service-only bounded retention path'],
  ["auth.role() <> 'service_role'", 'retention pruning must be service-role-only'],
  ["interval '365 days'", 'operator audit history must have a bounded retention window'],
  ['internal_graph_bridge_watches', 'bridge calibration material must be covered by retention pruning'],
]) requireText('supabase/migrations/050_internal_graph_retention_guardrails.sql', text, explanation);

for (const [text, explanation] of [
  ['detectInternalGraphCommunities', 'deterministic community detection must remain available'],
  ['hubCutoff', 'super-hub suppression must protect community quality'],
  ['surprisingConnections', 'cross-community surprises must remain a first-class analysis'],
  ['bridgeCandidates', 'structural-hole introduction candidates must remain available'],
  ['findInternalGraphPath', 'operators need explainable pathfinding between entities'],
  ['diffInternalGraphs', 'graph diffs must expose temporal topology change'],
  ['brokerScore', 'broker ranking must remain part of operator analysis'],
]) requireText('src/admin/InternalGraphEngine.ts', text, explanation);

for (const [text, explanation] of [
  ['InternalGraphCanvas', 'the intelligence graph needs an interactive native visualization'],
  ['GraphCameraRig', 'selection must adapt camera framing'],
  ['brokerSet', 'broker nodes should remain visually emphasized'],
  ['onPointerDown', 'graph nodes must remain interactive rather than decorative'],
]) requireText('src/admin/InternalGraphCanvas.tsx', text, explanation);

for (const [text, explanation] of [
  ["rpc('get_internal_operator_context'", 'operator UI access must be server-backed'],
  ["rpc('get_internal_intelligence_graph'", 'graph loading must use the narrow RPC'],
  ["rpc('add_internal_graph_assertion'", 'Bridge Builder must commit evidence through the controlled RPC'],
  ["rpc('get_internal_bridge_suppressions'", 'client bridge analysis must fail closed through server suppressions'],
]) requireText('src/admin/internalGraph.service.ts', text, explanation);
forbidText('src/admin/internalGraph.service.ts', 'fetch(', 'internal graph client must not become an OSINT scraper');

for (const [text, explanation] of [
  ['CONSTELLATION', 'operator entry should be invisible to normal profiles'],
  ["internalOperator.has('graph_read')", 'operator entry must be capability checked'],
]) requireText('src/screens/ProfileScreen.tsx', text, explanation);

for (const [text, explanation] of [
  ['RESTRICTED FORENSICS', 'restricted graph mode needs an explicit UI state'],
  ['STRUCTURAL-HOLE BRIDGES', 'bridge candidates must be surfaced in the workbench'],
  ['SURPRISING CONNECTIONS', 'surprising cross-community edges must be surfaced'],
  ['EXPLAINABLE BRIDGE PATH', 'pathfinding must be human-readable'],
  ['BRIDGE BUILDER', 'operator manual provenance entry must be available'],
  ['does not fetch people', 'Bridge Builder must explain its non-scraping privacy boundary'],
  ['RETENTION CONTRACT', 'operators need visible retention semantics'],
]) requireText('src/screens/InternalGraphScreen.tsx', text, explanation);

forbidText('src/screens/InternalGraphScreen.tsx', '.email', 'operator graph UI must not access person address fields');
forbidText('src/screens/InternalGraphScreen.tsx', "['email']", 'operator graph UI must not access person address fields');
forbidText('src/screens/InternalGraphScreen.tsx', 'last_known_lat', 'operator graph UI must not expose raw peer latitude');
forbidText('src/screens/InternalGraphScreen.tsx', 'last_known_lng', 'operator graph UI must not expose raw peer longitude');

for (const [text, explanation] of [
  ['ATTRIBUTION FIREWALL', 'Bridge Lab must make non-causal calibration semantics visible'],
  ['SAFE STRUCTURAL HOLES', 'Bridge Lab must expose block-safe candidate gaps'],
  ['getInternalBridgeSuppressions', 'Bridge Lab must fail closed on block suppression'],
  ['Mark introduced', 'operators need an explicit intervention receipt rather than inferred action'],
]) requireText('src/screens/InternalBridgeLabScreen.tsx', text, explanation);

requireText('src/navigation/RootNavigator.tsx', 'name="InternalGraph"', 'Constellation route must remain registered');
requireText('docs/internal-intelligence-graph.md', 'Graphify-inspired, not Graphify-copied', 'architecture docs must preserve provenance of the design approach');
requireText('docs/internal-intelligence-graph.md', 'Zero default operators', 'operator bootstrap semantics must remain explicit');

if (failures.length > 0) {
  console.error('\nInternal intelligence graph validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Exclusive evidence-native intelligence graph contract passed.');
