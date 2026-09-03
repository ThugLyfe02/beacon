import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing Partner Commitment Ledger artifact: ${path}`);
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

const migration = 'supabase/migrations/062_partner_commitment_ledger.sql';
const model = 'src/partners/PartnerCommitmentModel.ts';
const service = 'src/services/partner-commitment.service.ts';
const panel = 'src/components/PartnerCommitmentLedgerPanel.tsx';
const communityScreen = 'src/screens/CommunityExchangeScreen.tsx';
const programPanel = 'src/components/CommunityPartnerProgramsPanel.tsx';
const docs = 'docs/PARTNER_COMMITMENT_LEDGER.md';

[migration, model, service, panel, docs].forEach(read);

// Bounded semantics.
for (const type of [
  'mentor_slots',
  'office_hours_slots',
  'hiring_conversations',
  'technical_review_sessions',
  'founder_seats',
  'investor_advisor_sessions',
  'workshops',
  'focus_windows',
  'speaker_sessions',
  'facilitator_hours',
  'community_member_capacity',
  'domain_support_capacity',
]) {
  requireText(migration, `'${type}'`, `bounded commitment vocabulary must include ${type}`);
  requireText(model, `'${type}'`, `client model must include ${type}`);
}
requireText(migration, "commitment_type <> 'domain_support_capacity' or domain is not null", 'domain-specific capacity must carry an explicit reviewed domain');
forbidText(model, 'free_text', 'commitment semantics must not collapse into arbitrary free text');
forbidText(migration, 'private_note', 'raw private notes do not belong in the commitment contract');

// Bilateral authority and anti-fabrication.
requireText(migration, 'a community may propose only its own commitment', 'a host or counterparty must not fabricate another community obligation');
requireText(migration, 'only the current event host may propose a host commitment', 'host commitment authority must be event scoped');
requireText(migration, "array['community-a','community-b']", 'community commitments require both bilateral community roles');
requireText(migration, "array['community-a','community-b','event-host']", 'host commitments require both partners and the host');
requireText(migration, 'bilateral acceptance required before delivery state', 'delivery cannot start before required acceptance');
requireText(migration, 'required-party-rejected', 'counterparty rejection must be explicit audit state');
requireText(migration, 'partner-withdrawn', 'partner withdrawal must be represented explicitly');

// Immutable contract and history.
requireText(migration, 'partner_commitment_revisions', 'accepted configuration must be revisioned');
requireText(migration, 'supersedes_revision_id', 'revisions must explicitly supersede prior contract state');
requireText(migration, 'partner_commitment_decisions', 'acceptance/rejection must have append-only decision events');
requireText(migration, 'partner_commitment_lifecycle_events', 'delivery lifecycle must be append-only');
requireText(migration, 'partner_commitment_measurements', 'measurements must be append-only snapshots');
requireText(migration, 'partner commitment evidence is append-only', 'raw rows must fail closed against in-place update');
requireText(panel, 'Beacon creates a new immutable revision and resets required acceptance', 'UX must explain revision semantics');
requireText(panel, 'REVISION HISTORY', 'both sides need access to explicit supersession history');

// Lifecycle and measurement semantics.
for (const state of ['proposed','accepted','scheduled','delivering','fulfilled','partially_fulfilled','cancelled','not_fulfilled']) {
  requireText(migration, `'${state}'`, `lifecycle must represent ${state}`);
}
requireText(migration, 'Time alone never satisfies a commitment', 'elapsed time cannot be treated as fulfillment evidence');
requireText(migration, 'v_native_delivered >= v_revision.committed_quantity', 'automatic fulfillment must depend on server-recorded delivered quantity');
requireText(migration, 'zero measured delivery is required for not-fulfilled acknowledgement', 'not-fulfilled must be explicit and measured rather than inferred from silence');
requireText(migration, 'p_utilized_quantity > p_delivered_quantity', 'manual utilization cannot exceed acknowledged delivered capacity');
requireText(panel, 'PROMISED', 'shared UX must expose promised quantity');
requireText(panel, 'DELIVERED', 'shared UX must expose delivered quantity');
requireText(panel, 'USED', 'shared UX must expose utilized quantity');
requireText(panel, 'UNUSED', 'shared UX must expose unused delivered capacity');

// Evidence provenance.
for (const evidence of [
  'office-hours-completed',
  'focus-window-state',
  'community-affiliation',
  'outcome-receipts',
  'warm-introduction',
  'manual-operator',
  'event-closeout',
]) {
  requireText(migration, `'${evidence}'`, `evidence provenance must support ${evidence}`);
}
requireText(migration, 'participant_outcome_receipt_context_links', 'outcome receipts must remain linked through server-private provenance rather than inferred causality');
requireText(migration, 'v_outcome_raw >= 5', 'participant receipt results must remain cohort gated');
requireText(migration, 'v_intro_raw >= 5', 'warm-introduction result evidence must remain cohort gated');
requireText(migration, 'capture_partner_commitment_event_closeout', 'event closeout must be explicit evidence without auto-fulfillment');
requireText(panel, 'MANUAL OPERATOR EVIDENCE', 'manual acknowledgement must be visibly lower-authority');
requireText(panel, 'This is observational result evidence, not proof the commitment caused the outcome.', 'result copy must avoid causal overclaim');

// Reusable program memory must reduce configuration cost without inheriting authority.
requireText(migration, 'source_program_id', 'event exchange must preserve optional Partner Program provenance');
requireText(migration, 'prefill_partner_program_commitments', 'accepted program configuration must be reusable as a starting template');
requireText(migration, "'proposed', 'system', null, 'proposal-created'", 'prefilled event commitments must restart as proposals');
requireText(migration, "partner_commitment_acceptance_state(l.id) = 'accepted'", 'only accepted program templates may prefill');
requireText(migration, 'count(distinct m.event_id) >= 2', 'historical suggested quantity needs multiple ended events');
requireText(migration, 'percentile_cont(0.5)', 'historical starting quantity should be robust within the same semantic resource group');
requireText(panel, 'Historical starting point:', 'program UX must expose prior structure as non-binding configuration memory');
requireText(panel, 'This does not create or accept a future commitment.', 'historical memory must never carry future authority');

// Shared visibility and RPC-only mobile access.
requireText(migration, 'shared partnership scope required', 'unrelated communities must fail closed');
for (const table of [
  'partner_commitment_scopes',
  'partner_commitments',
  'partner_commitment_revisions',
  'partner_commitment_decisions',
  'partner_commitment_lifecycle_events',
  'partner_commitment_measurements',
]) {
  requireText(migration, `revoke all on public.${table} from authenticated, anon`, `${table} must not become directly client-readable`);
}
forbidText(service, ".from('partner_commit", 'mobile client must use scoped RPC projections rather than raw commitment tables');
requireText(service, ".rpc('get_partner_commitment_ledger'", 'shared ledger reads must use a server projection');
requireText(service, ".rpc('propose_partner_commitment'", 'commitment proposals must cross the server authority boundary');
requireText(service, ".rpc('decide_partner_commitment_revision'", 'bilateral decisions must cross the server authority boundary');
requireText(service, ".rpc('refresh_partner_commitment_measurement'", 'evidence refresh must happen server side');

// Idempotency and duplicate evidence controls.
requireText(migration, 'strong idempotency key required', 'sensitive writes must require retry-stable idempotency');
requireText(migration, 'unique (revision_id, source_kind, source_id)', 'the same native activity must not become duplicate evidence on one revision');
requireText(service, 'Crypto.getRandomBytesAsync(24)', 'mobile idempotency keys must use cryptographic entropy');
forbidText(service, 'Math.random(', 'idempotency must never use Math.random');

// Product integration. These checks become active once the shared panel is wired.
requireText(communityScreen, '<PartnerCommitmentLedgerPanel', 'event-specific commitments must be visible in the Community Exchange workspace');
requireText(programPanel, '<PartnerCommitmentLedgerPanel', 'reusable Partner Programs must expose commitment templates and institutional memory');

// No primitive reciprocity score or monetary equivalence. Boundary copy may
// explicitly say "leaderboard" only to explain that Beacon does not create one.
for (const path of [migration, model, service, panel]) {
  forbidText(path, 'fairness_score', 'partner commitments must not synthesize a fairness score');
  forbidText(path, 'partner_score', 'partner commitments must not synthesize a partner reputation score');
  forbidText(path, 'monetary_value', 'unlike resources must not be converted into hidden monetary equivalence');
}
requireText(panel, 'No public leaderboard is created.', 'shared UX must explicitly reject public ranking semantics');
requireText(docs, 'not a reputation system', 'documentation must state the non-reputation boundary');

// Deterministic semantic sanity checks independent of the database.
function unused(delivered, utilized) {
  return Math.max(0, delivered - utilized);
}
function canFinalize(committed, delivered) {
  if (delivered >= committed) return 'fulfilled';
  if (delivered > 0) return 'partially_fulfilled';
  return 'not_fulfilled';
}
if (unused(8, 6) !== 2) failures.push('semantic test: 8 delivered / 6 used must leave 2 unused');
if (canFinalize(8, 8) !== 'fulfilled') failures.push('semantic test: exact measured delivery should support fulfilled');
if (canFinalize(8, 6) !== 'partially_fulfilled') failures.push('semantic test: partial measured delivery should remain partial');
if (canFinalize(8, 0) !== 'not_fulfilled') failures.push('semantic test: zero delivery must remain distinct from cancellation');

for (const path of [migration, model, service, panel]) {
  forbidText(path, 'conversion_rate', 'commitment evidence must not invent funnel conversion');
  forbidText(path, 'verified deal', 'participant or operator evidence must not be promoted to a verified business result');
}

const integrityMigration = 'supabase/migrations/064_partner_commitment_contract_integrity.sql';
read(integrityMigration);
requireText(integrityMigration, 'partner_commitment_effective_revision', 'accepted terms must remain effective while an amendment awaits fresh approval');
requireText(integrityMigration, 'partner_commitment_pending_revision', 'pending amendments must be represented separately from effective contract state');
requireText(integrityMigration, "partner_commitment_acceptance_state(d.id) = 'awaiting-acceptance'", 'rejected or withdrawn revisions must never re-surface as actionable pending decisions');
requireText(integrityMigration, "partner_commitment_latest_status(d.id) = 'proposed'", 'only live proposed revisions may expose an acceptance action');
requireText(integrityMigration, 'an overlapping accepted commitment already covers this party, resource type, domain, and delivery window', 'semantically duplicate overlapping commitments must fail closed instead of double-claiming activity');
requireText(integrityMigration, 'partner_commitment_manual_measurement_reviews', 'manual delivery assertions need append-only counterparty review');
requireText(integrityMigration, "decision text not null check (decision in ('acknowledged','disputed'))", 'manual evidence review must preserve explicit acknowledgement and dispute semantics');
requireText(integrityMigration, 'manual delivery assertion may be authored only by the committed party', 'host must not fabricate manual delivery quantities for a partner');
requireText(integrityMigration, 'manual delivery evidence must be acknowledged by every required counterparty before it can finalize the commitment', 'unreviewed manual claims must not finalize fulfillment');
requireText(integrityMigration, 'before update or delete', 'append-only commitment evidence must resist delete-path history rewriting');
requireText(integrityMigration, 'domain-specific Office Hours lacks server-recorded domain provenance', 'generic Office Hours telemetry must not overclaim domain-specific fulfillment');
requireText(integrityMigration, 'measurement_coverage', 'longitudinal usage claims must expose evidence coverage rather than coerce unknown to zero');
requireText(integrityMigration, "filter (where r.measurement_admissible)", 'historical delivery and utilization averages must exclude inadmissible measurements');
requireText(service, ".rpc('review_partner_commitment_manual_measurement'", 'manual evidence review must cross a server-scoped RPC boundary');
requireText(panel, 'CURRENT CONTRACT REMAINS EFFECTIVE', 'partner UX must make amendment effectiveness explicit');
requireText(panel, 'Unknown measurements are excluded rather than treated as zero.', 'longitudinal UX must distinguish missing evidence from zero utilization');
requireText(panel, 'DISPUTE', 'counterpart UX must support explicit non-scoring disagreement with a manual assertion');
forbidText(integrityMigration, 'partner_value_score', 'contract integrity must not introduce a synthetic partner value rank');
forbidText(integrityMigration, 'fairness_score', 'contract integrity must not introduce a fairness leaderboard');

if (failures.length > 0) {
  console.error('Partner Commitment Ledger validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Partner Commitment Ledger validation passed.');
