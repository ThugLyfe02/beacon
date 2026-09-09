import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing protected file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireAll(relativePath, needles, label) {
  const content = read(relativePath);
  for (const needle of needles) {
    if (!content.includes(needle)) failures.push(`${label}: ${relativePath} no longer contains ${JSON.stringify(needle)}`);
  }
}

function forbidAll(relativePath, needles, label) {
  const content = read(relativePath);
  for (const needle of needles) {
    if (content.includes(needle)) failures.push(`${label}: ${relativePath} must not contain ${JSON.stringify(needle)}`);
  }
}

const protectedFiles = [
  'src/screens/MapScreen.tsx',
  'src/screens/MatchesScreen.tsx',
  'src/screens/EventLobbyScreen.tsx',
  'src/screens/OfficeHoursRequestScreen.tsx',
  'src/screens/OfficeHoursInboxScreen.tsx',
  'src/screens/OfficeHoursCallScreen.tsx',
  'src/screens/HostManagementScreen.tsx',
  'src/screens/EscortPanelScreen.tsx',
  'src/screens/InternalGraphScreen.tsx',
  'src/screens/InternalBridgeLabScreen.tsx',
  'src/screens/InternalStrategyLabScreen.tsx',
  'src/screens/InternalSimulationLabScreen.tsx',
  'src/screens/InternalTransformLabScreen.tsx',
  'src/screens/InternalEpochLabScreen.tsx',
  'src/screens/InternalCasebookScreen.tsx',
  'src/screens/InternalPatternLabScreen.tsx',
  'src/spatial/SpatialFieldScreen.tsx',
  'src/spatial/ARFieldScreen.tsx',
  'src/screens/ChooseAvatarScreen.tsx',
  'src/components/OutcomeHandshakeCard.tsx',
  'src/components/NetworkPulseCard.tsx',
  'src/admin/InternalGraphEngine.ts',
  'src/admin/InternalGraphCanvas.tsx',
  'src/admin/InternalGraphStrategyEngine.ts',
  'src/admin/InternalGraphSimulationEngine.ts',
  'src/admin/InternalGraphForensicsEngine.ts',
  'src/admin/InternalGraphMotifEngine.ts',
  'src/admin/InternalGraphEpochEngine.ts',
  'src/admin/InternalGraphCalibrationEngine.ts',
  'src/admin/InternalGraphCasebookEngine.ts',
  'src/admin/InternalGraphExportEngine.ts',
  'src/admin/InternalGraphExportService.ts',
  'src/admin/internalGraph.service.ts',
  'src/admin/internalGraphEpoch.service.ts',
  'src/admin/internalGraphCasebook.service.ts',
  'src/admin/useInternalOperator.ts',
  'src/services/networkPulse.service.ts',
  'src/services/event.service.ts',
  'src/services/match.service.ts',
  'src/services/officeHours.service.ts',
  'src/services/escort.service.ts',
  'src/services/outcome-handshake.service.ts',
  'src/services/outcome-intelligence.service.ts',
  'src/services/vault.service.ts',
  'supabase/functions/livekit-token/index.ts',
  'supabase/functions/escort-notify/index.ts',
];

for (const file of protectedFiles) read(file);

requireAll('src/screens/MapScreen.tsx', [
  "navigation.navigate('JoinEvent')", "navigation.navigate('CreateEvent')", "navigation.navigate('Radar'",
  '<PremiumDrawer', 'watchLocation', 'getNearbyPremium', 'eventWindowState',
], 'Map journey regression');

requireAll('src/screens/MatchesScreen.tsx', [
  '<OutcomeHandshakeCard', 'PRIVATE VAULT', "navigation.navigate('OfficeHoursInbox')", 'completeVaultEntry',
], 'Mutual and Vault journey regression');
requireAll('src/screens/EventLobbyScreen.tsx', ['OpportunityWindowBanner', 'useOpportunityIntelligence'], 'Opportunity intelligence regression');

requireAll('src/services/event.service.ts', [
  'export async function createEvent', "rpc('create_hosted_event'", 'export async function updateEvent',
  'export async function setEventAccessCode', 'export async function getEventByCode', 'export async function getUserEvents',
  'export async function getHostedEvent', 'eventPriority', 'p_latitude: eventData.latitude ?? null', ".is('finalized_at', null)",
], 'Event lifecycle regression');
forbidAll('src/services/event.service.ts', [
  'export async function deleteEvent', ".from('events')\n      .insert", ".from('event_participants')\n      .insert",
], 'Destructive or non-atomic event lifecycle regression');

requireAll('src/services/outcome-intelligence.service.ts', ['export async function finalizeHostedEvent', "rpc('finalize_hosted_event'"], 'Atomic event finalization regression');
requireAll('src/screens/HostManagementScreen.tsx', ['REFLECTION MODE', 'Seal outcomes & memory', 'finalizeHostedEvent', 'one-way protected'], 'Host reflection/finalization/access-secret regression');
requireAll('src/services/match.service.ts', ['secure_send_connection_request'], 'Secure mutual activation regression');

