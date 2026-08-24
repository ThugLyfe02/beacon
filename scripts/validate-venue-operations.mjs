import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required venue-operations file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  const content = read(path);
  if (!content.includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  const content = read(path);
  if (content.includes(text)) failures.push(`${path}: ${explanation}`);
}

const requiredFiles = [
  'src/spatial/SpatialVenueTwinEngine.ts',
  'src/spatial/SpatialFlowControlEngine.ts',
  'src/spatial/SpatialOrganizerCommandEngine.ts',
  'src/spatial/SpatialOrganizerCommandHUD.tsx',
  'src/spatial/SpatialPrivacyBudgetEngine.ts',
  'src/spatial/SpatialVenueScenarioEngine.ts',
  'src/spatial/VenueTelemetryIntegrity.ts',
  'src/spatial/VenueSourceQuorum.ts',
  'src/spatial/VenueSensorHealth.ts',
  'src/spatial/VenueObservationContract.ts',
  'src/spatial/VenueObservationConsensus.ts',
  'src/spatial/VenueGeometryIngest.ts',
  'src/spatial/VenueModelCredibility.ts',
  'src/spatial/VenueReadiness.ts',
  'src/spatial/VenueLayoutVersioning.ts',
  'src/spatial/VenueOperatingEnvelope.ts',
  'src/spatial/VenueConfigurationImpact.ts',
  'src/spatial/VenueChangePointDetection.ts',
  'src/spatial/VenueConfidencePolicy.ts',
  'src/spatial/VenueCapacityReserve.ts',
  'src/spatial/VenueTopology.ts',
  'src/spatial/VenueRoutingPolicy.ts',
  'src/spatial/VenueServicePoint.ts',
  'src/spatial/VenueSamplingPolicy.ts',
  'src/spatial/VenueInterventionGuard.ts',
  'src/spatial/VenueInterventionLedger.ts',
  'src/spatial/VenueExperimentDesign.ts',
  'src/spatial/VenueDecisionJournal.ts',
  'src/spatial/VenueDecisionProvenance.ts',
  'src/spatial/VenueRecommendationReliability.ts',
  'src/spatial/VenueRecommendationCalibration.ts',
  'src/spatial/VenueOutcomeLearning.ts',
  'src/spatial/VenueLoadShedding.ts',
  'src/spatial/VenueFallbackMode.ts',
  'src/spatial/VenueServiceObjective.ts',
  'src/spatial/VenueDeploymentPolicy.ts',
  'src/spatial/VenueControlAdmission.ts',
  'src/spatial/VenueCommandAuthority.ts',
  'src/spatial/VenueCommandLease.ts',
  'src/spatial/VenueOperationsRuntime.ts',
  'src/spatial/VenuePressureTest.ts',
  'src/spatial/VenueReplay.ts',
  'src/spatial/VenueProgramAttribution.ts',
  'src/spatial/SponsorEvidenceLedger.ts',
  'src/services/venue-operations.service.ts',
  'src/screens/VenueOperationsScreen.tsx',
  'src/components/VenueServiceStatusCard.tsx',
  'supabase/migrations/030_venue_operations_control_plane.sql',
  'supabase/migrations/031_public_venue_service_status.sql',
  'docs/SPATIAL_EVENT_DIGITAL_TWIN.md',
  'docs/VENUE_OPERATIONS_LEARNING.md',
  '.github/workflows/venue-operations-gate.yml',
];

for (const path of requiredFiles) read(path);

