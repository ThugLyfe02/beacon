import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const path = 'supabase/migrations/065_partner_commitment_template_effectiveness.sql';
const failures = [];
const absolute = join(root, path);

if (!existsSync(absolute)) {
  failures.push(`Missing Partner Commitment Ledger hardening migration: ${path}`);
} else {
  const sql = readFileSync(absolute, 'utf8');
  const required = [
    ['public.partner_commitment_effective_revision(c.id)', 'program prefill must select the effective accepted contract, not blindly select latest revision'],
    ["public.partner_commitment_acceptance_state(r.id) = 'accepted'", 'only accepted program configuration may be reused'],
    ["public.partner_commitment_latest_status(r.id) = 'accepted'", 'only live accepted template state may be reused'],
    ["'proposed'", 'every event copy must restart as a proposal'],
    ['source_template_revision_id', 'event commitments must preserve exact template revision provenance'],
    ["'accepted','scheduled','delivering','fulfilled','partially_fulfilled'", 'fulfilled and partially fulfilled evidence windows must still block semantic double-claiming'],
    ['pc.id <> x.commitment_id', 'overlap detection must compare distinct commitment roots rather than block a legitimate revision of the same obligation'],
    ['x.window_start < er.window_end', 'event overlap detection must use real observation windows'],
    ['er.window_start < x.window_end', 'event overlap detection must be symmetric'],
    ['active operational exchange required', 'event commitment reuse must remain scoped to an operational exchange'],
  ];

  for (const [needle, explanation] of required) {
    if (!sql.includes(needle)) failures.push(`${path}: ${explanation}`);
  }

  for (const forbidden of ['fairness_score', 'partner_value_score', 'monetary_value', 'auto_accept']) {
    if (sql.includes(forbidden)) failures.push(`${path}: forbidden partner-ranking/automatic-authority concept ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error('Partner Commitment effective-template validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Partner Commitment effective-template validation passed.');
