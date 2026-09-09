import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing revalidation-queue file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const migration = 'supabase/migrations/079_internal_reasoning_revalidation_obligations.sql';
const service = 'src/admin/internalReasoningRevalidation.service.ts';
const attention = 'src/admin/InternalRevalidationAttentionEngine.ts';
const screen = 'src/screens/InternalReasoningRevalidationScreen.tsx';
const command = 'src/screens/InternalAdaptiveCommandScreen.tsx';
const nav = 'src/navigation/RootNavigator.tsx';
const hub = 'src/screens/InternalOperatorHubScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[migration, service, attention, screen, command, nav, hub, pulse].forEach(read);

for (const [text, why] of [
  ['internal_reasoning_revalidation_obligations', 'durable revalidation table must exist'],
  ["artifact_kind in ('decision_journal','case','machine_manifest')", 'artifact kinds must remain a bounded allowlist'],
  ["reason_kind in ('evidence_conflict','orphaned_ref','canonical_graph_change','temporal_incoherence','manual_review')", 'revalidation reason kinds must remain bounded'],
  ['capture_internal_conflict_revalidation_obligations', 'conflicts must produce durable obligations through server-derived dependencies'],
  ['join public.internal_operator_decision_evidence_refs', 'conflict obligations must derive from exact decision refs'],
  ['refs.edge_id in (new.left_edge_id, new.right_edge_id)', 'conflict obligation must require exact edge intersection'],
  ['journal.status = \'open\'', 'resolved hypotheses must not receive new conflict obligations'],
  ['update_internal_reasoning_revalidation_obligation', 'operator acknowledgement/resolution RPC must exist'],
  ['Resolution note required', 'closing an obligation must require a review note'],
  ["auth.role() <> 'service_role'", 'retention pruning must remain service-role-only'],
  ['no person scoring or graph mutation occurs', 'storage semantics must remain analytical-artifact-only'],
]) requireText(migration, text, why);
forbidText(migration, 'person_node_id', 'revalidation storage must not become a person watchlist');
forbidText(migration, 'target_query', 'revalidation storage must not retain target queries');

for (const [text, why] of [
  ['loadInternalReasoningRevalidationQueue', 'typed queue reader must exist'],
  ['updateInternalReasoningRevalidationObligation', 'typed acknowledge/resolve boundary must exist'],
]) requireText(service, text, why);

for (const [text, why] of [
  ['augmentInternalNextAnalysisWithRevalidation', 'durable obligations must be able to enter Next Best Analysis'],
  ["destination: 'InternalReasoningRevalidation'", 'revalidation debt must route to its own evidence surface'],
  ['Resolving the task records that review occurred', 'attention semantics must not equate task closure with truth'],
]) requireText(attention, text, why);
forbidText(attention, 'supabase', 'revalidation attention must remain pure/replayable');
forbidText(attention, 'fetch(', 'revalidation attention must not enrich externally');

for (const [text, why] of [
  ['DURABLE ANALYTICAL REMEDIATION', 'Revalidation Queue workbench must be explicit'],
  ['Conflict-derived decision obligations are created only from exact stored decision→edge refs', 'UI must expose exact-dependency semantics'],
  ['Resolve after revalidation', 'operator must explicitly close review debt'],
  ['Closing the task records review', 'UI must separate task closure from truth'],
]) requireText(screen, text, why);

for (const [text, why] of [
  ['loadInternalReasoningRevalidationQueue', 'Command must load durable reasoning debt'],
  ['augmentInternalNextAnalysisWithRevalidation', 'Command attention must consume durable revalidation debt'],
  ['P4/P5 REVALIDATION', 'Command must surface high-priority review debt'],
  ['REASONING INTEGRITY · REVIEW REQUIRED', 'Command must surface analytical-provenance failures'],
]) requireText(command, text, why);

requireText(nav, 'name="InternalReasoningRevalidation"', 'Revalidation Queue must remain registered in sealed navigation');
requireText(hub, "route: 'InternalReasoningRevalidation'", 'Revalidation Queue must remain exposed only through sealed Ops');
forbidText(pulse, 'InternalReasoningRevalidation', 'normal-user Network Pulse must not expose reasoning revalidation debt');
forbidText(pulse, 'revalidation_obligations', 'normal-user preview must not expose internal revalidation storage');

if (failures.length) {
  console.error('\nConstellation reasoning-revalidation validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation exact-dependency durable reasoning revalidation boundary passed.');
