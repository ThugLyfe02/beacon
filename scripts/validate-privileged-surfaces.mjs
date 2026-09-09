import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing privileged-surface file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  if (!read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  if (read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

const files = [
  'supabase/migrations/038_secure_escort_orchestration.sql',
  'supabase/migrations/039_secure_escort_orchestration_runtime.sql',
  'supabase/migrations/040_office_hours_state_machine.sql',
  'supabase/migrations/041_office_hours_call_authorization.sql',
  'supabase/migrations/042_escort_notification_idempotency.sql',
  'supabase/functions/livekit-token/index.ts',
  'supabase/functions/escort-notify/index.ts',
  'src/services/escort.service.ts',
  'src/services/officeHours.service.ts',
  'src/screens/EscortPanelScreen.tsx',
  'src/screens/OfficeHoursCallScreen.tsx',
  'src/screens/OfficeHoursInboxScreen.tsx',
];
for (const file of files) read(file);

requireText(
  'supabase/migrations/038_secure_escort_orchestration.sql',
  "add value if not exists 'escort_assignment'",
  'escort control-plane enum must be reserved in its own committed migration',
);
forbidText(
  'supabase/migrations/038_secure_escort_orchestration.sql',
  "'escort_assignment'::public.security_action_kind",
  'new enum value must not be used in the same migration transaction that adds it',
);

for (const [text, explanation] of [
  ['revoke insert, update, delete on table public.venue_rooms from authenticated', 'venue-room mutation must not bypass host RPCs'],
  ['create_venue_room_secure', 'room creation must be host/lifecycle checked'],
  ['get_host_escort_queue', 'host queue identity lookup must be a narrow definer surface'],
  ['assign_escort_room_secure', 'room assignment must be atomic'],
  ["'escort_assignment'::public.security_action_kind", 'escort assignment must use the security control plane after enum commit'],
  ['Room is already committed during this Office Hours window', 'overlapping room assignments must fail at the database'],
]) requireText('supabase/migrations/039_secure_escort_orchestration_runtime.sql', text, explanation);

for (const [text, explanation] of [
  ['venue_rooms_assigned_party_select', 'attendees should only see rooms assigned to their own Office Hours'],
  ['revoke update on table public.office_hours_requests from authenticated', 'parties must not directly mutate arbitrary Office Hours columns'],
  ['transition_office_hours_request', 'party state changes must use an explicit transition RPC'],
  ['Only the recipient can accept a pending request', 'acceptance authority must remain recipient-only'],
  ['office_hours_completion_confirmations', 'completion must persist independent party receipts'],
  ['confirm_office_hours_completion', 'Office Hours completion must use two-party confirmation'],
  ['v_count >= 2', 'completed status must require both confirmations'],
  ['get_office_hours_completion_state', 'clients need confirmation-aware read state'],
]) requireText('supabase/migrations/040_office_hours_state_machine.sql', text, explanation);

for (const [text, explanation] of [
  ['get_office_hours_call_context', 'LiveKit eligibility must be centralized in Postgres'],
  ['not public.event_is_unfinalized', 'finalization must revoke call eligibility'],
  ['user_blocks', 'block relationships must revoke call eligibility'],
  ['office_hours_enabled', 'event security controls must revoke call eligibility'],
  ["interval '5 minutes'", 'call grant must remain narrowly time bounded'],
  ['token_ttl_seconds', 'token TTL must be capped to authorized time remaining'],
]) requireText('supabase/migrations/041_office_hours_call_authorization.sql', text, explanation);

requireText(
  'supabase/migrations/042_escort_notification_idempotency.sql',
  'primary key (request_id, room_id)',
  'escort push delivery must be idempotent per authoritative assignment',
);
requireText(
  'supabase/migrations/042_escort_notification_idempotency.sql',
  'No client policies',
  'notification delivery ledger must remain service-only',
);

for (const [text, explanation] of [
  ["rpc('get_office_hours_call_context'", 'edge token issuer must consume the canonical DB authorization context'],
  ['ttl: ttlSeconds', 'LiveKit JWT lifetime must be bounded by authorized window'],
  ["'cache-control': 'no-store'", 'token responses must not be cacheable'],
  ['Call is not currently available', 'authorization failures should collapse to a non-oracle response'],
]) requireText('supabase/functions/livekit-token/index.ts', text, explanation);
forbidText(
  'supabase/functions/livekit-token/index.ts',
  'ttl: 60 * 60',
  'LiveKit grants must not return to a generic one-hour TTL',
);

for (const [text, explanation] of [
  ['SUPABASE_SERVICE_ROLE_KEY', 'push-token reads must happen only inside the trusted edge function'],
  ['event.host_id !== user.id', 'notification side effect must verify the caller is the host'],
  ["request.status !== 'awaiting_escort'", 'only committed escort assignments may notify'],
  ['escort_notification_deliveries', 'push side effects must claim idempotency before send'],
  ["claimError.code === '23505'", 'replayed notification calls must become no-ops'],
  ['request.room_id', 'room identity must be derived from committed DB state'],
]) requireText('supabase/functions/escort-notify/index.ts', text, explanation);
forbidText(
  'supabase/functions/escort-notify/index.ts',
  'body.roomId',
  'escort notification must never trust a client-supplied room ID',
);

for (const [text, explanation] of [
  ["rpc('assign_escort_room_secure'", 'client room assignment must use atomic host RPC'],
  ["rpc('create_venue_room_secure'", 'client room creation must use host RPC'],
  ["rpc('get_host_escort_queue'", 'host queue must use narrow definer read surface'],
  ['body: { officeHoursRequestId }', 'notification request must omit client room metadata'],
]) requireText('src/services/escort.service.ts', text, explanation);

for (const [text, explanation] of [
  ["rpc('transition_office_hours_request'", 'Office Hours accept/decline/cancel must use explicit state machine'],
  ["rpc('confirm_office_hours_completion'", 'completion must record one party receipt'],
  ["rpc('get_office_hours_completion_state'", 'inbox must read evidence-backed completion state'],
]) requireText('src/services/officeHours.service.ts', text, explanation);
forbidText(
  'src/services/officeHours.service.ts',
  ".from('office_hours_requests')\n    .update",
  'Office Hours service must not return to direct row mutation',
);

for (const [text, explanation] of [
  ['roomConflicts', 'escort UI must derive overlapping room occupancy'],
  ['LIVE WORLD SEALED', 'physical orchestration must visibly seal at event end'],
  ['setInterval(load, 5_000)', 'host physical world should adapt to live room/queue changes'],
]) requireText('src/screens/EscortPanelScreen.tsx', text, explanation);

for (const [text, explanation] of [
  ['End & confirm my side', 'ending a call must not silently claim shared completion'],
  ['Leave without confirming', 'users need an explicit exit that makes no outcome claim'],
  ['confirmOfficeHoursCompletion', 'call surface must record only explicit evidence'],
]) requireText('src/screens/OfficeHoursCallScreen.tsx', text, explanation);

for (const [text, explanation] of [
  ['TWO-PARTY COMPLETION SEALED', 'inbox must distinguish evidence-backed completion'],
  ['Your confirmation is sealed', 'one-sided confirmation must remain visibly incomplete'],
  ['Confirm my side', 'in-person/session confirmation must remain explicit'],
  ['One-sided confirmation does not count as completion', 'UI must preserve evidence semantics'],
]) requireText('src/screens/OfficeHoursInboxScreen.tsx', text, explanation);

if (failures.length > 0) {
  console.error('\nPrivileged surface validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Privileged escort, Office Hours, LiveKit, and notification contract passed.');
