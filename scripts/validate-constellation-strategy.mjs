import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing Constellation strategy file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const files = [
  'supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql',
  'supabase/migrations/050_internal_graph_retention_guardrails.sql',
  'supabase/migrations/051_user_network_pulse_preview.sql',
  'supabase/migrations/052_internal_graph_temporal_rpc_volatility_fix.sql',
  'src/admin/InternalGraphExportEngine.ts',
  'src/admin/InternalGraphExportService.ts',
  'src/admin/InternalGraphStrategyEngine.ts',
  'src/admin/InternalGraphSimulationEngine.ts',
  'src/admin/InternalGraphTransformEngine.ts',
  'src/screens/InternalStrategyLabScreen.tsx',
  'src/screens/InternalSimulationLabScreen.tsx',
  'src/screens/InternalTransformLabScreen.tsx',
  'src/services/networkPulse.service.ts',
  'src/components/NetworkPulseCard.tsx',
  'src/screens/ProfileScreen.tsx',
  'src/navigation/RootNavigator.tsx',
];
for (const file of files) read(file);

for (const [text, why] of [
  ['get_internal_graph_event_sequence', 'event-to-event evidence sequence must remain available'],
  ['get_internal_bridge_pattern_calibration', 'historical bridge pattern calibration must remain available'],
  ['get_internal_graph_export_payload', 'export must use a separate server capability boundary'],
  ["when 'graph_export'", 'export capability must not be implied by graph_manage'],
  ['not causal estimates', 'historical pattern rates must remain explicitly non-causal'],
]) requireText('supabase/migrations/049_internal_graph_temporal_strategy_and_exports.sql', text, why);

for (const [text, why] of [
  ['prune_internal_graph_memory', 'bounded graph retention must remain operational'],
  ["auth.role() <> 'service_role'", 'retention maintenance must remain service-only'],
  ["interval '365 days'", 'operator audit retention must be bounded'],
]) requireText('supabase/migrations/050_internal_graph_retention_guardrails.sql', text, why);

for (const [text, why] of [
  ['get_my_network_pulse', 'normal users need only the self-scoped preview RPC'],
  ['auth.uid()', 'Network Pulse must bind to the caller'],
  ['secondDegreeReach', 'user preview may expose only coarse aggregate reach'],
  ['does not expose other people', 'privacy semantics must remain explicit'],
]) requireText('supabase/migrations/051_user_network_pulse_preview.sql', text, why);
forbidText('supabase/migrations/051_user_network_pulse_preview.sql', 'internal_graph_', 'normal-user preview must never query operator graph tables');
forbidText('supabase/migrations/051_user_network_pulse_preview.sql', 'subject_alias', 'normal-user preview must never expose Constellation identity aliases');

for (const [text, why] of [
  ['language plpgsql\nvolatile', 'audited event-sequence RPC must use truthful volatility'],
  ["'graph_event_sequence_read'", 'event-sequence reads must remain auditable'],
]) requireText('supabase/migrations/052_internal_graph_temporal_rpc_volatility_fix.sql', text, why);

for (const [text, why] of [
  ['PRIVATE_ATTRIBUTE_KEYS', 'export must have a defense-in-depth PII sanitizer'],
  ['internalGraphToGraphML', 'GraphML export must remain deterministic'],
  ['internalGraphToNeo4jCypher', 'Neo4j/Cypher export must remain deterministic'],
  ['subjectUserId', 'direct subject identifiers must be explicitly stripped'],
  ['last_known_lat', 'raw location attributes must be explicitly stripped'],
]) requireText('src/admin/InternalGraphExportEngine.ts', text, why);
forbidText('src/admin/InternalGraphExportEngine.ts', 'fetch(', 'export serialization must not become an enrichment/network client');

for (const [text, why] of [
  ['loadInternalGraphExportPayload', 'exports must begin at the server graph_export boundary'],
  ['writeAsStringAsync', 'export must create a real local artifact'],
  ['Share.share', 'mobile operator export must be operational'],
]) requireText('src/admin/InternalGraphExportService.ts', text, why);

for (const [text, why] of [
  ['analyzeInternalGraphDrift', 'event-to-event community drift must remain first-class'],
  ['findPathsToTargetEcosystem', 'target ecosystem pathfinding must remain available'],
  ['rankInternalGraphInterventions', 'operator intervention frontier must remain ranked and explainable'],
  ['Cartographer', 'Cartographer agent must remain available'],
  ['Broker Scout', 'Broker Scout agent must remain available'],
  ['Historian', 'Historian agent must remain available'],
  ['Pathfinder', 'Pathfinder agent must remain available'],
  ['Sentinel', 'Sentinel agent must remain available'],
  ["autonomy: 'analysis_only'", 'agents must not become autonomous social actors'],
  ['requiresHumanApproval: true', 'agent intervention missions must require human approval'],
]) requireText('src/admin/InternalGraphStrategyEngine.ts', text, why);
forbidText('src/admin/InternalGraphStrategyEngine.ts', 'supabase', 'strategy agents must analyze passed evidence rather than mutate backend state');

