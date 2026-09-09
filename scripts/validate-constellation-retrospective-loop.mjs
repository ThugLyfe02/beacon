import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing retrospective-loop file: ${path}`);
    return '';
  }
  return readFileSync(full, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const migration = 'supabase/migrations/073_internal_operator_decision_retrospectives.sql';
const service = 'src/admin/internalDecisionJournal.service.ts';
const engine = 'src/admin/InternalAnalyticalRetrospectiveEngine.ts';
const methodDebt = 'src/admin/InternalMethodDebtEngine.ts';
const journal = 'src/screens/InternalDecisionJournalScreen.tsx';
const command = 'src/screens/InternalAdaptiveCommandScreen.tsx';
const screen = 'src/screens/InternalDecisionRetrospectiveScreen.tsx';
const nav = 'src/navigation/RootNavigator.tsx';
const hub = 'src/screens/InternalOperatorHubScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[migration, service, engine, methodDebt, journal, command, screen, nav, hub, pulse].forEach(read);

for (const [text, why] of [
  ['internal_operator_decision_context', 'metrics-only retrospective table must exist'],
  ['internal_decision_metrics_valid', 'retrospective metric allowlist must be enforced'],
  ["'healthScore','verifiedRatio','ambiguousRatio','freshRatio','repeatedRatio'", 'core analytical metric allowlist must remain explicit'],
  ["'routeDiversity','routeCount','sharedBottlenecks','temporalOverlap'", 'routing/temporal metric allowlist must remain explicit'],
  ['pg_column_size(p_metrics) > 4096', 'retrospective metric envelope must remain bounded'],
  ['record_internal_operator_decision_context', 'creation/resolution retrospective RPC must exist'],
  ['get_internal_operator_decision_retrospectives', 'retrospective read RPC must exist'],
  ['Metrics-only retrospective context', 'privacy semantics must remain documented'],
]) requireText(migration, text, why);
for (const forbidden of ['person_node_id', 'target_query', 'email', 'latitude', 'longitude', 'phone']) {
  forbidText(migration, forbidden, `retrospective storage must not gain ${forbidden} fields`);
}

for (const [text, why] of [
  ['recordInternalDecisionContext', 'typed service must record bounded contexts'],
  ['loadInternalDecisionRetrospectives', 'typed service must load retrospective rows'],
  ['InternalDecisionRetrospectiveMetrics', 'strict metric type must remain available'],
]) requireText(service, text, why);

for (const [text, why] of [
  ['Beta(2,2)', 'retrospective associations must use low-sample shrinkage'],
  ['posteriorAdverseAssociation', 'retrospective association must be explicit'],
  ['conservativeAdverseFloor', 'retrospective conservative floor must remain explicit'],
  ['association, not evidence that the condition caused the outcome', 'retrospective output must reject causal interpretation'],
  ['never causal claims or scores of people/entities', 'retrospective operating rule must stay method-scoped'],
]) requireText(engine, text, why);
forbidText(engine, 'supabase', 'retrospective engine must remain pure/replayable');
forbidText(engine, 'fetch(', 'retrospective engine must not enrich externally');

for (const [text, why] of [
  ["phase: 'created'", 'journal creation must record decision-time context'],
  ["phase: 'resolved'", 'journal resolution must record resolution-time context'],
  ['decision-evidence-v3-retrospective', 'journal evidence envelope must identify retrospective baseline'],
  ['do not fabricate it', 'legacy hypotheses must not fabricate missing decision-time context'],
]) requireText(journal, text, why);

for (const [text, why] of [
  ['retrospectives?: InternalAnalyticalRetrospectiveReport', 'Method Debt must accept retrospective history'],
  ['retrospective_failure_signature', 'mature retrospective signatures must become method debt'],
  ["recommendedSurface: 'InternalDecisionRetrospective'", 'retrospective method debt must route to its evidence surface'],
]) requireText(methodDebt, text, why);

for (const [text, why] of [
  ['loadInternalDecisionRetrospectives', 'Command must load retrospective history'],
  ['analyzeInternalDecisionRetrospectives', 'Command must analyze retrospective history'],
  ['retrospectives: retrospectiveReport', 'Command Method Debt must consume retrospective report'],
  ['RETROSPECTIVE N', 'Command must expose retrospective sample maturity'],
]) requireText(command, text, why);

for (const [text, why] of [
  ['ANALYTICAL RETROSPECTIVE', 'Retrospective Lab must be explicit'],
  ['STRONGEST RECURRING CONDITIONS', 'recurring method conditions must be inspectable'],
  ['association, not causation', 'Retrospective UI must reject causal interpretation'],
]) requireText(screen, text, why);

requireText(nav, 'name="InternalDecisionRetrospective"', 'Retrospective Lab must remain registered in sealed navigation');
requireText(hub, "route: 'InternalDecisionRetrospective'", 'Retrospective Lab must remain operator-only in Ops');
forbidText(pulse, 'InternalDecisionRetrospective', 'normal-user Network Pulse must not expose retrospective intelligence');
forbidText(pulse, 'Retrospective Lab', 'normal-user Network Pulse must not expose retrospective intelligence');

if (failures.length) {
  console.error('\nConstellation retrospective-loop validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation bounded retrospective calibration loop contract passed.');
