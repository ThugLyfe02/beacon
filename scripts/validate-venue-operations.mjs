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
  'src/spatial/VenueModelCredibility.ts',
  'src/spatial/VenueReadiness.ts',
  'src/spatial/VenueLayoutVersioning.ts',
  'src/spatial/VenueOperatingEnvelope.ts',
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
requireText('src/spatial/VenueTopology.ts', 'singleLinkDependencyZoneIds', 'topology must expose route fragility rather than treating all spare capacity as reachable');
requireText('src/spatial/VenueTopology.ts', 'not an emergency egress', 'topology must not be represented as a life-safety routing system');
requireText('src/spatial/VenueRoutingPolicy.ts', 'requiresAccessible', 'normal venue routing must preserve configured accessibility constraints');
requireText('src/spatial/VenueRoutingPolicy.ts', 'not an emergency egress', 'routing policy must preserve its non-emergency boundary');
requireText('src/spatial/VenueServicePoint.ts', 'publicEstimateEligible', 'wait estimates must be support and confidence gated before public use');
requireText('src/spatial/VenueSamplingPolicy.ts', 'cadence, not truth', 'adaptive sensing may reduce cadence but cannot remove truth-bearing zones');
requireText('src/spatial/VenueDeploymentPolicy.ts', "'shadow'", 'new recommendation logic must support shadow deployment');
requireText('src/spatial/VenueDeploymentPolicy.ts', 'human-in-the-loop', 'deployment maturity must not silently authorize automatic interventions');
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

for (const path of requiredFiles.filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))) {
  forbidText(path, 'Math.random(', 'venue operations must remain deterministic and reviewable');
}

for (const path of [
  'src/spatial/SpatialVenueTwinEngine.ts',
  'src/spatial/VenueObservationContract.ts',
  'src/spatial/VenueSensorHealth.ts',
  'src/spatial/VenueServicePoint.ts',
  'src/spatial/VenueDecisionProvenance.ts',
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
