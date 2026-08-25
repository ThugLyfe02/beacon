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
  'src/spatial/VenueObservationBuffer.ts',
  'src/spatial/VenueObservationConsensus.ts',
  'src/spatial/VenueGeometryIngest.ts',
  'src/spatial/VenueModelCredibility.ts',
  'src/spatial/VenueReadiness.ts',
  'src/spatial/VenueLayoutVersioning.ts',
  'src/spatial/VenueOperatingEnvelope.ts',
  'src/spatial/VenueConfigurationImpact.ts',
  'src/spatial/VenueOperationsRelease.ts',
  'src/spatial/VenueLearningContext.ts',
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
  'src/spatial/VenueEventCloseout.ts',
  'src/spatial/VenueLoadShedding.ts',
  'src/spatial/VenueFallbackMode.ts',
  'src/spatial/VenueServiceObjective.ts',
  'src/spatial/VenueServiceErrorBudget.ts',
  'src/spatial/VenueCommandCircuitBreaker.ts',
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
  'src/services/venue-operator.service.ts',
  'src/services/venue-release.service.ts',
  'src/services/event-lifecycle.service.ts',
  'src/services/event.service.ts',
  'src/services/participant.service.ts',
  'src/screens/VenueOperationsScreen.tsx',
  'src/screens/VenueOperatorsScreen.tsx',
  'src/components/VenueServiceStatusCard.tsx',
  'supabase/migrations/030_venue_operations_control_plane.sql',
  'supabase/migrations/031_public_venue_service_status.sql',
  'supabase/migrations/032_venue_operator_roles.sql',
  'supabase/migrations/033_trusted_venue_command_admission.sql',
  'supabase/migrations/034_event_lifecycle_for_operational_history.sql',
  'supabase/migrations/035_event_lifecycle_access_boundaries.sql',
  'supabase/migrations/036_venue_operations_release_pinning.sql',
  'supabase/migrations/037_context_scoped_venue_learning.sql',
  'supabase/migrations/038_event_operations_closeout.sql',
  'supabase/migrations/039_event_runtime_invariants.sql',
  'supabase/migrations/040_atomic_event_creation.sql',
  'supabase/migrations/041_venue_audit_integrity_chain.sql',
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
requireText('src/spatial/VenueObservationBuffer.ts', 'allowedOutOfOrderMs', 'multi-source observations need bounded event-time reordering');
requireText('src/spatial/VenueObservationBuffer.ts', 'maximumBufferedObservations', 'observation buffering must remain memory bounded');
requireText('src/spatial/VenueObservationBuffer.ts', 'duplicate', 'duplicate source sequences must be suppressed before venue consensus');
requireText('src/spatial/VenueObservationConsensus.ts', 'weightedMedian', 'multi-source venue truth must use a robust consensus estimator');
requireText('src/spatial/VenueObservationConsensus.ts', "sensor.state === 'quarantined'", 'quarantined sensors must be excluded from venue truth');
requireText('src/spatial/VenueObservationConsensus.ts', 'contestedZoneIds', 'source disagreement must be visible to downstream control policy');
requireText('src/spatial/VenueGeometryIngest.ts', "geometry.type !== 'Polygon'", 'venue geometry ingestion must reject unsupported geometry rather than silently losing semantics');
requireText('src/spatial/VenueGeometryIngest.ts', 'hasSelfIntersection', 'venue geometry ingestion must reject self-intersecting semantic zones');
requireText('src/spatial/VenueGeometryIngest.ts', "source: 'geojson'", 'validated GeoJSON must produce a versioned venue layout');
requireText('src/spatial/VenueConfigurationImpact.ts', 'requiresNewBaseline', 'material venue changes must explicitly invalidate stale operational baselines');
requireText('src/spatial/VenueConfigurationImpact.ts', 'requiresShadowRevalidation', 'breaking venue changes must be able to force shadow revalidation');
requireText('src/spatial/VenueConfigurationImpact.ts', 'accessibility', 'configuration review must detect accessibility regressions');
requireText('src/spatial/VenueOperationsRelease.ts', 'requiresNewBaseline', 'runtime release drift must invalidate baselines when venue/schema truth changes');
requireText('src/spatial/VenueOperationsRelease.ts', 'requiresReadmission', 'model or policy drift must force fresh control admission');
requireText('src/spatial/VenueOperationsRelease.ts', 'canAdmitCommands', 'pinned runtime releases must gate control authority');
requireText('src/services/venue-release.service.ts', "rpc('get_active_venue_operations_release'", 'clients may read only the trusted release pinned by the control plane');
forbidText('src/services/venue-release.service.ts', ".from('venue_operation_releases').insert", 'mobile clients must not hot-swap venue operations releases');
requireText('src/spatial/VenueLearningContext.ts', 'mayGrantOperationalAuthority', 'learning transfer must distinguish ranking priors from operational authority');
requireText('src/spatial/VenueLearningContext.ts', 'cross-venue evidence is capped as a weak prior', 'cross-venue evidence must never silently inherit local control authority');
requireText('src/spatial/VenueInterventionLedger.ts', 'bindInterventionLearningContext', 'measured interventions must be bound to an explicit learning context before outcome reuse');
requireText('src/spatial/VenueOutcomeLearning.ts', 'excludedContextMismatches', 'outcome learning must expose context exclusions rather than blending incompatible evidence');
requireText('src/spatial/VenueRecommendationReliability.ts', 'learningContextKey', 'recommendation reliability must support local operating-context scope');
requireText('src/spatial/VenueTopology.ts', 'singleLinkDependencyZoneIds', 'topology must expose route fragility rather than treating all spare capacity as reachable');
requireText('src/spatial/VenueTopology.ts', 'not an emergency egress', 'topology must not be represented as a life-safety routing system');
requireText('src/spatial/VenueRoutingPolicy.ts', 'requiresAccessible', 'normal venue routing must preserve configured accessibility constraints');
requireText('src/spatial/VenueRoutingPolicy.ts', 'not an emergency egress', 'routing policy must preserve its non-emergency boundary');
requireText('src/spatial/VenueServicePoint.ts', 'publicEstimateEligible', 'wait estimates must be support and confidence gated before public use');
requireText('src/spatial/VenueSamplingPolicy.ts', 'cadence, not truth', 'adaptive sensing may reduce cadence but cannot remove truth-bearing zones');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'brierScore', 'recommendation confidence must be measurable against observed outcomes');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'expectedCalibrationError', 'recommendation confidence must expose calibration error rather than only ranking quality');
requireText('src/spatial/VenueRecommendationCalibration.ts', 'does not prove', 'confidence calibration must preserve the observational-versus-causal boundary');
requireText('src/spatial/VenueServiceErrorBudget.ts', 'fastBurnRate', 'venue decision-service reliability must expose short-window error-budget burn');
requireText('src/spatial/VenueServiceErrorBudget.ts', 'slowBurnRate', 'venue decision-service reliability must expose sustained error-budget burn');
requireText('src/spatial/VenueServiceErrorBudget.ts', 'cannot hide people or erase telemetry', 'error-budget exhaustion must reduce authority rather than truth visibility');
requireText('src/spatial/VenueCommandCircuitBreaker.ts', "'probe'", 'failed command classes need a bounded recovery/probe state');
requireText('src/spatial/VenueCommandCircuitBreaker.ts', "'review-only'", 'breaker recovery must remain explicitly human reviewed');
requireText('src/spatial/VenueCommandCircuitBreaker.ts', 'blocks only new action-ready authority', 'circuit breaking must not erase venue truth or rewrite prior evidence');
requireText('src/spatial/VenueDeploymentPolicy.ts', "'shadow'", 'new recommendation logic must support shadow deployment');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'human-in-the-loop', 'deployment maturity must not silently authorize automatic interventions');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'recommendationCalibration', 'deployment authority must consume measured recommendation calibration when supplied');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'configurationImpact', 'deployment authority must account for venue configuration blast radius');
requireText('src/spatial/VenueControlAdmission.ts', 'production organizer surfaces should provide the full context', 'production admission should combine the available operational guardrails');
requireText('src/spatial/VenueControlAdmission.ts', 'serviceErrorBudget', 'control admission must honor sustained service reliability failures');
requireText('src/spatial/VenueControlAdmission.ts', 'circuitBreaker', 'control admission must honor fast command-class failure containment');
requireText('src/spatial/VenueControlAdmission.ts', 'release', 'control admission must honor the pinned runtime release');
requireText('src/spatial/VenueCommandAuthority.ts', 'Server-side authorization must', 'client role checks must remain defense in depth rather than the only authorization boundary');
requireText('src/spatial/VenueCommandAuthority.ts', 'second-approval', 'high-impact command classes must support distinct second approval');
requireText('src/spatial/VenueCommandLease.ts', 'expiresAt', 'action-ready recommendations must expire when venue evidence ages');
requireText('src/spatial/VenueDecisionProvenance.ts', 'not a cryptographic signature', 'decision correlation tokens must not be misrepresented as authenticated audit integrity');
requireText('src/spatial/VenueOperationsRuntime.ts', 'blocked commands remain inspectable', 'blocked recommendations must remain diagnosable without becoming actionable');
requireText('src/spatial/SpatialOrganizerCommandEngine.ts', 'servicePoints', 'organizer commands must incorporate service-point pressure when available');
requireText('src/spatial/SpatialOrganizerCommandEngine.ts', 'routing', 'organizer commands must distinguish empty capacity from reachable capacity');
requireText('src/spatial/SpatialOrganizerCommandHUD.tsx', 'ACTION READY', 'operator UI must distinguish recommendation from admitted action-ready state');
requireText('src/spatial/VenueInterventionLedger.ts', "'observing'", 'interventions need an explicit observation state before measurement');
requireText('src/spatial/VenueExperimentDesign.ts', 'not a', 'measurement contracts must preserve the distinction between observational evaluation and causal proof');
requireText('src/spatial/VenueOutcomeLearning.ts', 'single event', 'outcome learning must not infer causal certainty from one event');
requireText('src/spatial/VenueEventCloseout.ts', 'not causal proof', 'post-event summaries must preserve the observational-versus-causal boundary');
requireText('src/spatial/VenueEventCloseout.ts', 'evidenceCoverage', 'closeout must expose evidence completeness instead of fabricating certainty');
requireText('src/spatial/SponsorEvidenceLedger.ts', 'sample', 'sponsor evidence must remain support gated');
requireText('src/services/venue-operations.service.ts', ".rpc('append_venue_operator_action'", 'operator writes must use the server role-enforced venue-operations RPC');
requireText('src/services/venue-operations.service.ts', ".rpc('approve_venue_command'", 'high-impact venue commands need a server approval path');
requireText('src/services/venue-operations.service.ts', ".rpc('get_venue_service_status'", 'participant venue utility must use the privacy-gated service-status RPC');
requireText('src/services/venue-operations.service.ts', ".rpc('verify_venue_operation_audit_chain'", 'host/operator evidence must expose server-side audit-chain verification');
requireText('src/services/venue-operations.service.ts', ".from('venue_event_closeouts'", 'host operations must expose immutable closeout evidence');
requireText('src/services/venue-operations.service.ts', ".rpc('get_venue_learning_context'", 'host operations must expose the aggregate context used for outcome transfer');
forbidText('src/services/venue-operations.service.ts', ".from('venue_operation_audit_events')\n    .insert", 'operator audit events must never use direct client inserts');
requireText('src/services/venue-operator.service.ts', ".rpc('set_venue_event_operator'", 'venue operator roster changes must be host-scoped server RPCs');
requireText('src/services/event.service.ts', ".rpc('create_hosted_event'", 'event creation must be an atomic server transaction');
forbidText('src/services/event.service.ts', 'generateJoinCode', 'mobile clients must not generate authoritative event join codes');
requireText('src/services/event.service.ts', ".is('ended_at', null)", 'live host event discovery/update must exclude explicitly closed events');
requireText('src/services/participant.service.ts', ".rpc('approve_self_with_event_code'", 'event access-code approval must bind to auth.uid() on the server');
forbidText('src/services/participant.service.ts', "p_user_id: userId", 'access-code approval must not trust a caller-selected user id');
requireText('src/services/event-lifecycle.service.ts', ".rpc('end_event'", 'product event closure must use the evidence-preserving lifecycle RPC');
requireText('src/screens/HostManagementScreen.tsx', 'endActiveEvent', 'host event closure must preserve operational evidence');
forbidText('src/screens/HostManagementScreen.tsx', 'deleteEvent(', 'host UI must not hard-delete an event to close it');
requireText('src/screens/VenueOperationsScreen.tsx', 'No persisted operator decision evidence yet', 'host UI must distinguish absent evidence from fabricated operational history');
requireText('src/screens/VenueOperationsScreen.tsx', 'CHAIN VERIFIED', 'host evidence surface must expose audit-chain verification state');
requireText('src/screens/VenueOperationsScreen.tsx', 'EVENT CLOSEOUT', 'host evidence surface must expose immutable post-event closeout');
requireText('src/screens/VenueOperationsScreen.tsx', 'LEARNING CONTEXT', 'host evidence surface must expose the context that bounds outcome transfer');
requireText('src/screens/VenueOperatorsScreen.tsx', 'Role permission and analytical permission are separate checks', 'operator roster UI must preserve the distinction between human authorization and model admission');
requireText('src/components/VenueServiceStatusCard.tsx', 'coarse wait bands', 'participant service utility must remain coarse rather than exposing raw queue telemetry');
forbidText('src/components/VenueServiceStatusCard.tsx', 'queue_length', 'participant service UI must not expose raw queue counts');
requireText('src/screens/EventLobbyScreen.tsx', '<VenueServiceStatusCard', 'confidence-gated venue service utility must be integrated into the attendee lobby');
requireText('src/navigation/RootNavigator.tsx', 'VenueOperationsScreen', 'host venue operations must be reachable through navigation');
requireText('src/navigation/RootNavigator.tsx', 'VenueOperatorsScreen', 'host venue operator roster must be reachable through navigation');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('VenueOperations'", 'host control deck must expose the venue operations surface');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('VenueOperators'", 'host control deck must expose venue operator delegation');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'append-only', 'venue operation audit evidence must be append-only');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'on conflict (event_id, idempotency_key) do nothing', 'operator event retries must preserve append-only idempotency');
requireText('supabase/migrations/030_venue_operations_control_plane.sql', 'revoke insert, update, delete', 'authenticated clients must not receive direct mutation rights on venue evidence tables');
requireText('supabase/migrations/031_public_venue_service_status.sql', 'is_approved_participant', 'participant service status must be event-membership scoped');
requireText('supabase/migrations/031_public_venue_service_status.sql', 's.sample_support >= 8', 'participant service status must be sample-support gated');
requireText('supabase/migrations/031_public_venue_service_status.sql', 's.confidence >= 0.72', 'participant service status must be confidence gated');
requireText('supabase/migrations/031_public_venue_service_status.sql', "interval '2 minutes'", 'participant service status must expire stale queue evidence');
requireText('supabase/migrations/032_venue_operator_roles.sql', 'can_execute_venue_command', 'venue command class authority must be enforced server-side');
requireText('supabase/migrations/032_venue_operator_roles.sql', 'count(distinct a.operator_id)', 'safety-class intervention application must require distinct server-recorded approvals');
requireText('supabase/migrations/032_venue_operator_roles.sql', "interval '5 minutes'", 'high-impact approvals must expire instead of persisting indefinitely');
requireText('supabase/migrations/032_venue_operator_roles.sql', 'append_venue_operator_action', 'assigned venue operators need a scoped append-only action path');
requireText('supabase/migrations/033_trusted_venue_command_admission.sql', 'venue_admitted_commands', 'server control admission must persist trusted command authority separately from client UI state');
requireText('supabase/migrations/034_event_lifecycle_for_operational_history.sql', 'ended_at', 'event lifecycle must preserve a non-destructive closed state');
requireText('supabase/migrations/035_event_lifecycle_access_boundaries.sql', 'null::text as access_code', 'pre-membership join-code lookup must not disclose the event access secret');
requireText('supabase/migrations/035_event_lifecycle_access_boundaries.sql', 'approve_self_with_event_code', 'event code approval must bind to auth.uid()');
requireText('supabase/migrations/035_event_lifecycle_access_boundaries.sql', 'revoke execute on function public.approve_participant_with_code', 'legacy caller-selected approval RPC must lose authenticated execute authority');
requireText('supabase/migrations/036_venue_operations_release_pinning.sql', 'venue_operation_releases_one_active_idx', 'a live event must have at most one active operations release identity');
requireText('supabase/migrations/036_venue_operations_release_pinning.sql', 'retire_venue_release_after_event_end', 'closing an event must retire its live operations release');
requireText('supabase/migrations/037_context_scoped_venue_learning.sql', 'learning_context_key', 'measured intervention storage must carry an explicit learning-context key');
requireText('supabase/migrations/037_context_scoped_venue_learning.sql', 'revoke insert, update, delete', 'mobile clients must not rewrite venue learning context after the fact');
requireText('supabase/migrations/038_event_operations_closeout.sql', 'venue_event_closeouts', 'event closure must preserve an immutable aggregate operations closeout');
requireText('supabase/migrations/038_event_operations_closeout.sql', 'on conflict (event_id) do nothing', 'event closeout must be retry-safe and immutable');
requireText('supabase/migrations/039_event_runtime_invariants.sql', "status = 'pending'", 'direct participant insert must not self-approve around the server join flow');
requireText('supabase/migrations/039_event_runtime_invariants.sql', 'revoke insert, update on public.connection_requests', 'scarce connection activation must not have a direct table mutation bypass');
requireText('supabase/migrations/039_event_runtime_invariants.sql', 'is_event_operational', 'participant service status and writes must close with the event');
requireText('supabase/migrations/040_atomic_event_creation.sql', 'create_hosted_event', 'event creation and host membership must commit atomically');
requireText('supabase/migrations/040_atomic_event_creation.sql', 'gen_random_bytes', 'authoritative human-readable join codes must be generated server-side with cryptographic randomness');
requireText('supabase/migrations/040_atomic_event_creation.sql', "status = 'approved'", 'atomic event creation must establish approved host membership before commit');
requireText('supabase/migrations/041_venue_audit_integrity_chain.sql', 'chain_sequence', 'venue operational audit records need deterministic event-scoped chain order');
requireText('supabase/migrations/041_venue_audit_integrity_chain.sql', 'record_hash', 'venue operational audit records need tamper-evident server hashes');
requireText('supabase/migrations/041_venue_audit_integrity_chain.sql', 'verify_venue_operation_audit_chain', 'host/operator evidence must have a server-side integrity verifier');
requireText('supabase/migrations/041_venue_audit_integrity_chain.sql', 'not an external signature', 'hash-chain evidence must not be misrepresented as external notarization');

for (const path of requiredFiles.filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))) {
  forbidText(path, 'Math.random(', 'venue operations must remain deterministic and reviewable');
}

for (const path of [
  'src/spatial/SpatialVenueTwinEngine.ts',
  'src/spatial/VenueObservationContract.ts',
  'src/spatial/VenueObservationBuffer.ts',
  'src/spatial/VenueObservationConsensus.ts',
  'src/spatial/VenueSensorHealth.ts',
  'src/spatial/VenueServicePoint.ts',
  'src/spatial/VenueDecisionProvenance.ts',
  'src/spatial/VenueRecommendationCalibration.ts',
  'src/spatial/VenueOperationsRelease.ts',
  'src/spatial/VenueLearningContext.ts',
  'src/spatial/VenueEventCloseout.ts',
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
