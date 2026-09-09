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
  'src/screens/InternalMachineLabScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
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
  ['COMPOSABLE GRAPH MACHINES', 'Machine Lab must expose composable playbooks'],
  ['MACHINE AUTONOMY CONTRACT', 'Machine Lab must show its autonomy boundary'],
  ['MACHINE TRACE', 'Machine steps must remain inspectable'],
  ['MACHINE QUESTIONS', 'Machine-generated investigation questions must remain visible'],
  ['setInterval(() => load(true), 30_000)', 'Machine Lab must re-run against refreshed graph state'],
  ['The Machine will run automatically and will re-run when the graph refreshes', 'live recomputation semantics must remain explicit'],
  ["navigation.navigate('InternalMissionLedger'", 'Machine Lab must remain connected to persistent strategic memory'],
]) requireText('src/screens/InternalMachineLabScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalMachineLab'", 'Machine Lab must remain reachable from sealed Ops');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalMachineLab"', 'Machine Lab route must remain registered');

if (failures.length) {
  console.error('\nConstellation Machine validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation composable Machine and structural Impact boundary passed.');
