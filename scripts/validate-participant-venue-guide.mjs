import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required participant-guide file: ${path}`);
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

const migration = 'supabase/migrations/047_participant_service_guidance.sql';
const service = 'src/services/venue-participant-guide.service.ts';
const engine = 'src/spatial/VenueParticipantGuide.ts';
const card = 'src/components/VenueServiceStatusCard.tsx';
const lobby = 'src/screens/EventLobbyScreen.tsx';

for (const path of [migration, service, engine, card, lobby]) read(path);

requireText(migration, 'get_live_venue_service_guidance', 'participant guidance needs a dedicated server projection rather than raw service-table reads');
requireText(migration, 'is_approved_participant', 'live service guidance must be event-membership scoped');
requireText(migration, 'is_event_operational', 'live participant guidance must disappear when an event closes');
requireText(migration, "interval '2 minutes'", 'current public service evidence must have a short freshness window');
requireText(migration, 'current_row.sample_support >= 8', 'public service guidance must require minimum aggregate support');
requireText(migration, 'current_row.confidence >= 0.72', 'public service guidance must require minimum confidence');
requireText(migration, "'easing'", 'participant guidance should expose only a coarse observed trend');
requireText(migration, "'building'", 'participant guidance should expose only a coarse observed trend');
requireText(migration, 'No raw queue counts or service history are released', 'database contract must state the participant privacy boundary');

forbidText(service, ".from('venue_service_point_samples')", 'participant service code must not bypass the privacy-gated RPC to read raw queue samples');
requireText(service, ".rpc('get_live_venue_service_guidance'", 'participant service must use the dedicated privacy-gated RPC');
requireText(service, 'raw queue length, arrivals, completions, or service', 'service boundary must explicitly preserve data minimization');

requireText(engine, 'not a popularity model', 'participant ranking must reject popularity/scarcity semantics');
requireText(engine, 'coarse status', 'participant ranking may use only the coarse projection already released by the server');
requireText(engine, 'primary', 'participant guide must identify one useful observed option without fabricating a recommendation');
forbidText(engine, 'Math.random(', 'participant venue guidance must remain deterministic and reviewable');

requireText(card, 'coarse wait bands', 'participant UI must expose wait bands instead of raw queue telemetry');
requireText(card, 'they are not predictions', 'service trend UI must preserve observed-versus-predicted semantics');
requireText(card, 'Raw queue counts and service history remain host-private', 'participant UI must state the raw-data boundary');
requireText(lobby, '<VenueServiceStatusCard', 'live venue utility must remain integrated into the attendee lobby');

for (const path of [service, engine, card]) {
  forbidText(path, 'personId', 'participant venue guidance must not introduce person-level mobility history');
  forbidText(path, 'targetId', 'participant venue guidance must not repurpose attendee identifiers');
}

if (failures.length > 0) {
  console.error('Participant venue guidance validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Participant venue guidance validation passed.');
