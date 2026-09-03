import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing participant outcome receipt artifact: ${path}`);
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

const migration = 'supabase/migrations/061_participant_outcome_receipts.sql';
const model = 'src/outcomes/OutcomeReceiptModel.ts';
const service = 'src/services/outcome-receipt.service.ts';
const participantCard = 'src/components/OutcomeReceiptCard.tsx';
const hostCard = 'src/components/OutcomeReceiptEvidenceCard.tsx';
const communityCard = 'src/components/CommunityOutcomeReceiptEvidence.tsx';
const matchesScreen = 'src/screens/MatchesScreen.tsx';
const hostScreen = 'src/screens/HostManagementScreen.tsx';
const communityScreen = 'src/screens/CommunityExchangeScreen.tsx';
const handshakeCard = 'src/components/OutcomeHandshakeCard.tsx';
const handshakeDocs = 'docs/OUTCOME_HANDSHAKE_PROTOCOL.md';
const docs = 'docs/PARTICIPANT_OUTCOME_RECEIPTS.md';
const files = [
  migration,
  model,
  service,
  participantCard,
  hostCard,
  communityCard,
  matchesScreen,
  hostScreen,
  communityScreen,
  handshakeCard,
  handshakeDocs,
  docs,
];
files.forEach(read);

requireText(migration, 'participant_outcome_receipt_streams', 'every participant needs one private receipt stream per real mutual');
requireText(migration, 'participant_outcome_receipt_events', 'receipt revisions and withdrawals must be append-only events');
requireText(migration, 'participant_outcome_receipt_context_links', 'system provenance needs private context links rather than host-visible pair rows');
requireText(migration, "event_type in ('submitted','withdrawn')", 'receipt lifecycle events must be bounded');
requireText(migration, 'supersedes_event_id', 'a revision must supersede rather than rewrite earlier evidence');
requireText(migration, 'idempotency_key text not null', 'receipt writes need retry-stable command identity');
requireText(migration, 'unique (participant_id, idempotency_key)', 'duplicate client retries must collapse at the database boundary');
requireText(migration, 'reject_participant_outcome_receipt_update', 'receipt evidence must reject in-place mutation');
requireText(migration, 'participant outcome receipt evidence is append-only', 'database immutability must be explicit');
requireText(migration, 'revoke all on public.participant_outcome_receipt_streams from authenticated, anon', 'raw receipt streams must not be client-readable');
requireText(migration, 'revoke all on public.participant_outcome_receipt_events from authenticated, anon', 'raw receipt history must not be client-readable');
requireText(migration, 'revoke all on public.participant_outcome_receipt_context_links from authenticated, anon', 'raw provenance links must not be client-readable');

for (const type of [
  'spoke',
  'contact_exchanged',
  'follow_up_sent',
  'meeting_scheduled',
  'office_hours_occurred',
  'warm_introduction_completed',
  'hiring_conversation_continued',
  'partnership_conversation_continued',
  'mentor_session_occurred',
  'collaboration_continued',
  'feedback_received',
  'still_open',
  'no_further_action',
]) {
  requireText(migration, `'${type}'`, `bounded receipt vocabulary must include ${type}`);
  requireText(model, `'${type}'`, `client vocabulary must mirror server receipt type ${type}`);
}

requireText(migration, 'resolve_outcome_receipt_compatibility', 'bilateral compatibility must be deterministic and reviewable');
requireText(migration, "then 'exact'", 'identical independent receipts need a stronger bilateral state');
requireText(migration, "'meeting_scheduled', 'office_hours_occurred'", 'reviewed semantic compatibility should cover meeting progression without requiring verbatim equality');
requireText(migration, "'mentor_session_occurred', 'office_hours_occurred'", 'reviewed semantic compatibility should cover a mentorship Office Hours session');
requireText(migration, "'follow_up_sent'", 'follow-up remains a bounded fact');
forbidText(migration, "('follow_up_sent', 'meeting_scheduled')", 'loosely related follow-up and scheduling facts must not be promoted into bilateral confirmation');

requireText(migration, 'outcome_receipt_pair_blocked', 'current bilateral safety state must gate new outcome submissions');
requireText(migration, 'public.user_blocks', 'blocks must fail closed for new receipt submissions');
requireText(migration, "v_match.created_at + interval '60 days'", 'post-event receipt collection needs a bounded observation window');
requireText(migration, 'pg_advisory_xact_lock', 'concurrent revisions must serialize at the database boundary');
requireText(migration, 'v_recent >= 8 or v_total >= 24', 'receipt revision spam needs bounded velocity and lifetime volume');
requireText(migration, "v_previous.receipt_type = p_receipt_type", 'duplicate same-type submissions must not create artificial revision volume');
requireText(migration, 'withdraw_my_outcome_receipt', 'participants must be able to withdraw their own current attestation');

requireText(migration, 'outcome_receipt_system_evidence', 'system provenance must be snapshotted separately from participant claims');
requireText(migration, "'verified-mutual'", 'a real mutual is the base evidence class');
requireText(migration, "'declared-fit-mutual'", 'declared-fit mutual context should strengthen provenance when present');
requireText(migration, 'event_handshake_verifications', 'explicit physical handshake evidence should be usable as context');
requireText(migration, "'office-hours-completed'", 'completed Office Hours should be available as system context');
requireText(migration, "'warm-introduction-accepted'", 'accepted warm introduction should be available as system context');
requireText(migration, "'focus-window-shared-opt-in'", 'focus-window evidence must honestly remain an opt-in context rather than claimed attendance');
requireText(migration, "'community-exchange-context'", 'approved community exchange should be available as system context');
requireText(migration, 'outcome_receipt_origin_context', 'one deterministic explanatory origin context should be selected');
requireText(migration, 'capture_outcome_receipt_context_links', 'all qualifying provenance should be retained privately for scoped aggregate evidence');

requireText(migration, 'get_my_outcome_receipt', 'participants need an RPC-only current projection');
requireText(migration, "v_alignment := 'participant-attested'", 'one-sided evidence must remain explicitly unilateral');
requireText(migration, "v_alignment := 'counterpart-compatible'", 'compatible independent evidence needs a bounded bilateral state');
requireText(migration, "v_alignment := 'bilaterally-confirmed'", 'exact independent evidence needs a distinct bilateral state');
requireText(migration, 'case when v_compatibility is not null and not v_blocked then v_peer.receipt_type else null end', 'incompatible or blocked counterpart receipt state must stay private');

requireText(migration, 'get_event_outcome_receipt_summary', 'hosts need a purpose-built aggregate receipt projection');
requireText(migration, 'coalesce(v_attested, 0) < 5', 'host receipt evidence must remain suppressed below five attested mutuals');
requireText(migration, 'get_event_outcome_receipt_types', 'hosts need cohort-gated receipt-type composition rather than pair rows');
requireText(migration, 'g.match_count >= 5', 'receipt type/domain rows need their own five-mutual release threshold');
requireText(migration, 'get_event_outcome_receipt_domains', 'hosts need supported declared-domain outcome composition');
requireText(migration, 'receipt_share_of_mutuals', 'host semantics must use a precise share denominator');
requireText(migration, 'get_community_exchange_outcome_receipt_summary', 'community exchange owners need a separately scoped aggregate receipt projection');
requireText(migration, 'v_a_count < 5 or v_b_count < 5 or coalesce(v_receipts, 0) < 5', 'community evidence needs bilateral cohort support plus five receipt-bearing mutuals');
requireText(migration, 'receipt_share_of_cross_community_mutuals', 'community evidence needs an explicit supported denominator');
requireText(migration, 'Legacy private next-step alignment completion share', 'the old handshake completion metric must be explicitly deprecated as real-world conversion evidence');

requireText(service, "from 'expo-crypto'", 'client idempotency keys must use an established cryptographic RNG');
requireText(service, 'Crypto.getRandomBytesAsync', 'receipt command identity must not use Math.random');
requireText(service, ".rpc('get_my_outcome_receipt'", 'participant reads must use a scoped RPC');
requireText(service, ".rpc('submit_my_outcome_receipt'", 'participant writes must use a scoped RPC');
requireText(service, ".rpc('withdraw_my_outcome_receipt'", 'withdrawals must use the append-only server boundary');
requireText(service, ".rpc('get_event_outcome_receipt_summary'", 'host evidence must use a cohort-gated RPC');
requireText(service, ".rpc('get_community_exchange_outcome_receipt_summary'", 'community evidence must use its scoped aggregate RPC');
forbidText(service, ".from('participant_outcome_receipt_", 'mobile code must never query raw receipt tables directly');

requireText(participantCard, 'What actually happened next?', 'participant UX must ask for a deliberate bounded attestation');
requireText(participantCard, 'Beacon does not inspect messages, email, calendars, response speed, or sentiment', 'participant UX must explain the non-surveillance boundary');
requireText(participantCard, 'Both of you independently confirmed this next step.', 'exact bilateral attestation needs precise human-readable semantics');
requireText(participantCard, 'Both of you recorded compatible evidence.', 'semantic compatibility should be explained without overclaiming');
requireText(participantCard, 'It is not proof of a deal, hire, investment, or commercial result.', 'bilateral receipts must not be promoted into business-success proof');
requireText(participantCard, 'append a withdrawal rather than rewrite', 'withdrawal UX must preserve append-only semantics');
requireText(participantCard, 'SYSTEM CONTEXT · NOT THE CLAIM ITSELF', 'system telemetry and human attestation must stay visually distinct');

requireText(hostCard, 'PARTICIPANT-OWNED OUTCOME EVIDENCE', 'host workspace needs a real aggregate outcome surface');
requireText(hostCard, 'Receipt-specific counts stay withheld until at least five distinct mutuals', 'host UI must explain cohort suppression');
requireText(hostCard, 'RECEIPT SHARE OF MUTUALS', 'host UI must expose a precise composition share rather than fake conversion');
requireText(hostCard, 'does not expose the pair', 'host UI must state the pair privacy boundary');
requireText(communityCard, 'OUTCOME COHORT BUILDING', 'community UI must suppress small receipt cohorts');
requireText(communityCard, 'not a causal partnership conversion rate', 'community analytics must preserve the observational boundary');

requireText(matchesScreen, '<OutcomeReceiptCard', 'outcome receipts must be integrated into the real mutual experience');
requireText(hostScreen, '<OutcomeReceiptEvidenceCard eventId={event.id} />', 'host aggregate evidence must be integrated into the live control workspace');
requireText(communityScreen, '<CommunityOutcomeReceiptEvidence', 'community owners need receipt evidence inside their exchange surface');
requireText(handshakeCard, 'Outcome Receipt', 'legacy intent alignment UX must point to the new explicit evidence layer instead of pretending completion proves an outcome');
requireText(handshakeDocs, 'Participant-Owned Outcome Receipts', 'legacy outcome-handshake documentation must distinguish intent alignment from explicit outcome evidence');

requireText(docs, 'Participant-attested', 'documentation must preserve unilateral semantics');
requireText(docs, 'Counterpart-compatible', 'documentation must explain semantic bilateral evidence');
requireText(docs, 'Bilaterally-confirmed', 'documentation must explain exact bilateral evidence');
requireText(docs, 'No fake funnel language', 'documentation must reject unsupported conversion framing');
requireText(docs, '60 days', 'documentation must explain the bounded post-match observation window');
requireText(docs, 'Real-device / multi-user validation matrix', 'the requested abuse/concurrency/privacy scenarios need an explicit validation plan');
requireText(docs, 'Completed Office Hours exists but neither party submits', 'system evidence must not auto-create semantic receipts');
requireText(docs, 'Explicit physical handshake exists but neither party submits', 'physical evidence must not auto-create semantic receipts');
requireText(docs, 'Accepted warm introduction exists but neither party submits', 'warm-introduction evidence must not auto-create semantic receipts');
requireText(docs, 'Relationship deletion', 'relationship deletion behavior must be explicit rather than orphaning pair evidence');

for (const path of [migration, model, service, participantCard, hostCard, communityCard]) {
  forbidText(path, 'Math.random(', 'outcome evidence must remain deterministic and cryptographically idempotent');
  forbidText(path, 'popularityScore', 'outcome receipts must never become a popularity score');
  forbidText(path, 'relationshipHealth', 'outcome receipts must never become a hidden relationship-health score');
  forbidText(path, 'responseTime', 'response timing must not become outcome evidence');
  forbidText(path, 'sentimentScore', 'sentiment inference must not become outcome evidence');
  forbidText(path, 'messageContent', 'private message content must not become outcome evidence');
  forbidText(path, 'targetPremium', 'payment status must not affect outcome evidence authority');
  forbidText(path, 'verified deal', 'participant attestations must never be called a verified deal');
}

forbidText(migration, 'note text', 'structured participant receipts must not add arbitrary free-text notes');
forbidText(migration, 'message_body', 'receipt evidence must not store message content');
forbidText(migration, 'email_body', 'receipt evidence must not store email content');

if (failures.length > 0) {
  console.error('Participant outcome receipt architecture validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Participant outcome receipt architecture validation passed (${files.length} required artifacts).`);