requireText('src/spatial/SpatialVenueTwinEngine.ts', 'never stores identity-linked paths', 'venue twin must preserve aggregate-only movement semantics');
requireText('src/spatial/SpatialPrivacyBudgetEngine.ts', 'formal differential privacy', 'privacy budget must not overclaim a mathematical DP guarantee');
requireText('src/spatial/VenueSensorHealth.ts', "'quarantined'", 'unhealthy sensors need a quarantine state before they can influence venue truth');
requireText('src/spatial/VenueSensorHealth.ts', 'authorityWeight', 'sensor health must reduce decision authority, not only display a warning');
requireText('src/spatial/VenueObservationContract.ts', 'VENUE_OBSERVATION_SCHEMA_VERSION', 'ingress observations must use an explicit versioned contract');
requireText('src/spatial/VenueObservationContract.ts', 'expectedLayoutVersion', 'observations must be bound to the active venue layout version');
requireText('src/spatial/VenueObservationConsensus.ts', 'weightedMedian', 'multi-source venue truth must use a robust consensus estimator');
requireText('src/spatial/VenueObservationConsensus.ts', "sensor.state === 'quarantined'", 'quarantined sensors must be excluded from venue truth');
requireText('src/spatial/VenueObservationConsensus.ts', 'contestedZoneIds', 'source disagreement must be visible to downstream control policy');
requireText('src/spatial/VenueGeometryIngest.ts', "geometry.type !== 'Polygon'", 'venue geometry ingestion must reject unsupported geometry rather than silently losing semantics');
requireText('src/spatial/VenueGeometryIngest.ts', 'hasSelfIntersection', 'venue geometry ingestion must reject self-intersecting semantic zones');
requireText('src/spatial/VenueGeometryIngest.ts', "source: 'geojson'", 'validated GeoJSON must produce a versioned venue layout');
requireText('src/spatial/VenueConfigurationImpact.ts', 'requiresNewBaseline', 'material venue changes must explicitly invalidate stale operational baselines');
requireText('src/spatial/VenueConfigurationImpact.ts', 'requiresShadowRevalidation', 'breaking venue changes must be able to force shadow revalidation');
requireText('src/spatial/VenueConfigurationImpact.ts', 'accessibility', 'configuration review must detect accessibility regressions');
requireText('src/spatial/VenueTopology.ts', 'singleLinkDependencyZoneIds', 'topology must expose route fragility rather than treating all spare capacity as reachable');
requireText('src/spatial/VenueTopology.ts', 'not an emergency egress', 'topology must not be represented as a life-safety routing system');
requireText('src/spatial/VenueRoutingPolicy.ts', 'requiresAccessible', 'normal venue routing must preserve configured accessibility constraints');
requireText('src/spatial/VenueRoutingPolicy.ts', 'not an emergency egress', 'routing policy must preserve its non-emergency boundary');
requireText('src/spatial/VenueServicePoint.ts', 'publicEstimateEligible', 'wait estimates must be support and confidence gated before public use');
requireText('src/spatial/VenueSamplingPolicy.ts', 'cadence, not truth', 'adaptive sensing may reduce cadence but cannot remove truth-bearing zones');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'brierScore', 'recommendation confidence must be measurable against observed outcomes');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'expectedCalibrationError', 'recommendation confidence must expose calibration error rather than only ranking quality');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'does not prove', 'confidence calibration must preserve the observational-versus-causal boundary');
requireText('src/spatial/VenueDeploymentPolicy.ts', "'shadow'", 'new recommendation logic must support shadow deployment');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'human-in-the-loop', 'deployment maturity must not silently authorize automatic interventions');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'recommendationCalibration', 'deployment authority must consume measured recommendation calibration when supplied');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'configurationImpact', 'deployment authority must account for venue configuration blast radius');
requireText('src/spatial/VenueCommandAuthority.ts', 'Server-side authorization must', 'client role checks must remain defense in depth rather than the only authorization boundary');
requireText('src/spatial/VenueCommandAuthority.ts', 'second-approval', 'high-impact command classes must support distinct second approval');
requireText('src/spatial/VenueCommandLease.ts', 'expiresAt', 'action-ready recommendations must expire when venue evidence ages');
requireText('src/spatial/VenueDecisionProvenance.ts', 'not a cryptographic signature', 'decision correlation tokens must not be misrepresented as authenticated audit integrity');
requireText('src/spatial/VenueOperationsRuntime.ts', 'blocked commands remain inspectable', 'blocked recommendations must remain diagnosable without becoming actionable');
requireText('src/spatial/VenueControlAdmission.ts', 'production organizer surfaces should provide the full context', 'production admission should combine the available operational guardrails');
requireText('src/spatial/SpatialOrganizerCommandEngine.ts', 'servicePoints', 'organizer commands must incorporate service-point pressure when available');
requireText('src/spatial/SpatialOrganizerCommandEngine.ts', 'routing', 'organizer commands must distinguish empty capacity from reachable capacity');
requireText('src/spatial/SpatialOrganizerCommandHUD.tsx', 'ACTION READY', 'operator UI must distinguish recommendation from admitted action-ready state');
requireText('src/spatial/VenueInterventionLedger.ts', "'observing'", 'interventions need an explicit observation state before measurement');
requireText('src/spatial/VenueExperimentDesign.ts', 'not a', 'measurement contracts must preserve the distinction between observational evaluation and causal proof');
requireText('src/spatial/VenueOutcomeLearning.ts', 'single event', 'outcome learning must not infer causal certainty from one event');
requireText('src/spatial/SponsorEvidenceLedger.ts', 'sample', 'sponsor evidence must remain support gated');
requireText('src/services/venue-operations.service.ts', ".rpc('append_venue_operator_event'", 'operator writes must use the scoped venue-operations RPC');
requireText('src/services/venue-operations.service.ts', ".rpc('get_venue_service_status'", 'participant venue utility must use the privacy-gated service-status RPC');
forbidText('src/services/venue-operations.service.ts', ".from('venue_operation_audit_events')\n    .insert", 'operator audit events must never use direct client inserts');
requireText('src/screens/VenueOperationsScreen.tsx', 'No persisted operator decision evidence yet', 'host UI must distinguish absent evidence from fabricated operational history');
requireText('src/components/VenueServiceStatusCard.tsx', 'coarse wait bands', 'participant service utility must remain coarse rather than exposing raw queue telemetry');
forbidText('src/components/VenueServiceStatusCard.tsx', 'queue_length', 'participant service UI must not expose raw queue counts');
requireText('src/screens/EventLobbyScreen.tsx', '<VenueServiceStatusCard', 'confidence-gated venue service utility must be integrated into the attendee lobby');
requireText('src/navigation/RootNavigator.tsx', 'VenueOperationsScreen', 'host venue operations must be reachable through navigation');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('VenueOperations'", 'host control deck must expose the venue operations surface');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'append-only', 'venue operation audit evidence must be append-only');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'on conflict (event_id, idempotency_key) do nothing', 'operator event retries must preserve append-only idempotency');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'revoke insert, update, delete', 'authenticated clients must not receive direct mutation rights on venue evidence tables');
requireText('supabase/migrations/031_public_venue_service_status.sql', 'is_approved_participant', 'participant service status must be event-membership scoped');
requireText('supabase/migrations/031_public_venue_service_status.sql', 's.sample_support >= 8', 'participant service status must be sample-support gated');
requireText('supabase/migrations/031_public_venue_service_status.sql', 's.confidence >= 0.72', 'participant service status must be confidence gated');
requireText('supabase/migrations/031_public_venue_service_status.sql', "interval '2 minutes'", 'participant service status must expire stale queue evidence');

for (const path of requiredFiles.filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))) {
  forbidText(path, 'Math.random(', 'venue operations must remain deterministic and reviewable');
}

for (const path of [
  'src/spatial/SpatialVenueTwinEngine.ts',
  'src/spatial/VenueObservationContract.ts',
  'src/spatial/VenueObservationConsensus.ts',
  'src/spatial/VenueSensorHealth.ts',
  'src/spatial/VenueServicePoint.ts',
  'src/spatial/VenueDecisionProvenance.ts',
  'src/spatial/VenueRecommendationCalibration.ts',
  'src/services/venue-operations.service.ts',
]) {
  forbidText(path, 'personId', 'venue operations must not introduce identity-linked movement records');
  forbidText(path, 'targetId', 'venue operations must not repurpose attendee target identifiers for venue analytics');
}

requireText('.github/workflows/venue-operations-gate.yml', 'validate-venue-operations.mjs', 'venue operations workflow must execute the architecture contract');

if (failures.length > 0) {
  console.error('Venue operations architecture validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Venue operations architecture validation passed (${requiredFiles.length} required artifacts).`);
