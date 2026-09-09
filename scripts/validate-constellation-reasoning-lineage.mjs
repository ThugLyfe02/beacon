import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing reasoning-lineage file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const migrationRefs = 'supabase/migrations/077_internal_operator_decision_evidence_refs.sql';
const migrationAtomic = 'supabase/migrations/078_atomic_decision_journal_with_refs.sql';
const service = 'src/admin/internalDecisionEvidenceRefs.service.ts';
const dependency = 'src/admin/InternalDecisionDependencyEngine.ts';
const lineage = 'src/admin/InternalReasoningLineageEngine.ts';
const journal = 'src/screens/InternalDecisionJournalScreen.tsx';
const staleness = 'src/admin/InternalAssumptionStalenessEngine.ts';
const screen = 'src/screens/InternalReasoningLineageScreen.tsx';
const nav = 'src/navigation/RootNavigator.tsx';
const hub = 'src/screens/InternalOperatorHubScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[migrationRefs, migrationAtomic, service, dependency, lineage, journal, staleness, screen, nav, hub, pulse].forEach(read);

for (const [text, why] of [
  ['internal_operator_decision_evidence_refs', 'exact decision→edge dependency table must exist'],
  ['p_graph_version <> v_journal.graph_version or p_graph_version <> v_expected', 'manual refs must be blocked when journal/current canonical graph versions diverge'],
  ['Evidence edge array is required', 'edge-reference input boundary must remain explicit'],
  ['Decision evidence reference limit is 64 distinct edges', 'decision refs must remain bounded'],
  ['Decision evidence edge is not present in authorized graph', 'server must revalidate every referenced edge'],
  ['Exact edge-level dependency references', 'storage semantics must remain explicit'],
]) requireText(migrationRefs, text, why);

for (const [text, why] of [
  ['save_internal_operator_decision_journal_with_refs', 'atomic journal+refs RPC must exist'],
  ['v_journal := public.save_internal_operator_decision_journal', 'atomic RPC must compose hardened journal creation'],
  ['perform public.record_internal_operator_decision_evidence_refs', 'atomic RPC must record refs in the same transaction'],
]) requireText(migrationAtomic, text, why);

for (const [text, why] of [
  ['saveInternalDecisionJournalWithRefs', 'typed atomic client boundary must exist'],
  ["p_ref_kind: input.refKind ?? 'route_portfolio'", 'route refs must be classified explicitly'],
  ['loadInternalDecisionEvidenceRefs', 'dependency refs must be inspectable'],
]) requireText(service, text, why);

for (const [text, why] of [
  ['analyzeInternalConflictDecisionDependencies', 'exact conflict→hypothesis intersection engine must exist'],
  ['ref.edgeId === conflict.leftEdgeId || ref.edgeId === conflict.rightEdgeId', 'conflict impact must require an exact edge intersection'],
  ['does not infer hidden dependencies', 'dependency engine must reject inferred links'],
]) requireText(dependency, text, why);
forbidText(dependency, 'fetch(', 'dependency analysis must remain local/replayable');
forbidText(dependency, 'supabase', 'dependency analysis must not mutate backend state');

for (const [text, why] of [
  ['analyzeInternalReasoningLineage', 'reasoning-lineage engine must exist'],
  ["? 'unbound'", 'legacy hypotheses without refs must remain explicitly unbound'],
  ["? 'orphaned'", 'refs lost after graph evolution must be surfaced rather than dropped'],
  ["? 'conflicted'", 'conflict intersections must be visible in lineage'],
  ['never guesses dependencies', 'lineage operating rule must forbid inferred dependencies'],
  ['conflictBlastRadius', 'conflict blast radius must be computed over explicit refs'],
]) requireText(lineage, text, why);

for (const [text, why] of [
  ['saveInternalDecisionJournalWithRefs', 'route/intervention journal creation must use atomic ref binding'],
  ["decisionKind === 'target_route_review' || decisionKind === 'intervention_review'", 'only route-dependent decision classes should auto-bind route refs'],
  ['routing.routes.slice(0, 3)', 'automatic route binding must remain bounded to the reviewed portfolio head'],
  ['routeResult.edges.map((edge) => edge.edgeId)', 'Journal must bind exact route edge identifiers'],
]) requireText(journal, text, why);

for (const [text, why] of [
  ['conflictDependencies?: InternalConflictDecisionDependencyReport', 'staleness must accept exact conflict dependency state'],
  ['dependencyByJournal.get(row.journalId)', 'staleness must match conflicts to exact journal IDs'],
  ["recommendedSurface = 'InternalEvidenceConflicts'", 'conflict-dependent stale assumptions must route to reconciliation'],
  ['does not mean the hypothesis is false', 'staleness must preserve revalidation-not-invalidation semantics'],
]) requireText(staleness, text, why);

for (const [text, why] of [
  ['ANALYTICAL PROVENANCE', 'Reasoning Lineage workbench must be explicit'],
  ['CONFLICT BLAST RADIUS', 'operators must see exact conflict blast radius'],
  ['EXPLICIT LEGACY BINDING', 'legacy binding must require operator confirmation'],
  ['Beacon will not bind stale evidence by guesswork', 'manual rebinding must fail closed on graph-version mismatch'],
  ["refKind: 'manual_review'", 'operator binding must be recorded as explicit manual review'],
]) requireText(screen, text, why);

requireText(nav, 'name="InternalReasoningLineage"', 'Reasoning Lineage must remain registered in sealed navigation');
requireText(hub, "route: 'InternalReasoningLineage'", 'Reasoning Lineage must remain available only in sealed Ops');
requireText(hub, 'exact reasoning lineage', 'Ops narrative must preserve explicit analytical provenance semantics');
forbidText(pulse, 'InternalReasoningLineage', 'normal-user Network Pulse must not expose reasoning lineage');
forbidText(pulse, 'decision_evidence_refs', 'normal-user Network Pulse must not expose decision dependency internals');

if (failures.length) {
  console.error('\nConstellation reasoning-lineage validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation exact decision-evidence lineage and conflict blast-radius boundary passed.');
