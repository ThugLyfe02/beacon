import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing Partner Commitment Governance artifact: ${path}`);
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

const migration = 'supabase/migrations/066_partner_commitment_governance.sql';
const service = 'src/services/partner-commitment-governance.service.ts';
const component = 'src/components/PartnerCommitmentGovernanceCard.tsx';
const panel = 'src/components/PartnerCommitmentLedgerPanel.tsx';
const docs = 'docs/PARTNER_COMMITMENT_GOVERNANCE.md';

[migration, service, component, panel, docs].forEach(read);

// Contract seals.
requireText(migration, 'partner_commitment_acceptance_seals', 'accepted revisions need durable tamper-evident seals');
requireText(migration, "'partner-commitment-contract-v1'", 'seal canonicalization must be explicitly versioned');
requireText(migration, "'sha256'", 'contract seal must use SHA-256 rather than a weak checksum');
requireText(migration, 'previous_seal_hash', 'accepted amendments should chain to prior accepted revisions');
requireText(migration, 'seal_partner_commitment_after_decision', 'a newly completed acceptance must create its seal at the data boundary');
requireText(migration, 'verify_partner_commitment_scope_integrity', 'shared users need an integrity-verification projection');
requireText(component, 'not an external signature, blockchain notarization, legal opinion', 'UI must not overclaim the seal');

// Preflight.
for (const issue of [
  'acceptance-pending',
  'amendment-pending',
  'schedule-not-declared',
  'manual-measurement-route',
  'manual-evidence-pending',
  'manual-evidence-disputed',
  'window-closed-without-measurement',
]) {
  requireText(migration, `'${issue}'`, `deterministic preflight must support ${issue}`);
}
requireText(migration, 'partner_commitment_has_native_delivery_adapter', 'preflight must distinguish native evidence from manual-only semantics');
requireText(migration, 'partner_commitment_requires_scheduling', 'preflight must distinguish session-like obligations');
requireText(component, 'not a prediction or partner-quality score', 'preflight copy must reject hidden reputation semantics');

// Immutable closeout and evidence staleness.
requireText(migration, 'partner_commitment_closeout_snapshots', 'ended-event evidence needs immutable versioned snapshots');
requireText(migration, 'snapshot_payload jsonb not null', 'closeout must preserve the exact structured evidence payload reviewed by partners');
requireText(migration, 'snapshot_hash text not null unique', 'closeout versions need a tamper-evident fingerprint');
requireText(migration, 'partner_commitment_closeout_decisions', 'each community must review a specific evidence version independently');
requireText(migration, "actor_role text not null check (actor_role in ('community-a','community-b'))", 'event host must not settle evidence on behalf of communities');
requireText(migration, "return 'stale'", 'changed evidence must stale prior closeout rather than silently rewrite it');
requireText(migration, 'snapshot_payload = v_payload', 'recapturing identical evidence should be idempotent');
requireText(migration, 'only the latest closeout evidence version may receive a decision', 'historical versions must not become current after newer evidence exists');
requireText(migration, 'capture_partner_commitment_scope_closeouts_after_event', 'event end should capture the first closeout evidence version');
requireText(component, 'Both communities review the same evidence version', 'shared UX must make the bilateral snapshot boundary legible');
requireText(component, 'prior snapshot becomes stale rather than silently rewriting', 'late evidence behavior must be explicit in product copy');

// Repeat-program evidence maturity.
requireText(migration, 'get_partner_program_commitment_settlement_summary', 'Partner Programs need to separate reusable configuration from reviewed historical evidence');
requireText(migration, "count(*) filter (where state = 'settled')", 'repeat history must preserve settled evidence separately');
requireText(migration, "count(*) filter (where state = 'disputed')", 'repeat history must preserve disputes as uncertainty');
requireText(migration, "count(*) filter (where state = 'stale')", 'repeat history must preserve stale evidence as uncertainty');
requireText(component, 'REPEAT-EVENT EVIDENCE MATURITY', 'program UI must expose evidence maturity without auto-authority');

// RPC-only data access and strong idempotency.
for (const table of [
  'partner_commitment_acceptance_seals',
  'partner_commitment_closeout_snapshots',
  'partner_commitment_closeout_decisions',
]) {
  requireText(migration, `revoke all on public.${table} from authenticated, anon`, `${table} must not become directly client-readable`);
}
forbidText(service, ".from('partner_commitment", 'mobile governance code must consume scoped RPCs rather than raw tables');
requireText(service, ".rpc('verify_partner_commitment_scope_integrity'", 'integrity check must cross the server boundary');
requireText(service, ".rpc('get_partner_commitment_execution_preflight'", 'preflight must cross the server boundary');
requireText(service, ".rpc('capture_partner_commitment_closeout_snapshot'", 'closeout capture must cross the server boundary');
requireText(service, ".rpc('decide_partner_commitment_closeout'", 'closeout decisions must cross the server boundary');
requireText(service, 'Crypto.getRandomBytesAsync(24)', 'closeout decision idempotency keys must use cryptographic entropy');
forbidText(service, 'Math.random(', 'governance idempotency must never rely on Math.random');

// Product integration.
requireText(panel, '<PartnerCommitmentGovernanceCard scope={scope} />', 'governance must sit inside the shared commitment workspace');

// Trust-language boundaries.
for (const path of [migration, service, component]) {
  forbidText(path, 'fairnessScore', 'no synthetic fairness score belongs in partner governance');
  forbidText(path, 'partnerScore', 'no synthetic partner reputation score belongs in partner governance');
  forbidText(path, 'conversionRate', 'partner closeout is not a funnel-conversion claim');
}
requireText(docs, 'Late evidence can mature history. It cannot silently rewrite history.', 'documentation must state the evidence-versioning principle');
requireText(docs, 'not a social trust score', 'documentation must reject social scoring semantics');

// Small deterministic semantic checks.
function posture(issues) {
  if (issues.some((issue) => issue === 'block')) return 'blocked';
  if (issues.some((issue) => issue === 'review')) return 'attention';
  return 'ready';
}
if (posture([]) !== 'ready') failures.push('semantic test: empty preflight should be ready');
if (posture(['info', 'review']) !== 'attention') failures.push('semantic test: review should produce attention posture');
if (posture(['review', 'block']) !== 'blocked') failures.push('semantic test: block must dominate preflight posture');

function settlement(decisions, current = true) {
  if (!current) return 'stale';
  if (decisions.includes('disputed')) return 'disputed';
  return decisions.filter((decision) => decision === 'acknowledged').length >= 2 ? 'settled' : 'pending';
}
if (settlement(['acknowledged']) !== 'pending') failures.push('semantic test: one acknowledgement cannot settle bilateral evidence');
if (settlement(['acknowledged', 'acknowledged']) !== 'settled') failures.push('semantic test: two acknowledgements should settle current evidence');
if (settlement(['acknowledged', 'disputed']) !== 'disputed') failures.push('semantic test: dispute must remain explicit');
if (settlement(['acknowledged', 'acknowledged'], false) !== 'stale') failures.push('semantic test: changed evidence must stale prior settlement');

if (failures.length > 0) {
  console.error('Partner Commitment Governance validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Partner Commitment Governance validation passed.');