requireAll('src/services/officeHours.service.ts', [
  'secure_create_office_hours_request', 'transition_office_hours_request', 'confirm_office_hours_completion', 'get_office_hours_completion_state',
], 'Secure Office Hours state/evidence regression');
forbidAll('src/services/officeHours.service.ts', [".from('office_hours_requests')\n    .update"], 'Direct Office Hours mutation regression');
requireAll('src/screens/OfficeHoursCallScreen.tsx', ['End & confirm my side', 'Leave without confirming', 'confirmOfficeHoursCompletion'], 'Office Hours call evidence regression');
requireAll('src/screens/OfficeHoursInboxScreen.tsx', ['TWO-PARTY COMPLETION SEALED', 'Your confirmation is sealed', 'Confirm my side'], 'Office Hours completion UX regression');

requireAll('src/services/escort.service.ts', ['create_venue_room_secure', 'get_host_escort_queue', 'assign_escort_room_secure', 'body: { officeHoursRequestId }'], 'Secure physical escort regression');
requireAll('src/screens/EscortPanelScreen.tsx', ['LIVE ORCHESTRATION', 'ESCORT SEALED', 'timeWindowsOverlap', 'TIME CONFLICT'], 'Adaptive physical orchestration regression');
requireAll('supabase/functions/livekit-token/index.ts', ['get_office_hours_call_context', 'ttl: ttlSeconds', "'cache-control': 'no-store'"], 'LiveKit authorization regression');
requireAll('supabase/functions/escort-notify/index.ts', ['SUPABASE_SERVICE_ROLE_KEY', 'escort_notification_deliveries', 'request.room_id', "claimError.code === '23505'"], 'Privileged escort notification regression');
forbidAll('supabase/functions/escort-notify/index.ts', ['body.roomId'], 'Client-supplied escort room trust regression');

requireAll('src/services/outcome-handshake.service.ts', ['propose_outcome_handshake', 'get_outcome_handshake_commit_state', 'confirm_outcome_handshake', 'recordDecisionProvenance'], 'Outcome privacy, two-party confirmation, and provenance regression');
forbidAll('src/services/outcome-handshake.service.ts', ["rpc('complete_outcome_handshake'"], 'Legacy one-party outcome completion regression');
requireAll('src/components/OutcomeHandshakeCard.tsx', ['Confirm my side', 'Your confirmation is sealed', 'Two-party outcome confirmed'], 'Two-party outcome UX regression');

requireAll('src/admin/internalGraph.service.ts', [
  "rpc('get_internal_operator_context'", "rpc('get_internal_intelligence_graph'", "rpc('add_internal_graph_assertion'",
  "rpc('get_internal_graph_event_sequence'", "rpc('get_internal_bridge_pattern_calibration'", "rpc('get_internal_graph_export_payload'",
], 'Exclusive intelligence service regression');
requireAll('src/admin/InternalGraphEngine.ts', ['detectInternalGraphCommunities', 'findInternalGraphPath', 'diffInternalGraphs', 'brokerScore', 'bridgeCandidates'], 'Constellation graph-analysis regression');
requireAll('src/admin/InternalGraphStrategyEngine.ts', ['analyzeInternalGraphDrift', 'runInternalGraphAgentOrchestrator', "autonomy: 'analysis_only'", 'requiresHumanApproval: true'], 'Constellation temporal/agent strategy regression');
requireAll('src/admin/InternalGraphSimulationEngine.ts', ['simulateInternalBridge', 'simulateInternalNodeRemoval', 'rankInternalGraphResilienceRisks'], 'Constellation counterfactual simulation regression');
requireAll('src/admin/InternalGraphForensicsEngine.ts', ['criticalStructure', 'participationCoefficient', 'effectiveSize', 'edgeSurprisal', 'articulation'], 'Constellation forensic brokerage regression');
requireAll('src/admin/InternalGraphMotifEngine.ts', ['triadic_closure', 'cross_community_context_bridge', 'relationship_outcome_ladder', 'multi_community_broker'], 'Constellation motif-memory regression');
requireAll('src/admin/InternalGraphEpochEngine.ts', ['analyzeInternalEpochTransition', 'brokerTrajectories', 'motifTrajectories', 'split_fragment'], 'Constellation longitudinal lineage regression');
requireAll('src/admin/InternalGraphCalibrationEngine.ts', ['calibrateInternalBridgePatterns', 'posteriorOutcomeMean', 'outcomeLowerBound90', 'priorStrength'], 'Constellation Bayesian bridge calibration regression');
requireAll('src/admin/InternalGraphCasebookEngine.ts', ['evaluateInternalGraphCase', 'ecosystem_gap', 'findInternalGraphPath'], 'Constellation Casebook evaluator regression');
requireAll('src/admin/InternalGraphExportEngine.ts', ['internalGraphToGraphML', 'internalGraphToNeo4jCypher', 'PRIVATE_ATTRIBUTE_KEYS'], 'Constellation export regression');

