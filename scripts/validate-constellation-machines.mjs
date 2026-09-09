import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing Constellation Machine file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => {
  if (!read(path).includes(text)) failures.push(`${path}: ${why}`);
};
const forbidText = (path, text, why) => {
  if (read(path).includes(text)) failures.push(`${path}: ${why}`);
};

const files = [
  'src/admin/InternalGraphImpactEngine.ts',
  'src/admin/InternalGraphMachineEngine.ts',
  'src/admin/InternalGraphMachineRecipeEngine.ts',
  'src/admin/internalGraphMachineRegistry.service.ts',
  'src/screens/InternalMachineLabScreen.tsx',
  'src/screens/InternalMachineRegistryScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'supabase/migrations/058_internal_graph_machine_registry.sql',
];
files.forEach(read);

for (const [text, why] of [
  ['analyzeInternalGraphImpact', 'relation-aware structural blast-radius analysis must remain available'],
  ["InternalImpactDirection = 'outbound' | 'inbound' | 'both'", 'impact traversal must preserve explicit direction semantics'],
  ['edge.directed', 'impact traversal must respect directed graph evidence'],
  ['confidenceFloor', 'impact paths must preserve the weakest evidence confidence in the chain'],
  ['bottlenecks', 'impact analysis must expose path bottlenecks rather than only raw reach counts'],
  ['does not predict consent, behavior, compatibility, causation, or human importance', 'impact semantics must explicitly remain structural/non-causal'],
]) requireText('src/admin/InternalGraphImpactEngine.ts', text, why);
forbidText('src/admin/InternalGraphImpactEngine.ts', 'supabase', 'Impact Engine must remain pure in-memory analysis');
forbidText('src/admin/InternalGraphImpactEngine.ts', 'fetch(', 'Impact Engine must never become an enrichment/network client');

for (const [text, why] of [
  ['INTERNAL_GRAPH_MACHINES', 'built-in Machine definitions must remain explicit and reviewable'],
  ["id: 'broker-xray'", 'Broker X-Ray Machine must remain available'],
  ["id: 'ecosystem-entry'", 'Target Ecosystem Entry Machine must remain available'],
  ["id: 'bridge-emergence'", 'Unexpected Bridge Emergence Machine must remain available'],
  ["id: 'community-drift'", 'Community Drift Autopsy Machine must remain available'],
  ["id: 'outcome-ladder'", 'Outcome Ladder Audit Machine must remain available'],
  ['runInternalGraphMachine', 'Machine execution must remain deterministic and centrally orchestrated'],
  ['analyzeInternalGraphImpact', 'Machines must compose the structural impact primitive'],
  ['runInternalNodeTransforms', 'Machines must compose existing first-party transforms'],
  ['analyzeInternalGraphForensics', 'Machines must compose forensic brokerage analysis'],
  ['analyzeInternalGraphMotifs', 'Machines must compose higher-order motifs'],
  ['findPathsToTargetEcosystem', 'Machines must support explainable target-ecosystem routing'],
  ['analyzeInternalGraphDrift', 'Machines must support temporal graph drift'],
  ['traceQuestions', 'Machine runs must produce deterministic investigation questions'],
  ['cannot fetch external identity data, message users, create relationships, bypass blocks, or write hypothetical results as evidence', 'Machine autonomy boundary must remain explicit'],
]) requireText('src/admin/InternalGraphMachineEngine.ts', text, why);
forbidText('src/admin/InternalGraphMachineEngine.ts', 'supabase', 'Machine engine must not mutate backend state');
forbidText('src/admin/InternalGraphMachineEngine.ts', 'fetch(', 'Machine engine must not perform external enrichment');

for (const [text, why] of [
  ['validateInternalGraphMachineRecipe', 'private recipes must validate every Machine id against the audited registry'],
  ['between one and six audited Machines', 'recipe pipelines must remain bounded'],
  ['runInternalGraphMachineRecipe', 'private recipes must replay as deterministic audited stages'],
  ['Stages intentionally share the same explicit seed/target/event scope', 'recipe stages must not silently select hidden targets'],
  ['Private recipes compose audited Constellation Machines only', 'recipe autonomy boundary must remain explicit'],
  ['internalGraphMachineRecipeSummary', 'run manifests need a PII-minimized summary surface'],
]) requireText('src/admin/InternalGraphMachineRecipeEngine.ts', text, why);
forbidText('src/admin/InternalGraphMachineRecipeEngine.ts', 'supabase', 'recipe execution engine must remain pure analysis');
forbidText('src/admin/InternalGraphMachineRecipeEngine.ts', 'fetch(', 'recipe execution engine must not perform external enrichment');