for (const [text, why] of [
  ['simulateInternalBridge', 'counterfactual edge simulation must remain available'],
  ['simulateInternalNodeRemoval', 'network resilience simulation must remain available'],
  ['rankInternalGraphResilienceRisks', 'single-point dependency analysis must remain available'],
  ['counterfactual_simulation', 'hypothetical edges must be labeled as unobserved simulation'],
  ['not a ranking of human worth', 'resilience semantics must distinguish topology from human value'],
]) requireText('src/admin/InternalGraphSimulationEngine.ts', text, why);
forbidText('src/admin/InternalGraphSimulationEngine.ts', 'supabase', 'counterfactual simulation must remain in-memory and non-persistent');

for (const [text, why] of [
  ['runInternalNodeTransforms', 'Maltego-style transforms must remain available'],
  ['relationship_ladder', 'relationship-depth pivot must remain available'],
  ['shared_context', 'context pivot must remain available'],
  ['entity_pivot', 'reverse entity-to-people pivot must remain available'],
  ['bridge_pivot', 'cross-community pivot must remain available'],
  ['temporal_evidence', 'time-aware transform must remain available'],
  ['buildInternalEvidenceTimeline', 'provenance timeline must remain available'],
  ['expandInternalTransformNeighborhood', 'bounded multi-hop transform expansion must remain available'],
]) requireText('src/admin/InternalGraphTransformEngine.ts', text, why);
forbidText('src/admin/InternalGraphTransformEngine.ts', 'fetch(', 'transforms must not become external identity lookup');
forbidText('src/admin/InternalGraphTransformEngine.ts', 'supabase', 'transform engine must remain a pure analysis layer');

for (const [text, why] of [
  ['AGENT MISSION QUEUE', 'operator strategy cockpit must expose orchestrated missions'],
  ['EVENT-TO-EVENT GRAPH DRIFT', 'drift must be inspectable by operators'],
  ['TARGET ECOSYSTEM PATHFINDER', 'target ecosystem paths must be inspectable'],
  ['OPERATOR INTERVENTION FRONTIER', 'intervention ranking must be surfaced'],
  ['GraphML', 'GraphML export must be accessible only from operator Strategy Lab'],
  ['Neo4j Cypher', 'Neo4j export must be accessible only from operator Strategy Lab'],
]) requireText('src/screens/InternalStrategyLabScreen.tsx', text, why);

for (const [text, why] of [
  ['COUNTERFACTUAL CONTRACT', 'Simulation Lab must show its non-predictive boundary'],
  ['HYPOTHETICAL BRIDGE IMPACT', 'counterfactual bridge effects must be visible'],
  ['NETWORK RESILIENCE / SINGLE-POINT DEPENDENCE', 'network brittleness must be visible'],
]) requireText('src/screens/InternalSimulationLabScreen.tsx', text, why);

for (const [text, why] of [
  ['TRANSFORM ENGINE', 'Transform Lab must be explicit operator tooling'],
  ['Maltego-style pivots over first-party Beacon evidence', 'Transform Lab must preserve its non-scraping boundary'],
  ['TRANSFORM PALETTE', 'transform results must be surfaced'],
  ['MULTI-HOP EXPANSION', 'bounded transform expansion must be surfaced'],
  ['EVIDENCE TIMELINE', 'first/last seen provenance must be surfaced'],
]) requireText('src/screens/InternalTransformLabScreen.tsx', text, why);

requireText('src/services/networkPulse.service.ts', "rpc('get_my_network_pulse'", 'normal preview must use only the self-scoped RPC');
forbidText('src/services/networkPulse.service.ts', '../admin/', 'normal Network Pulse service must not import operator intelligence');
for (const [text, why] of [
  ['NETWORK PULSE · YOUR VIEW', 'normal users must receive a clearly self-scoped preview'],
  ['The deeper Constellation system is not exposed here', 'preview boundary must be transparent'],
]) requireText('src/components/NetworkPulseCard.tsx', text, why);
forbidText('src/components/NetworkPulseCard.tsx', 'brokerScore', 'normal preview must not expose broker rankings');
forbidText('src/components/NetworkPulseCard.tsx', 'bridgeCandidates', 'normal preview must not expose structural-hole recommendations');
forbidText('src/components/NetworkPulseCard.tsx', 'InternalGraph', 'normal preview component must not import/render operator graph data');

for (const route of ['InternalGraph', 'InternalBridgeLab', 'InternalStrategyLab', 'InternalSimulationLab', 'InternalTransformLab']) {
  requireText('src/navigation/RootNavigator.tsx', `name="${route}"`, `${route} must remain registered`);
}
requireText('src/screens/ProfileScreen.tsx', '{isSelf ? <NetworkPulseCard /> : null}', 'Network Pulse must remain self-profile-only');
requireText('src/screens/ProfileScreen.tsx', "internalOperator.has('graph_read')", 'operator labs must remain capability gated');
requireText('src/screens/ProfileScreen.tsx', "internalOperator.has('graph_manage')", 'Bridge Lab must remain graph_manage-gated');

if (failures.length) {
  console.error('\nConstellation strategy validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation strategy, simulation, transform, export, agent, and Network Pulse boundary passed.');
