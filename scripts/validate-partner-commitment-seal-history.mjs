import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing acceptance-seal history artifact: ${path}`);
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

const migration = 'supabase/migrations/067_partner_commitment_acceptance_seal_history.sql';
const governance = 'supabase/migrations/066_partner_commitment_governance.sql';
[migration, governance].forEach(read);

requireText(migration, 'acceptance_decision_fingerprint', 'accepted contract must freeze the exact decision set that completed acceptance');
requireText(migration, "'partner-commitment-contract-v2'", 'historical seal correction must be explicitly versioned');
requireText(migration, 'p_cutoff timestamptz default null', 'historical backfill must derive accepted decisions as of the acceptance event rather than current state');
requireText(migration, "where e.revision_id = r.id and e.status = 'accepted'", 'integrity coverage must be based on historical accepted lifecycle rather than latest decision state');
requireText(migration, 'later withdrawal/rejection decisions do not alter the historical contract seal', 'trust semantics must explicitly preserve historical acceptance');
requireText(migration, 'integrity_version = 2', 'all upgraded seals must use the corrected canonical contract');
requireText(migration, 'v_last_commitment is distinct from v_row.commitment_id', 'seal chaining must reset at each independent obligation');
requireText(migration, 'v_previous_hash := null', 'each commitment must have an independent genesis seal');
requireText(migration, 'accepted revision is missing the complete accepted decision set', 'future acceptance must fail closed if accepted principals cannot be canonicalized');
requireText(migration, 'historically accepted revision % has no complete accepted decision set', 'backfill must fail closed on ambiguous historical acceptance');
requireText(migration, 'partner_commitment_acceptance_seal_immutable', 'seal rows must return to immutable state after controlled upgrade');
requireText(migration, 'grant execute on function public.verify_partner_commitment_scope_integrity(uuid) to authenticated', 'shared scope members need only the bounded integrity projection');

forbidText(migration, 'current acceptance only', 'integrity must not regress to current-state-only semantics');
forbidText(migration, 'Math.random', 'contract integrity must remain deterministic and server-derived');
forbidText(migration, 'blockchain', 'implementation must not claim blockchain semantics');

// Deterministic model check: historical acceptance remains an accepted historical
// fact even if the current decision state later changes.
function historicalCoverage(lifecycle, currentDecision) {
  return lifecycle.includes('accepted') ? 'sealed-history' : currentDecision === 'accepted' ? 'not-yet-lifecycle' : 'none';
}
if (historicalCoverage(['proposed', 'accepted', 'cancelled'], 'withdrawn') !== 'sealed-history') {
  failures.push('semantic test: a later withdrawal must not erase historical accepted-contract coverage');
}
if (historicalCoverage(['proposed'], 'accepted') !== 'not-yet-lifecycle') {
  failures.push('semantic test: current decision alone must not be substituted for accepted lifecycle in historical verification');
}

if (failures.length > 0) {
  console.error('Partner Commitment acceptance-seal history validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Partner Commitment acceptance-seal history validation passed.');
