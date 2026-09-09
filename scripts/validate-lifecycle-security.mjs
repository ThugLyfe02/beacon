import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing lifecycle-security file: ${path}`);
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

const requiredFiles = [
  'supabase/migrations/030_close_spatial_world_memory_loop.sql',
  'supabase/migrations/031_atomic_event_finalization.sql',
  'supabase/migrations/032_event_lifecycle_security_lockdown.sql',
  'supabase/migrations/033_security_definer_audit_closure.sql',
  'supabase/migrations/034_user_write_and_location_boundary.sql',
  'supabase/migrations/035_two_party_outcome_commit.sql',
  'supabase/migrations/036_atomic_event_creation_and_access_secrets.sql',
  'supabase/migrations/037_event_column_and_membership_oracle_lockdown.sql',
  'src/services/proximity.service.ts',
  'src/services/premium.service.ts',
  'src/services/outcome-handshake.service.ts',
  'src/services/event.service.ts',
  'src/types/database.ts',
  'src/components/OutcomeHandshakeCard.tsx',
  'src/screens/HostManagementScreen.tsx',
  'src/screens/MapScreen.tsx',
  'src/screens/RadarScreen.tsx',
];
for (const path of requiredFiles) read(path);

for (const [text, explanation] of [
  ['drop policy if exists "events: host delete"', 'normal host DELETE policy must remain removed'],
  ['revoke delete on table public.events from authenticated', 'authenticated clients must not retain event DELETE privilege'],
  ['prevent_established_event_delete', 'service/admin mistakes must not cascade-delete established event history'],
  ['event_accepts_live_actions', 'live mutation and reveal paths need one canonical lifecycle boundary'],
  ['guard_connection_request_write', 'connection inserts must retain a trigger-level invariant inside SECURITY DEFINER'],
  ['guard_match_insert', 'match creation must fail closed outside the live event boundary'],
  ['guard_office_hours_insert', 'Office Hours inserts must independently re-check premium and event eligibility'],
  ['guard_signal_budget_write', 'signal scarcity must remain protected even when RPC RLS is bypassed'],
  ['revoke all on function public.detect_mutual_match', 'legacy mutual creation must not inherit PUBLIC EXECUTE'],
  ['revoke all on function public.get_or_create_signal_budget', 'callers must not self-create arbitrary signal budgets'],
  ['revoke all on function public.claim_access_drop', 'legacy Access Drop claim must not bypass the secure wrapper'],
  ['null::text as access_code', 'pre-membership join-code lookup must never return the access secret'],
  ['p_user_id <> auth.uid()', 'access-code approval must not target an arbitrary supplied user ID'],
  ['get_event_proximity_vectors', 'the immersive field must use server-computed privacy-preserving vectors'],
]) requireText('supabase/migrations/032_event_lifecycle_security_lockdown.sql', text, explanation);

for (const [text, explanation] of [
  ['revoke all on function public.authorize_sensitive_action', 'the control-plane RPC must not inherit anonymous PUBLIC execution'],
  ['grant execute on function public.prune_security_control_plane() to service_role', 'security-log maintenance must remain service-only'],
  ['null::text as email', 'participant discovery must not become an event email directory'],
  ['posts_read_visible_relationships', 'direct post RLS must honor blocks just like feed RPCs'],
  ['get_home_feed', 'home-feed SECURITY DEFINER behavior must remain explicitly audited'],
  ['get_event_feed', 'event-feed SECURITY DEFINER behavior must remain explicitly audited'],
  ['get_user_posts', 'profile-post SECURITY DEFINER behavior must remain explicitly audited'],
  ['revoke all on function public.set_premium_dev', 'development premium escalation must remain unreachable'],
]) requireText('supabase/migrations/033_security_definer_audit_closure.sql', text, explanation);

for (const [text, explanation] of [
  ['revoke update on table public.users from authenticated', 'row-level self-update must not imply all-column write privilege'],
  ['grant update (', 'mobile-owned user columns must be granted explicitly'],
  ['publish_event_location', 'precise location publication must remain event scoped'],
  ['event_accepts_live_actions', 'location publication must stop outside the live event window'],
  ['is_approved_participant', 'location publication must require approved event membership'],
  ['clear_location_when_hidden', 'discoverability opt-out must destroy stored precise location'],
  ['revoke update (is_premium, premium_since)', 'premium columns must remain server owned'],
]) requireText('supabase/migrations/034_user_write_and_location_boundary.sql', text, explanation);

for (const [text, explanation] of [
  ['outcome_handshake_confirmations', 'shared outcome completion must persist independent party receipts'],
  ['guard_aligned_outcome_intent_mutation', 'aligned private intent must not be unilaterally rewritten'],
  ['guard_outcome_handshake_transition', 'shared outcome state transitions must remain monotonic'],
  ['get_outcome_handshake_commit_state', 'clients must read confirmation-aware outcome state'],
  ['confirm_outcome_handshake', 'completion must use the two-party confirmation RPC'],
  ['v_count >= 2', 'shared completion must require both participant confirmations'],
  ['revoke execute on function public.complete_outcome_handshake', 'legacy one-party completion must remain retired'],
]) requireText('supabase/migrations/035_two_party_outcome_commit.sql', text, explanation);

for (const [text, explanation] of [
  ['event_access_secrets', 'event bypass secrets must live outside the readable event row'],
  ["crypt(upper(trim(e.access_code)), gen_salt('bf', 10))", 'historical plaintext access codes must migrate to bcrypt hashes'],
  ['revoke insert on table public.events from authenticated', 'event creation must not remain a direct client table insert'],
  ['revoke insert on table public.event_participants from authenticated', 'participants must not be able to self-insert an approved row'],
  ['create_hosted_event', 'host event and host membership creation must be atomic'],
  ['generate_human_join_code', 'join-code entropy must move to the trusted database transaction'],
  ['set_event_access_code', 'access-code rotation must remain an RPC-only secret operation'],
  ["crypt(upper(trim(p_access_code)), v_hash) = v_hash", 'access-code approval must compare bcrypt hashes rather than plaintext'],
  ['then e.latitude else null::numeric', 'pre-membership event lookup must withhold precise latitude'],
  ['then e.address else null::text', 'pre-membership event lookup must withhold exact address'],
]) requireText('supabase/migrations/036_atomic_event_creation_and_access_secrets.sql', text, explanation);

for (const [text, explanation] of [
  ['revoke update on table public.events from authenticated', 'generic event UPDATE must not imply all-column ownership'],
  ['revoke update (access_code, host_id, join_code, finalized_at)', 'secret/identity/lifecycle event columns must remain server owned'],
  ['p_user_id is distinct from auth.uid()', 'host/participant helpers must not answer arbitrary actor queries'],
  ['Pending/rejected state remains', 'membership helper semantics must not expose pending/rejected membership'],
  ['Caller-scoped approved-membership predicate', 'membership oracle lockdown must remain documented'],
]) requireText('supabase/migrations/037_event_column_and_membership_oracle_lockdown.sql', text, explanation);

requireText(
  'supabase/migrations/031_atomic_event_finalization.sql',
  "set_config('beacon.finalization_event_id'",
  'post-window snapshot creation must be tied to the atomic finalization transaction',
);

requireText(
  'src/services/proximity.service.ts',
  "rpc('get_event_proximity_vectors'",
  'the spatial client must consume vector-only proximity',
);
forbidText(
  'src/services/proximity.service.ts',
  'last_known_lat',
  'raw peer latitude must not re-enter the immersive spatial client',
);
forbidText(
  'src/services/proximity.service.ts',
  'last_known_lng',
  'raw peer longitude must not re-enter the immersive spatial client',
);

requireText(
  'src/services/premium.service.ts',
  "rpc('publish_event_location'",
  'self location must publish through the event-scoped database RPC',
);
forbidText(
  'src/services/premium.service.ts',
  'last_known_lat:',
  'the mobile service must not write precise location columns directly',
);

for (const [text, explanation] of [
  ["rpc('get_outcome_handshake_commit_state'", 'outcome state must include independent confirmation evidence'],
  ["rpc('confirm_outcome_handshake'", 'mobile completion must use two-party confirmation'],
  ['two_party_real_world_outcome_confirmed', 'provenance must distinguish two-party completion from one-party confirmation'],
]) requireText('src/services/outcome-handshake.service.ts', text, explanation);
forbidText(
  'src/services/outcome-handshake.service.ts',
  "rpc('complete_outcome_handshake'",
  'legacy single-party completion RPC must not return to the client',
);

for (const [text, explanation] of [
  ["rpc('create_hosted_event'", 'mobile event creation must use the atomic server transaction'],
  ['setEventAccessCode', 'access-secret rotation must use its dedicated RPC service'],
]) requireText('src/services/event.service.ts', text, explanation);
forbidText('src/services/event.service.ts', ".from('events')\n      .insert", 'direct client event inserts must remain retired');
forbidText('src/services/event.service.ts', ".from('event_participants')\n      .insert", 'host membership must remain part of the atomic creation RPC');

for (const [text, explanation] of [
  ['export type EventInsert = never', 'domain types must forbid direct event inserts'],
  ['export type EventParticipantInsert = never', 'domain types must forbid direct participant inserts'],
  ['export type ConnectionRequestInsert = never', 'domain types must preserve RPC-only high-intent signals'],
  ["| 'ends_at'", 'event update type must enumerate host-owned mutable columns'],
]) requireText('src/types/database.ts', text, explanation);

for (const [text, explanation] of [
  ['Confirm my side', 'outcome UI must frame completion as independent confirmation'],
  ['Your confirmation is sealed', 'the first confirmer needs an explicit waiting state'],
  ['Two-party outcome confirmed', 'the UI must distinguish shared completion backed by both receipts'],
  ['does not retroactively invent them', 'legacy completion must not be mislabeled as two-party evidence'],
]) requireText('src/components/OutcomeHandshakeCard.tsx', text, explanation);

for (const [text, explanation] of [
  ['Window ended · outcomes unsealed', 'hosts need an explicit post-window/pre-finalization state'],
  ['REFLECTION MODE', 'host UX must visibly transition with database lifecycle truth'],
  ['The live world is sealed.', 'post-window UI must explain that live mutation has stopped'],
  ['Seal outcomes & memory', 'finalization must remain the primary post-window action'],
]) requireText('src/screens/HostManagementScreen.tsx', text, explanation);
forbidText(
  'src/screens/HostManagementScreen.tsx',
  'deleteEvent(',
  'host lifecycle must never return to destructive event deletion',
);

for (const [text, explanation] of [
  ['eventWindowState', 'map behavior must distinguish live, upcoming, and historical events'],
  ['lifecycleNow', 'long-lived map sessions must adapt when event time boundaries change'],
  ['activeEventId', 'Radar and location publication must bind to a genuinely live event'],
  ['premium.isDiscoverable', 'premium proximity must preserve mutual visibility'],
  ['showDevControls={false}', 'production UI must not advertise disabled self-premium escalation'],
  ['Past events remain preserved for Vault, outcomes and memory', 'history must stay available conceptually without masquerading as live presence'],
]) requireText('src/screens/MapScreen.tsx', text, explanation);

for (const [text, explanation] of [
  ['getEventById', 'Radar must know the authoritative event lifecycle rather than infer it from empty peers'],
  ['sweep.stopAnimation', 'Radar motion must physically stop when live proximity is sealed'],
  ['Radar · sealed', 'the user must see that live scanning has ended'],
  ['Afterglow', 'post-window Radar must transition into a distinct reflection state'],
  ['No more proximity reveals.', 'sealed Radar must explain the privacy boundary'],
]) requireText('src/screens/RadarScreen.tsx', text, explanation);

if (failures.length > 0) {
  console.error('\nLifecycle security validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Lifecycle security and adaptive-world contract passed.');
