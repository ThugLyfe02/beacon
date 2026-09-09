import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) {
    failures.push(`Missing operator-OS file: ${relativePath}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, why) {
  if (!read(path).includes(text)) failures.push(`${path}: ${why}`);
}

function forbidText(path, text, why) {
  if (read(path).includes(text)) failures.push(`${path}: ${why}`);
}

const files = [
  'supabase/migrations/062_internal_graph_watchtower.sql',
  'supabase/migrations/063_internal_operator_capability_lattice.sql',
  'supabase/migrations/064_internal_watchtower_multi_operator_hardening.sql',
  'src/admin/internalOperatorSecurity.service.ts',
  'src/admin/useInternalOperator.ts',
  'src/admin/internalGraphWatchtower.service.ts',
  'src/admin/InternalTargetRoutingEngine.ts',
  'src/screens/InternalWatchtowerScreen.tsx',
  'src/screens/InternalTargetRoutingScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ["p_capability = 'graph_read'", 'only graph_read may be implied by specialized grants'],
  ["'graph_manage', 'graph_restricted', 'graph_export'", 'specialized capability set must remain explicit'],
  ['Duplicate internal graph capabilities are not allowed', 'operator provisioning must reject duplicate grants'],
  ['get_internal_operator_security_envelope', 'server-computed self-scoped security envelope must remain available'],
  ['manage, restricted, and export never imply one another', 'least-privilege rule must remain explicit'],
]) requireText('supabase/migrations/063_internal_operator_capability_lattice.sql', text, why);
forbidText('supabase/migrations/063_internal_operator_capability_lattice.sql', "or 'graph_manage' = any(access.capabilities)", 'graph_manage must never regain universal super-capability semantics');

for (const [text, why] of [
  ['getInternalOperatorSecurityEnvelope', 'client operator access must come from the server-computed security envelope'],
  ["if (capability === 'graph_manage') return envelope.manage", 'manage rendering must use exact server boolean'],
  ["if (capability === 'graph_restricted') return envelope.restricted", 'restricted rendering must use exact server boolean'],
  ['return envelope.export', 'export rendering must use exact server boolean'],
]) requireText('src/admin/useInternalOperator.ts', text, why);

for (const [text, why] of [
  ['internal_graph_watch_rules', 'Watchtower structural rules table must remain available'],
  ['internal_graph_watch_events', 'Watchtower bounded review events table must remain available'],
  ["'metric_threshold', 'metric_delta', 'motif_threshold', 'machine_digest_changed'", 'Watchtower rule kinds must remain structurally bounded'],
  ["cooldown_minutes between 5 and 10080", 'Watchtower rules need bounded cooldowns'],
  ["Watchtower monitors aggregate topology and analytical-result conditions only", 'Watchtower must retain its no-person operating rule'],
  ['evaluate_internal_watchtower_epoch', 'Epoch-driven Watchtower evaluation must remain event-driven'],
  ['evaluate_internal_watchtower_machine', 'private Machine digest watches must remain event-driven'],
  ['prune_internal_graph_watchtower', 'Watchtower retention must remain bounded'],
  ["auth.role() <> 'service_role'", 'Watchtower pruning must remain service-role-only'],
]) requireText('supabase/migrations/062_internal_graph_watchtower.sql', text, why);
forbidText('supabase/migrations/062_internal_graph_watchtower.sql', 'person_node_id', 'Watchtower rules must not gain a person-node target column');
forbidText('supabase/migrations/062_internal_graph_watchtower.sql', 'target_query', 'Watchtower must not persist raw target ecosystem text');
forbidText('supabase/migrations/062_internal_graph_watchtower.sql', 'http://', 'Watchtower must not accept external endpoints');
forbidText('supabase/migrations/062_internal_graph_watchtower.sql', 'https://', 'Watchtower must not accept external endpoints');

for (const [text, why] of [
  ['join public.internal_operator_access access', 'epoch Watchtower must re-check current operator grant state'],
  ["'graph_manage' = any(access.capabilities)", 'Watchtower evaluation must require exact graph_manage'],
  ['rule.created_by, v_epoch.event_id', 'alerts must remain private to each rule owner'],
  ['existing.evidence_digest = v_digest', 'Watchtower should dedupe identical evidence events'],
  ['Every active rule owner with an exact graph_manage grant', 'multi-operator Watchtower semantics must remain documented'],
]) requireText('supabase/migrations/064_internal_watchtower_multi_operator_hardening.sql', text, why);

for (const [text, why] of [
  ["rpc('get_internal_graph_watchtower'", 'Watchtower reads must use a controlled RPC'],
  ["rpc('save_internal_graph_watch_rule'", 'Watchtower rule mutation must use a controlled RPC'],
  ["rpc('acknowledge_internal_graph_watch_event'", 'Watchtower acknowledgements must use a controlled RPC'],
]) requireText('src/admin/internalGraphWatchtower.service.ts', text, why);
forbidText('src/admin/internalGraphWatchtower.service.ts', ".from('internal_graph_watch", 'Watchtower client must not directly query private tables');

for (const [text, why] of [
  ['WATCHTOWER AUTONOMY CONTRACT', 'Watchtower UI must expose the analysis-only boundary'],
  ['cannot target a person', 'Watchtower UI must keep the no-person-watch rule explicit'],
  ['Crossing semantics + cooldowns', 'operator UI must explain Watchtower anti-spam semantics'],
  ['NEW STRUCTURAL SIGNAL', 'Watchtower must surface a review queue'],
  ['Open evidence', 'Watchtower alerts must lead to evidence surfaces rather than claiming an answer'],
  ["operator.has('graph_manage')", 'Watchtower workbench must remain graph-manage gated'],
]) requireText('src/screens/InternalWatchtowerScreen.tsx', text, why);

for (const [text, why] of [
  ['buildInternalTargetRoutingPortfolio', 'diverse target routing portfolio must remain available'],
  ['suppressions.has(pairKey', 'authoritative block suppressions must remove person-person hops'],
  ['confidenceFloor', 'routing must expose the weakest evidence confidence in each path'],
  ['verifiedEdgeRatio', 'routing must quantify verified-edge composition'],
  ['articulationExposure', 'routing must expose single-node structural dependence'],
  ['graphBridgeExposure', 'routing must expose graph-bridge dependence'],
  ['historicalPrior', 'routing may use confidence-weighted observational history'],
  ['routeDiversity', 'routing must produce a diverse portfolio rather than duplicate shortest paths'],
  ['structuralSinglePointNodeIds', 'routing must identify shared bottlenecks across alternatives'],
  ['does not predict consent, compatibility, influence', 'routing must remain structural rather than social prediction'],
]) requireText('src/admin/InternalTargetRoutingEngine.ts', text, why);
forbidText('src/admin/InternalTargetRoutingEngine.ts', 'supabase', 'target routing engine must remain pure in-memory analysis');
forbidText('src/admin/InternalTargetRoutingEngine.ts', 'fetch(', 'target routing engine must never perform external enrichment');

for (const [text, why] of [
  ['ROUTING CONTRACT', 'Target Routing UI must expose structural-only semantics'],
  ['Routing fails closed when authoritative bridge suppressions cannot be established', 'Target Routing must fail closed on safety-set failure'],
  ['ROUTE PORTFOLIO', 'Target Routing must surface multiple ranked alternatives'],
  ['SHARED SINGLE-POINT DEPENDENCE', 'Target Routing must surface shared structural bottlenecks'],
  ["operator.has('graph_manage')", 'Target Routing must remain graph-manage gated while it consumes private suppression/calibration data'],
]) requireText('src/screens/InternalTargetRoutingScreen.tsx', text, why);

for (const [route, capability] of [
  ['InternalWatchtower', "capability: 'graph_manage'"],
  ['InternalTargetRouting', "capability: 'graph_manage'"],
]) {
  requireText('src/screens/InternalOperatorHubScreen.tsx', `route: '${route}'`, `${route} must remain reachable from sealed Ops`);
  requireText('src/screens/InternalOperatorHubScreen.tsx', capability, `${route} must remain management-gated`);
  requireText('src/navigation/RootNavigator.tsx', `name="${route}"`, `${route} route must remain registered`);
}

forbidText('src/components/NetworkPulseCard.tsx', 'InternalWatchtower', 'normal-user Network Pulse must not expose Watchtower');
forbidText('src/components/NetworkPulseCard.tsx', 'InternalTargetRouting', 'normal-user Network Pulse must not expose operator target routing');
forbidText('src/components/NetworkPulseCard.tsx', 'structuralSinglePointNodeIds', 'normal-user preview must not expose operator route forensics');

if (failures.length > 0) {
  console.error('\nConstellation adaptive operator OS validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Constellation adaptive operator OS capability, Watchtower, routing, and privacy boundary passed.');
