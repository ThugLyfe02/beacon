import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing longitudinal intelligence file: ${path}`);
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
  'supabase/migrations/053_internal_graph_epoch_ledger.sql',
  'src/admin/InternalGraphForensicsEngine.ts',
  'src/admin/InternalGraphMotifEngine.ts',
  'src/admin/InternalGraphEpochEngine.ts',
  'src/admin/internalGraphEpoch.service.ts',
  'src/screens/InternalEpochLabScreen.tsx',
  'src/navigation/RootNavigator.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['internal_graph_epochs', 'durable structural epoch table must remain available'],
  ['internal_graph_epoch_members', 'community lineage membership must remain normalized'],
  ['references public.internal_graph_subject_aliases(alias) on delete cascade', 'person epoch history must remain erasable through alias FK'],
  ['internal_graph_epoch_brokers', 'broker trajectories must have bounded durable history'],
  ['internal_graph_epoch_motifs', 'higher-order motif history must remain available'],
  ['record_internal_graph_epoch', 'operators need a server-validated checkpoint path'],
  ['get_internal_intelligence_graph(p_event_id, false, 2000)', 'epoch recording must re-derive current server graph before accepting analysis'],
  ['Community contains node outside the current event graph', 'submitted community membership must fail closed when forged'],
  ['Durable graph epochs require a finalized event', 'durable snapshots must not freeze mutable live topology'],
  ['get_internal_graph_epoch_history', 'longitudinal history must have one narrow read RPC'],
  ['prune_internal_graph_epochs', 'epoch retention must have service-only pruning'],
  ["auth.role() <> 'service_role'", 'epoch pruning must remain service-role-only'],
]) requireText('supabase/migrations/053_internal_graph_epoch_ledger.sql', text, why);
forbidText('supabase/migrations/053_internal_graph_epoch_ledger.sql', 'email', 'epoch storage must not add contact identifiers');
forbidText('supabase/migrations/053_internal_graph_epoch_ledger.sql', 'last_known_lat', 'epoch storage must not add raw latitude');
forbidText('supabase/migrations/053_internal_graph_epoch_ledger.sql', 'last_known_lng', 'epoch storage must not add raw longitude');

for (const [text, why] of [
  ['criticalStructure', 'Tarjan articulation/bridge analysis must remain available'],
  ['participationCoefficient', 'cross-community brokerage must use participation structure'],
  ['effectiveSize', 'brokerage must distinguish low redundancy from popularity'],
  ['edgeSurprisal', 'unexpected edges need degree-baseline surprisal'],
  ['articulation', 'genuine broker scoring must capture graph disconnection risk'],
  ['not a human-value score', 'forensic semantics must distinguish topology from human value'],
]) requireText('src/admin/InternalGraphForensicsEngine.ts', text, why);
forbidText('src/admin/InternalGraphForensicsEngine.ts', 'supabase', 'forensic graph math must remain deterministic and non-mutating');

for (const [text, why] of [
  ['triadic_closure', 'triadic closure motif must remain available'],
  ['cross_community_context_bridge', 'context bridge motif must remain available'],
  ['relationship_outcome_ladder', 'relationship-to-outcome motif must remain available'],
  ['repeated_cross_community_edge', 'durable repeated bridge motif must remain available'],
  ['articulation_dependence', 'fragility motif must remain available'],
  ['multi_community_broker', 'genuine multi-community brokerage motif must remain available'],
]) requireText('src/admin/InternalGraphMotifEngine.ts', text, why);

for (const [text, why] of [
  ['analyzeInternalEpochTransition', 'epoch transition analysis must remain first-class'],
  ['converged', 'community convergence lineage must remain classified'],
  ['split_fragment', 'community split lineage must remain classified'],
  ['brokerTrajectories', 'broker emergence/decay must remain analyzable'],
  ['motifTrajectories', 'motif acceleration/fade must remain analyzable'],
]) requireText('src/admin/InternalGraphEpochEngine.ts', text, why);

for (const [text, why] of [
  ["rpc('record_internal_graph_epoch'", 'client checkpoint must use the controlled epoch RPC'],
  ["rpc('get_internal_graph_epoch_history'", 'epoch history must use the narrow read RPC'],
]) requireText('src/admin/internalGraphEpoch.service.ts', text, why);

for (const [text, why] of [
  ['LONGITUDINAL MEMORY', 'Epoch Lab must clearly identify its operator purpose'],
  ['checkpointLatestFinalized', 'Epoch Lab must checkpoint only finalized graph topology'],
  ['COMMUNITY LINEAGE', 'community lineage must be operator-visible'],
  ['BROKER TRAJECTORIES', 'broker trajectories must be operator-visible'],
  ['MOTIF EVOLUTION', 'motif evolution must be operator-visible'],
  ['BOUNDED STRUCTURAL MEMORY', 'retention semantics must remain visible'],
]) requireText('src/screens/InternalEpochLabScreen.tsx', text, why);

requireText('src/navigation/RootNavigator.tsx', 'name="InternalEpochLab"', 'Epoch Lab route must remain registered');

if (failures.length) {
  console.error('\nConstellation longitudinal validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation forensic brokerage, motif, and longitudinal epoch boundary passed.');