for (const [text, why] of [
  ["rpc('save_internal_graph_machine_recipe'", 'client recipe writes must use the controlled registry RPC'],
  ["rpc('record_internal_graph_machine_run'", 'client run manifests must use the controlled digest boundary'],
  ['internalGraphMachineRecipeSummary', 'client must submit a minimized run summary rather than raw trace state'],
]) requireText('src/admin/internalGraphMachineRegistry.service.ts', text, why);
forbidText('src/admin/internalGraphMachineRegistry.service.ts', ".from('internal_graph_machine_recipes')", 'client must never directly access recipe tables');
forbidText('src/admin/internalGraphMachineRegistry.service.ts', ".from('internal_graph_machine_run_manifests')", 'client must never directly access run-manifest tables');

for (const [text, why] of [
  ['internal_graph_machine_recipes', 'private Machine recipe table must remain available'],
  ['internal_graph_machine_run_manifests', 'bounded run manifest table must remain available'],
  ['internal_graph_machine_ids_are_safe', 'recipe stages must remain an explicit allowlist'],
  ["'broker-xray'", 'recipe allowlist must retain Broker X-Ray'],
  ["'ecosystem-entry'", 'recipe allowlist must retain target-ecosystem entry'],
  ['cardinality(machine_ids) between 1 and 6', 'recipe pipelines must remain bounded at the database'],
  ['get_internal_intelligence_graph(p_event_id, false, 2000)', 'run sealing must revalidate the current authorized graph'],
  ['Machine seed is outside the current authorized graph', 'forged seed nodes must fail closed'],
  ["digest(trim(p_seed_node_id), 'sha256')", 'seed identity must be reduced to a digest before persistence'],
  ["digest(lower(trim(p_target_query)), 'sha256')", 'raw target objective must be reduced to a digest before persistence'],
  ["digest(p_result_summary::text, 'sha256')", 'run output must be retained as a digest rather than raw trace'],
  ['pg_column_size(p_result_summary) > 8192', 'transient result summary must remain bounded'],
  ['prune_internal_graph_machine_registry', 'registry history must have bounded service-only retention'],
  ["auth.role() <> 'service_role'", 'registry pruning must remain service-role-only'],
  ['revoke all on table public.internal_graph_machine_recipes from anon, authenticated', 'recipe table must not have direct client access'],
  ['revoke all on table public.internal_graph_machine_run_manifests from anon, authenticated', 'manifest table must not have direct client access'],
]) requireText('supabase/migrations/058_internal_graph_machine_registry.sql', text, why);
forbidText('supabase/migrations/058_internal_graph_machine_registry.sql', 'http://', 'saved Machine recipes must not introduce external endpoints');
forbidText('supabase/migrations/058_internal_graph_machine_registry.sql', 'https://', 'saved Machine recipes must not introduce external endpoints');

for (const [text, why] of [
  ['COMPOSABLE GRAPH MACHINES', 'Machine Lab must expose composable playbooks'],
  ['MACHINE AUTONOMY CONTRACT', 'Machine Lab must show its autonomy boundary'],
  ['MACHINE TRACE', 'Machine steps must remain inspectable'],
  ['MACHINE QUESTIONS', 'Machine-generated investigation questions must remain visible'],
  ['setInterval(() => load(true), 30_000)', 'Machine Lab must re-run against refreshed graph state'],
  ['The Machine will run automatically and will re-run when the graph refreshes', 'live recomputation semantics must remain explicit'],
  ["navigation.navigate('InternalMissionLedger'", 'Machine Lab must remain connected to persistent strategic memory'],
]) requireText('src/screens/InternalMachineLabScreen.tsx', text, why);

for (const [text, why] of [
  ['PRIVATE MACHINE REGISTRY', 'operator UI must expose the sealed private recipe registry'],
  ['COMPOSE PRIVATE PIPELINE', 'operators must be able to compose audited Machine sequences'],
  ['REPRODUCIBILITY LEDGER', 'operators must be able to compare replay manifests'],
  ['TOPOLOGY RESULT CHANGED', 'manifest comparison must surface changed outputs without raw trace persistence'],
  ['Seed/objective inputs are reduced to SHA-256 digests', 'registry UI must make retention semantics explicit'],
  ['Seal reproducible run manifest', 'manifest sealing must remain an explicit operator action'],
]) requireText('src/screens/InternalMachineRegistryScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalMachineLab'", 'Machine Lab must remain reachable from sealed Ops');
requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalMachineRegistry'", 'Machine Registry must remain reachable from sealed Ops');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalMachineLab"', 'Machine Lab route must remain registered');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalMachineRegistry"', 'Machine Registry route must remain registered');

if (failures.length) {
  console.error('\nConstellation Machine validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation composable Machine, private registry, run-manifest, and structural Impact boundary passed.');
