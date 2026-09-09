import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing evidence-conflict file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

for (const path of [
  'supabase/migrations/076_internal_graph_evidence_conflicts.sql',
  'src/admin/internalEvidenceConflict.service.ts',
  'src/admin/InternalEvidenceTensionEngine.ts',
  'src/admin/InternalEvidenceDebtEngine.ts',
  'src/admin/InternalValueOfInformationEngine.ts',
  'src/screens/InternalEvidenceConflictScreen.tsx',
  'src/screens/InternalEvidenceDebtScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
]) read(path);

for (const [text, why] of [
  ['internal_graph_evidence_conflicts', 'explicit conflict ledger table must exist'],
  ["status in ('open', 'resolved', 'dismissed')", 'conflict lifecycle must remain bounded'],
  ['internal_current_canonical_graph_version', 'conflicts must bind to canonical graph version'],
  ["jsonb_array_elements(coalesce(v_graph->'edges'", 'both submitted edge ids must be server-revalidated'],
  ['Internal graph management capability required', 'conflict mutations must require graph_manage'],
  ['Both source evidence edges remain intact', 'ledger must preserve both source edges'],
  ["auth.role() <> 'service_role'", 'conflict pruning must remain service-role-only'],
]) requireText('supabase/migrations/076_internal_graph_evidence_conflicts.sql', text, why);
forbidText('supabase/migrations/076_internal_graph_evidence_conflicts.sql', 'delete from public.internal_graph_edge_memory', 'conflict resolution must never delete source graph evidence');

for (const [text, why] of [
  ['A tension is deliberately weaker than a contradiction', 'automatic suggestions must remain non-authoritative'],
  ['never writes to the conflict ledger', 'tension engine must not create conflict state'],
  ['safety_state_overlap', 'safety/state review tension must remain explicit'],
  ['confidence_divergence', 'confidence/provenance review tension must remain explicit'],
]) requireText('src/admin/InternalEvidenceTensionEngine.ts', text, why);
forbidText('src/admin/InternalEvidenceTensionEngine.ts', 'supabase', 'tension detection must remain pure in-memory analysis');
forbidText('src/admin/InternalEvidenceTensionEngine.ts', 'fetch(', 'tension detection must not perform external enrichment');

for (const [text, why] of [
  ["'operator_confirmed_conflict'", 'confirmed conflicts must become explicit Evidence Debt'],
  ["recommendedSurface: 'InternalEvidenceConflicts'", 'conflict debt must route to reconciliation workbench'],
  ['does not mean either source edge is false', 'conflict debt must preserve uncertainty rather than declare truth'],
]) requireText('src/admin/InternalEvidenceDebtEngine.ts', text, why);

for (const [text, why] of [
  ["input.debt.kind === 'operator_confirmed_conflict'", 'VOI must identify conflict debt specially'],
  ['fake both-confirmed/both-removed scenario', 'VOI must refuse false binary simulation for conflicts'],
]) requireText('src/admin/InternalValueOfInformationEngine.ts', text, why);

for (const [text, why] of [
  ['EVIDENCE CONFLICT LEDGER', 'Conflict Review workbench must be explicit'],
  ['Tension suggestions are not contradictions', 'UI must distinguish suggestions from conflicts'],
  ['Only an operator can confirm a ledger conflict', 'operator confirmation must remain mandatory'],
  ['Open conflict never means either evidence edge is false', 'open conflict must not claim truth'],
  ["operator.has('graph_manage')", 'Conflict Review must remain graph-manage gated'],
]) requireText('src/screens/InternalEvidenceConflictScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalEvidenceConflicts'", 'Conflict Review must remain exposed only from sealed Ops');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalEvidenceConflicts"', 'Conflict Review route must remain registered');
requireText('src/screens/InternalEvidenceDebtScreen.tsx', 'OPEN CONFLICTS', 'Verification Queue must surface unresolved conflict workload');
requireText('src/screens/InternalEvidenceDebtScreen.tsx', 'Conflict Review', 'Verification Queue must route conflict debt to reconciliation');

forbidText('src/components/NetworkPulseCard.tsx', 'InternalEvidenceConflicts', 'normal-user Network Pulse must not expose conflict ledger');
forbidText('src/components/NetworkPulseCard.tsx', 'Evidence Conflict Ledger', 'normal-user Network Pulse must not expose conflict state');
forbidText('src/components/NetworkPulseCard.tsx', 'operator_confirmed_conflict', 'normal-user Network Pulse must not expose conflict-derived debt');

if (failures.length) {
  console.error('\nConstellation evidence-conflict validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation evidence tension, operator-confirmed conflict ledger, conflict debt, and privacy boundary passed.');