requireAll('src/screens/InternalGraphScreen.tsx', ['Constellation', 'STRUCTURAL-HOLE BRIDGES', 'SURPRISING CONNECTIONS', 'BRIDGE BUILDER', 'RETENTION CONTRACT'], 'Exclusive operator workbench regression');
requireAll('src/screens/InternalBridgeLabScreen.tsx', ['ATTRIBUTION FIREWALL', 'SAFE STRUCTURAL HOLES', 'Mark introduced'], 'Bridge Lab regression');
requireAll('src/screens/InternalStrategyLabScreen.tsx', ['AGENT MISSION QUEUE', 'EVENT-TO-EVENT GRAPH DRIFT', 'TARGET ECOSYSTEM PATHFINDER', 'OPERATOR INTERVENTION FRONTIER'], 'Strategy Lab regression');
requireAll('src/screens/InternalSimulationLabScreen.tsx', ['COUNTERFACTUAL CONTRACT', 'HYPOTHETICAL BRIDGE IMPACT', 'NETWORK RESILIENCE / SINGLE-POINT DEPENDENCE'], 'Simulation Lab regression');
requireAll('src/screens/InternalTransformLabScreen.tsx', ['MALTEGO-STYLE TRANSFORMS', 'RELATIONSHIP LADDER', 'PROVENANCE TIMELINE'], 'Transform Lab regression');
requireAll('src/screens/InternalEpochLabScreen.tsx', ['LONGITUDINAL MEMORY', 'COMMUNITY LINEAGE', 'BROKER TRAJECTORIES', 'MOTIF EVOLUTION'], 'Epoch Lab regression');
requireAll('src/screens/InternalCasebookScreen.tsx', ['SAVED INVESTIGATIONS', 'PIN GRAPH EVIDENCE', 'LIVE CASE FINDINGS', 'CASE AUTONOMY CONTRACT'], 'Casebook regression');
requireAll('src/screens/InternalPatternLabScreen.tsx', ['BAYESIAN BRIDGE MEMORY', 'ANTI-OVERFITTING CONTRACT', 'BRIDGE ARCHETYPE POSTERIORS'], 'Pattern Lab regression');

requireAll('src/admin/internalGraphEpoch.service.ts', ["rpc('record_internal_graph_epoch'", "rpc('get_internal_graph_epoch_history'"], 'Epoch service regression');
requireAll('src/admin/internalGraphCasebook.service.ts', ["rpc('get_internal_graph_cases'", "rpc('create_internal_graph_case'", "rpc('pin_internal_graph_case_node'", "rpc('upsert_internal_graph_case_finding'"], 'Casebook service regression');

requireAll('src/services/networkPulse.service.ts', ["rpc('get_my_network_pulse'"], 'Network Pulse service regression');
requireAll('src/components/NetworkPulseCard.tsx', ['NETWORK PULSE · YOUR VIEW', 'The deeper Constellation system is not exposed here'], 'Limited user graph preview regression');
forbidAll('src/components/NetworkPulseCard.tsx', ['brokerScore', 'bridgeCandidates'], 'User preview must not expose operator intelligence');
requireAll('src/screens/ProfileScreen.tsx', ['CONSTELLATION', 'NetworkPulseCard', "internalOperator.has('graph_read')", "internalOperator.has('graph_manage')"], 'Operator/private-preview entry regression');

for (const route of [
  'InternalGraph', 'InternalBridgeLab', 'InternalStrategyLab', 'InternalSimulationLab',
  'InternalTransformLab', 'InternalEpochLab', 'InternalCasebook', 'InternalPatternLab',
]) {
  requireAll('src/navigation/RootNavigator.tsx', [`name="${route}"`], `${route} route regression`);
}

requireAll('src/types/database.ts', ['export type EventInsert = never', 'export type EventParticipantInsert = never', 'export type ConnectionRequestInsert = never'], 'RPC-only mutation type contract regression');
requireAll('src/config/featureFlags.ts', ['vault: true', 'signalScarcity: true', 'securityControlPlane: true', 'outcomeHandshakeProtocol: true', 'decisionProvenance: true'], 'Integrated feature flag regression');

const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const requiredMigrationPrefixes = [
  '019_', '020_', '021_', '022_', '023_', '024_', '025_', '026_',
  '027_', '028_', '029_', '030_', '031_', '032_', '033_', '034_', '035_',
  '036_', '037_', '038_', '039_', '040_', '041_', '042_', '043_', '044_',
  '045_', '046_', '047_', '048_', '049_', '050_', '051_', '052_', '053_', '054_',
];
for (const prefix of requiredMigrationPrefixes) {
  if (!migrations.some((file) => file.startsWith(prefix))) failures.push(`Missing protected migration prefix: ${prefix}`);
}

if (failures.length > 0) {
  console.error('\nBeacon product preservation contract failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Beacon product preservation contract passed (${protectedFiles.length} protected files, ${requiredMigrationPrefixes.length} migrations).`);
