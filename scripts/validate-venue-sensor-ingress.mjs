import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required sensor-ingress file: ${path}`);
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

const files = [
  'supabase/migrations/044_venue_sensor_ingress.sql',
  'supabase/migrations/045_live_venue_sensor_feed.sql',
  'supabase/migrations/046_sensor_ingress_edge_boundary.sql',
  'supabase/functions/venue-sensor-ingest/index.ts',
  'src/services/venue-sensor.service.ts',
  'src/services/venue-sensor-feed.service.ts',
  'src/screens/VenueSensorsScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/screens/HostManagementScreen.tsx',
  'docs/VENUE_SENSOR_INGRESS.md',
];
for (const path of files) read(path);

const migration = 'supabase/migrations/044_venue_sensor_ingress.sql';
requireText(migration, "encode(digest(v_token, 'sha256'), 'hex')", 'sensor credentials must be stored as digests rather than plaintext');
requireText(migration, "'bcn_' || encode(gen_random_bytes(32), 'hex')", 'sensor credentials must be unique high-entropy device secrets');
requireText(migration, 'source key already exists; rotate the existing source credential instead', 'shared/reused source credentials must not be silently created');
requireText(migration, 'sensor layout version must match the active venue operations release', 'sensor provisioning must bind to the pinned venue layout');
requireText(migration, 'not public.is_event_operational', 'closed events must reject device provisioning and ingress');
requireText(migration, "p_kind not in ('occupancy','transition','service-point')", 'device ingress must remain aggregate-only and exclude manual operator assertions');
requireText(migration, "p_payload - v_allowed_keys", 'device payloads must use allow-listed fields so identity data cannot ride arbitrary JSON');
requireText(migration, "v_source.last_sequence - 64", 'sensor replay protection must include a bounded out-of-order window');
requireText(migration, 'sequence replay attempted with a different payload', 'duplicate sequences with mutated content must be rejected');
requireText(migration, "now() - interval '10 minutes'", 'stale device telemetry must expire before live venue use');
requireText(migration, 'max_observations_per_minute', 'each sensor credential must have a server-enforced ingress rate limit');
requireText(migration, "retention_until timestamptz not null default (now() + interval '7 days')", 'raw aggregate sensor ingress must have bounded retention');
requireText(migration, 'purge_expired_venue_sensor_observations', 'bounded raw telemetry retention must have an explicit cleanup path');
requireText(migration, 'revoke all on public.venue_sensor_sources from authenticated, anon', 'device credential digests must not be exposed through direct table reads');
requireText(migration, 'revoke all on public.venue_sensor_observations from authenticated, anon', 'raw ingress rows must not be a client-readable mobility store');

requireText('supabase/migrations/046_sensor_ingress_edge_boundary.sql', 'from anon, authenticated', 'external clients must not bypass the bounded edge endpoint and call the privileged ingestion RPC directly');
requireText('supabase/migrations/046_sensor_ingress_edge_boundary.sql', 'to service_role', 'the low-level ingestion RPC must be service-role-only after hardening');
requireText('supabase/functions/venue-sensor-ingest/index.ts', '--no-verify-jwt', 'machine endpoint must document its custom device-auth deployment mode');
requireText('supabase/functions/venue-sensor-ingest/index.ts', "p_ingress_token: body.token", 'edge endpoint must pass the unique sensor credential to the server validator');
requireText('supabase/functions/venue-sensor-ingest/index.ts', 'Do not use it to read', 'service-role edge code must remain confined to the single ingestion primitive');
requireText('supabase/functions/venue-sensor-ingest/index.ts', "'cache-control': 'no-store'", 'sensor credential responses must not be cacheable');
requireText('supabase/functions/venue-sensor-ingest/index.ts', 'Never echo the database message', 'public ingress must not leak internal policy/source detail to credential probes');
forbidText('supabase/functions/venue-sensor-ingest/index.ts', 'console.log(', 'public device ingress must never log request bodies or sensor credentials');

requireText('supabase/migrations/045_live_venue_sensor_feed.sql', 's.active = true', 'live feed must exclude revoked/inactive sources');
requireText('supabase/migrations/045_live_venue_sensor_feed.sql', 'o.retention_until > now()', 'live feed must exclude expired raw ingress');
requireText('supabase/migrations/045_live_venue_sensor_feed.sql', 'o.layout_version = ar.layout_version', 'live feed must stay bound to the current venue release');
requireText('supabase/migrations/045_live_venue_sensor_feed.sql', "now() - interval '10 minutes'", 'operator feed reads must remain time bounded');
requireText('src/services/venue-sensor-feed.service.ts', 'VENUE_OBSERVATION_SCHEMA_VERSION', 'persisted device rows must reconstruct the existing typed observation contract');
requireText('src/services/venue-sensor-feed.service.ts', 'Malformed rows are dropped rather than coerced', 'app-side bridge must fail closed on malformed sensor rows');

requireText('src/services/venue-sensor.service.ts', 'stored only as a digest on the server', 'mobile source provisioning must preserve the one-time plaintext-token rule');
forbidText('src/services/venue-sensor.service.ts', 'AsyncStorage.setItem', 'sensor tokens must not be persisted to mobile AsyncStorage');
requireText('src/screens/VenueSensorsScreen.tsx', 'COPY ONCE', 'host UI must make one-time credential handling explicit');
requireText('src/screens/VenueSensorsScreen.tsx', 'never written to AsyncStorage or analytics', 'host UI must explain plaintext credential handling');
requireText('src/screens/VenueSensorsScreen.tsx', 'Device ingress accepts only aggregate occupancy, transition, and service-point payloads', 'host UI must preserve the aggregate-only device boundary');
forbidText('src/screens/VenueSensorsScreen.tsx', 'token_digest', 'host UI must never render stored credential digests');
requireText('src/navigation/RootNavigator.tsx', 'VenueSensorsScreen', 'sensor source control must be reachable through navigation');
requireText('src/screens/HostManagementScreen.tsx', "navigation.navigate('VenueSensors'", 'live hosts must have an explicit sensor source control entry point');
requireText('docs/VENUE_SENSOR_INGRESS.md', 'duplicate `(source, sequence)`', 'integrators need explicit idempotency and replay semantics');
requireText('docs/VENUE_SENSOR_INGRESS.md', 'device credential -> edge ingress -> bounded aggregate observation', 'integration docs must preserve the separation between device authentication and operational authority');
requireText('docs/VENUE_SENSOR_INGRESS.md', 'External devices cannot call the lower-level database ingestion primitive directly', 'integration docs must describe the edge/database privilege boundary');

for (const path of [
  'src/services/venue-sensor.service.ts',
  'src/services/venue-sensor-feed.service.ts',
  'src/screens/VenueSensorsScreen.tsx',
  'supabase/functions/venue-sensor-ingest/index.ts',
]) {
  forbidText(path, 'personId', 'sensor integration must not introduce attendee identity fields');
  forbidText(path, 'targetId', 'sensor integration must not introduce spatial attendee target identifiers');
}

if (failures.length > 0) {
  console.error('Venue sensor ingress validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Venue sensor ingress validation passed (${files.length} required artifacts).`);
