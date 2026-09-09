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
  'src/services/proximity.service.ts',
  'src/services/premium.service.ts',
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
