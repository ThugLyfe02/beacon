import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing decision-reproducibility file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const migration = 'supabase/migrations/080_internal_decision_reproducibility_receipts.sql';
const service = 'src/admin/internalDecisionReproducibility.service.ts';
const screen = 'src/screens/InternalDecisionReproducibilityScreen.tsx';
const nav = 'src/navigation/RootNavigator.tsx';
const hub = 'src/screens/InternalOperatorHubScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[migration, service, screen, nav, hub, pulse].forEach(read);

for (const [text, why] of [
  ['internal_decision_reproducibility_receipts', 'reproducibility receipt table must exist'],
  ['evidence_ref_digest', 'receipt must retain a digest of exact decision refs'],
  ['receipt_digest', 'receipt envelope itself must be hash-bound'],
  ['internal_decision_receipt_context_valid', 'client analytical context must be allowlisted'],
  ["key not in ('policyVersion','lensFingerprint','calibrationPenalty','temporalOverlap','routeDiversity','routeCount')", 'receipt context must remain a strict bounded DSL'],
  ['pg_column_size(coalesce(p_context', 'receipt context must remain size-bounded'],
  ['Cannot seal reproducibility receipt against a stale canonical graph version', 'receipt must bind the original journal and current canonical graph version'],
  ['from public.internal_operator_decision_evidence_refs refs', 'evidence digest must be derived server-side from stored refs'],
  ['string_agg(refs.edge_id', 'exact refs must be deterministically ordered before hashing'],
  ['compare_internal_decision_reproducibility_receipt', 'server comparison RPC must exist'],
  ['liveRefCount', 'comparison must inspect current edge existence'],
  ['openConflictCount', 'comparison must inspect current confirmed conflict intersections'],
  ['reproducibleNow', 'comparison must expose current envelope reproducibility'],
  ['It does not certify the analytical conclusion as true', 'reproducibility must never be truth certification'],
  ["auth.role() <> 'service_role'", 'receipt pruning must remain service-role-only'],
]) requireText(migration, text, why);
for (const forbidden of ['target_query', 'person_node_id', 'email', 'latitude', 'longitude', 'phone']) {
  forbidText(migration, forbidden, `receipt storage must not gain ${forbidden}`);
}

for (const [text, why] of [
  ['sealInternalDecisionReproducibilityReceipt', 'typed receipt seal boundary must exist'],
  ['loadInternalDecisionReproducibilityReceipts', 'typed receipt ledger must be readable'],
  ['compareInternalDecisionReproducibilityReceipt', 'typed receipt comparison must exist'],
  ["policyVersion: input.policyVersion.trim()", 'client must supply explicit analytical policy version'],
]) requireText(service, text, why);

for (const [text, why] of [
  ['REPRODUCIBILITY ≠ TRUTH', 'UI must make truth boundary explicit'],
  ['Seal server reproducibility receipt', 'operator must explicitly seal a receipt'],
  ['REPRODUCIBLE NOW', 'live envelope comparison must be inspectable'],
  ['GRAPH VERSION CHANGED · SEAL BLOCKED', 'stale analytical envelopes must not be back-sealed'],
  ['Reasoning Lineage', 'receipt drift must link back to exact provenance'],
  ['Revalidation Queue', 'receipt drift must link to durable review debt'],
]) requireText(screen, text, why);

requireText(nav, 'name="InternalDecisionReproducibility"', 'Decision Reproducibility must remain registered in sealed navigation');
requireText(hub, "route: 'InternalDecisionReproducibility'", 'Decision Reproducibility must remain operator-only in Ops');
requireText(hub, 'Reproducibility is not truth certification', 'Ops autonomy boundary must preserve reproducibility semantics');
forbidText(pulse, 'InternalDecisionReproducibility', 'normal-user Network Pulse must not expose decision reproducibility');
forbidText(pulse, 'receiptDigest', 'normal-user preview must not expose internal receipt hashes');

if (failures.length) {
  console.error('\nConstellation decision-reproducibility validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation server-sealed decision reproducibility receipt boundary passed.');
