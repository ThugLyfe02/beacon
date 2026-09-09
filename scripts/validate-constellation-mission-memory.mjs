import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing Mission Ledger file: ${path}`);
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
  'supabase/migrations/056_internal_agent_mission_ledger.sql',
  'supabase/migrations/057_internal_agent_mission_reconciliation_metrics.sql',
  'src/admin/internalAgentMission.service.ts',
  'src/screens/InternalMissionLedgerScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['internal_graph_agent_missions', 'persistent bounded mission memory table must remain available'],
  ["autonomy = 'analysis_only'", 'mission persistence must remain analysis-only'],
  ['requires_human_approval', 'persisted missions must require human approval'],
  ['objective_digest', 'objective memory must remain digest-scoped rather than raw-text keyed'],
  ["digest(lower(trim(coalesce(p_objective, ''))), 'sha256')", 'objective scope must remain SHA-256 digested'],
  ['get_internal_intelligence_graph(p_event_id, false, 2000)', 'mission sync must re-derive the authorized graph server-side'],
  ['Mission references node outside current server graph', 'forged node references must fail closed'],
  ['miss_count + 1 >= 2', 'mission disappearance must use two-consecutive-miss damping'],
  ['status in (\'open\', \'acknowledged\')', 'only active mission states may auto-resolve from graph disappearance'],
  ['delete from public.internal_graph_agent_missions where v_key = any(node_keys)', 'account erasure must purge person-linked mission memory'],
  ['prune_internal_agent_missions', 'Mission Ledger must have bounded service-only retention'],
  ["auth.role() <> 'service_role'", 'mission retention pruning must remain service-role-only'],
  ['revoke all on table public.internal_graph_agent_missions from anon, authenticated', 'Mission Ledger table must not have direct client access'],
]) requireText('supabase/migrations/056_internal_agent_mission_ledger.sql', text, why);

for (const [text, why] of [
  ['sync_internal_agent_missions_v2', 'exact reconciliation telemetry wrapper must remain available'],
  ['newlyResolvedCount', 'reconciliation must report actual newly resolved missions'],
  ["mission.resolved_at = v_transaction_time", 'newly resolved telemetry must be transaction-scoped'],
]) requireText('supabase/migrations/057_internal_agent_mission_reconciliation_metrics.sql', text, why);

for (const [text, why] of [
  ["rpc('sync_internal_agent_missions_v2'", 'client must use exact mission sync boundary'],
  ["rpc('get_internal_agent_mission_ledger'", 'mission history must use the narrow read RPC'],
  ["rpc('set_internal_agent_mission_status'", 'mission disposition must use controlled RPC'],
  ['persistenceSafeMission', 'client must sanitize mission persistence payloads'],
  ["mission.agent === 'Pathfinder' ? 'Explainable target-ecosystem route'", 'raw Pathfinder target query must not be embedded in persisted title'],
  ['newlyResolvedCount', 'client sync type must preserve exact resolution telemetry'],
]) requireText('src/admin/internalAgentMission.service.ts', text, why);
forbidText('src/admin/internalAgentMission.service.ts', '.from(\'internal_graph_agent_missions\')', 'Mission Ledger client must never directly query its table');

for (const [text, why] of [
  ['PERSISTENT AGENT MEMORY', 'Mission Ledger must be clearly identified as internal agent memory'],
  ['MISSION AUTONOMY CONTRACT', 'Mission Ledger must keep its autonomy boundary visible'],
  ['PERSISTENT MISSION MEMORY', 'persistent strategic-condition history must remain operator-visible'],
  ['two consecutive misses', 'UI must explain disappearance damping semantics'],
  ['Raw target-objective text is not retained', 'operator UI must expose objective-retention semantics'],
  ['syncInternalAgentMissions', 'Mission Ledger must reconcile live agent analysis into bounded memory'],
  ['any social action remains explicitly human-approved', 'Mission Ledger copy must not imply autonomous social intervention'],
]) requireText('src/screens/InternalMissionLedgerScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalMissionLedger'", 'Mission Ledger must remain reachable from the sealed operator hub');
requireText('src/screens/InternalOperatorHubScreen.tsx', "capability: 'graph_manage'", 'persistent mission mutation must remain graph-manage gated');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalMissionLedger"', 'Mission Ledger route must remain registered');

if (failures.length) {
  console.error('\nConstellation Mission Ledger validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation persistent agent Mission Ledger boundary passed.');
