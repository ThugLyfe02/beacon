import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing offline handshake artifact: ${path}`);
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

const migration = 'supabase/migrations/059_offline_event_handshakes.sql';
const protocol = 'src/handshake/OfflineHandshakeProtocol.ts';
const localStore = 'src/handshake/OfflineHandshakeLocalStore.ts';
const transport = 'src/handshake/HandshakeTransport.ts';
const service = 'src/services/offline-handshake.service.ts';
const screen = 'src/screens/MeetInBeaconScreen.tsx';
const preview = 'src/components/MeetInBeaconPreview.tsx';
const docs = 'docs/OFFLINE_EVENT_HANDSHAKE.md';
const navigator = 'src/navigation/RootNavigator.tsx';
const lobby = 'src/screens/EventLobbyScreen.tsx';
const files = [migration, protocol, localStore, transport, service, screen, preview, docs, navigator, lobby];
files.forEach(read);

requireText(migration, 'event_handshake_capabilities', 'server-minted short-lived capability state must be durable');
requireText(migration, 'offer_token_hash', 'plaintext QR offer token must not be stored server-side');
requireText(migration, 'manual_code_hash', 'manual fallback code must be stored only as a digest');
requireText(migration, "protocol_version smallint not null default 1", 'handshake envelope must be explicitly versioned');
requireText(migration, "expires_at <= valid_from + interval '25 minutes'", 'individual capabilities must remain short lived');
requireText(migration, "reconcile_until <= expires_at + interval '6 hours 5 minutes'", 'post-event/offline reconciliation must remain bounded');
requireText(migration, 'event_handshake_confirmations', 'both explicit device roles need server-side confirmation state');
requireText(migration, "role text not null check (role in ('initiator','responder'))", 'confirmation role must be explicit and bounded');
requireText(migration, 'primary key (capability_id, role)', 'one capability may have at most one confirmation per role');
requireText(migration, 'event_handshake_verifications', 'verified physical interaction evidence must be immutable and separate from pending state');
requireText(migration, "'explicit-local-handshake'", 'offline reconciliation needs an honest evidence class');
requireText(migration, "'server-live-handshake'", 'live server confirmation needs a distinct evidence class');
requireText(migration, 'event_handshake_audit', 'protocol failures need append-only operational evidence without secrets');
requireText(migration, 'revoke all on public.event_handshake_capabilities from authenticated, anon', 'raw capability rows must not be client readable');
requireText(migration, 'revoke all on public.event_handshake_confirmations from authenticated, anon', 'raw confirmations must not become a participant directory');
requireText(migration, 'pg_advisory_xact_lock', 'two-device concurrent reconciliation must serialize at the database boundary');
requireText(migration, 'v_initiator.ack_hash <> v_responder.ack_hash', 'verification must require the same acknowledgement from both devices');
requireText(migration, 'participant-no-longer-approved', 'current participant authorization must be rechecked at finalization');
requireText(migration, 'event_handshake_pair_safety_hold', 'current pair safety state must be rechecked at finalization');
requireText(migration, 'public.user_blocks', 'a post-handshake block must fail closed');
requireText(migration, 'public.abuse_reports', 'a pairwise abuse report must place offline reconciliation behind a safety hold');
requireText(migration, 'Client timestamps are explicitly non-authoritative', 'client wall clock must not be represented as authoritative proof');
requireText(migration, 'on conflict (capability_id) do nothing', 'verification creation must be idempotent');
requireText(migration, 'prepare_event_handshake_capabilities', 'participants need a bounded pre-mint path before connectivity disappears');
requireText(migration, 'v_recent_count + v_count > 24', 'capability minting needs abuse/rate protection');
requireText(migration, 'submit_handshake_responder_confirmation', 'responder must have an explicit reconciliation RPC');
requireText(migration, 'submit_handshake_initiator_confirmation', 'initiator must have an explicit reconciliation RPC');
requireText(migration, 'cancel_my_handshake_capability', 'initiator must be able to cancel an unverified local offer');
requireText(migration, 'get_my_verified_event_handshakes', 'participants need a scoped verified-evidence projection');
requireText(migration, 'get_event_handshake_health', 'operators need aggregate protocol-health observability');
requireText(migration, 'v_capability_count < 5', 'host operational metrics must remain cohort gated');

requireText(protocol, "OFFLINE_HANDSHAKE_QR_PREFIX = 'bhs1'", 'QR envelope must have a versioned protocol marker');
requireText(protocol, "kind: 'offer'", 'protocol must distinguish offer from acknowledgement');
requireText(protocol, "kind: 'ack'", 'protocol must distinguish acknowledgement from offer');
requireText(protocol, 'offerLooksLocallyUsable', 'client should reject obvious wrong-event/expired offers before confirmation');
requireText(protocol, 'Crypto.getRandomBytesAsync', 'response acknowledgement must use cryptographic randomness rather than Math.random');
requireText(protocol, 'retryDelayMs', 'offline reconciliation retries must use bounded backoff');
forbidText(protocol, 'userId', 'QR protocol envelopes must not carry reusable participant identity');
forbidText(protocol, 'email', 'QR protocol envelopes must not carry email identity');

requireText(localStore, 'expo-secure-store', 'mobile one-time material must use secure local storage where available');
requireText(localStore, 'WHEN_UNLOCKED_THIS_DEVICE_ONLY', 'iOS keychain persistence should remain device bound');
requireText(localStore, 'previous account', 'local material must not survive as usable state across account switching');
requireText(localStore, 'volatile', 'unsupported platforms need an explicit non-durable fallback instead of silently pretending persistence');
requireText(localStore, 'removePendingHandshake', 'verified/terminal one-time material needs a destruction path');

requireText(transport, "kind: 'qr'", 'QR must be an explicit transport adapter');
requireText(transport, "kind: 'manual'", 'manual accessibility fallback must be a first-class transport adapter');
requireText(transport, "kind: 'nfc'", 'NFC must share the same protocol contract even before native implementation');
requireText(transport, "kind: 'ble'", 'BLE must share the same protocol contract even before native implementation');
requireText(transport, 'passiveDiscoveryCreatesEvidence: false', 'passive discovery must never create interaction evidence');

requireText(service, ".rpc('prepare_event_handshake_capabilities'", 'client capability preparation must use server authority');
requireText(service, ".rpc('submit_handshake_initiator_confirmation'", 'initiator reconciliation must use server authority');
requireText(service, ".rpc('submit_handshake_responder_confirmation'", 'responder reconciliation must use server authority');
requireText(service, 'Destroy the local one-time material after durable server verification', 'successful reconciliation must remove local secrets');
requireText(service, "attempts >= 5 ? 'needs-attention'", 'repeated failures must become visible rather than spin forever');
forbidText(service, ".from('event_handshake_capabilities')", 'mobile client must not bypass the scoped handshake RPC boundary');
forbidText(service, ".from('event_handshake_confirmations')", 'mobile client must not read/write raw confirmation rows');
forbidText(service, ".from('event_handshake_verifications')", 'mobile client must consume verified projection rather than raw evidence table');

requireText(screen, 'CONFIRM & SHOW MY CODE', 'initiator must explicitly act before presenting a handshake');
requireText(screen, 'I CONFIRM THIS MEETING', 'responder must explicitly confirm rather than passive scan becoming evidence');
requireText(screen, 'Saved locally — Beacon will verify when connectivity returns.', 'offline UX must explain local pending state honestly');
requireText(screen, 'CAN’T SCAN? ENTER ONE-TIME CODE', 'camera-independent accessibility fallback must exist');
requireText(screen, 'TRANSPORT ≠ TRUST', 'product UI must make the transport/trust distinction visible');
requireText(screen, 'does not automatically create a connection', 'verified physical interaction must not bypass relationship consent');
requireText(screen, 'react-native-qrcode-svg', 'QR must be rendered locally and remain useful without network access');
requireText(screen, 'CameraView', 'QR response/offer scanning must be implemented on device');

requireText(preview, 'OFFLINE READY', 'event lobby should expose readiness before an outage occurs');
requireText(preview, 'AppState.addEventListener', 'pending handshakes should reconcile when the app returns to foreground');
requireText(preview, 'No passive encounter tracking', 'lobby framing must preserve explicit-interaction semantics');

requireText(navigator, 'MeetInBeacon', 'handshake screen must be part of the real navigation graph');
requireText(lobby, '<MeetInBeaconPreview eventId={eventId} />', 'offline continuity must be visible in the live event lobby');

requireText(docs, 'not cryptographic distance-bounding', 'documentation must explicitly state physical-proof limitations');
requireText(docs, 'BLE is transport, not consent', 'documentation must reject passive Bluetooth encounter collection');
requireText(docs, 'does **not** automatically', 'documentation must preserve relationship-consent separation');
requireText(docs, 'twenty', 'documentation must explain short capability windows');
requireText(docs, 'six hours', 'documentation must explain bounded post-event reconciliation grace');

for (const path of [migration, protocol, localStore, transport, service, screen, preview]) {
  forbidText(path, 'Math.random(', 'handshake identifiers/selection must never rely on Math.random');
  forbidText(path, 'targetPremium', 'offline interaction evidence must not depend on payment status');
  forbidText(path, 'popularityScore', 'offline interaction evidence must not create a popularity score');
  forbidText(path, 'graphDegree', 'offline interaction evidence must not create graph-degree ranking');
}

if (failures.length > 0) {
  console.error('Offline event handshake architecture validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Offline event handshake architecture validation passed (${files.length} required artifacts).`);
