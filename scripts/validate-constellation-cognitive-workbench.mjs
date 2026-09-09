import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing cognitive-workbench file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const files = [
  'supabase/migrations/069_internal_graph_perspectives.sql',
  'src/admin/InternalGraphPerspectiveEngine.ts',
  'src/admin/internalGraphPerspective.service.ts',
  'src/screens/InternalPerspectiveLabScreen.tsx',
  'src/admin/InternalGraphPatternQueryEngine.ts',
  'src/screens/InternalPatternQueryLabScreen.tsx',
  'src/admin/InternalDecisionCalibrationEngine.ts',
  'src/screens/InternalDecisionCalibrationScreen.tsx',
  'src/screens/InternalDecisionJournalScreen.tsx',
  'src/admin/InternalEvidenceDebtEngine.ts',
  'src/admin/InternalNextBestAnalysisEngine.ts',
  'src/screens/InternalEvidenceDebtScreen.tsx',
  'src/screens/InternalAdaptiveCommandScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['internal_graph_perspective_definition_valid', 'Perspective definitions must use a server-validated safe DSL'],
  ["'focusKinds', 'relations', 'confidenceFloor', 'minEvidenceCount', 'maxAgeDays', 'includeIsolates'", 'Perspective DSL key allowlist must remain explicit'],
  ['jsonb_array_length(v_value) > 24', 'focus-kind cardinality must remain bounded'],
  ['jsonb_array_length(v_value) > 40', 'relation cardinality must remain bounded'],
  ["v_text not in ('VERIFIED', 'DERIVED', 'AMBIGUOUS')", 'Perspective confidence floor must remain bounded'],
  ['graph_manage', 'Perspective mutation must require graph management'],
  ['graph_read', 'Perspective reads must require graph access'],
  ['prune_internal_graph_perspectives', 'Perspective retention must remain bounded'],
  ["auth.role() <> 'service_role'", 'Perspective pruning must remain service-role-only'],
  ['never person targets or external endpoints', 'Perspective privacy boundary must remain documented'],
]) requireText('supabase/migrations/069_internal_graph_perspectives.sql', text, why);
forbidText('supabase/migrations/069_internal_graph_perspectives.sql', 'person_node_id', 'Perspective registry must never gain a person-target field');
forbidText('supabase/migrations/069_internal_graph_perspectives.sql', 'target_query', 'Perspective registry must never persist a target ecosystem/person query');
forbidText('supabase/migrations/069_internal_graph_perspectives.sql', 'http://', 'Perspective definitions must never embed endpoints');
forbidText('supabase/migrations/069_internal_graph_perspectives.sql', 'https://', 'Perspective definitions must never embed endpoints');

for (const [text, why] of [
  ['applyInternalGraphPerspective', 'deterministic Perspective application must remain available'],
  ['sceneVersion', 'analytical scene context must receive a reproducible version'],
  ['can only REMOVE evidence from view', 'Perspective engine must remain visibility-only'],
  ['recommendInternalGraphSceneDirectives', 'Scene Director recommendations must remain available'],
  ['cannot apply one by itself', 'Scene Director must remain advisory'],
  ['evidence_first', 'verified-evidence lens must remain available'],
  ['recent_pulse', 'recent-topology lens must remain available'],
  ['outcome_ladder', 'outcome-chain lens must remain available'],
]) requireText('src/admin/InternalGraphPerspectiveEngine.ts', text, why);
forbidText('src/admin/InternalGraphPerspectiveEngine.ts', 'supabase', 'Perspective engine must remain pure in-memory analysis');
forbidText('src/admin/InternalGraphPerspectiveEngine.ts', 'fetch(', 'Perspective engine must not perform enrichment');

for (const [text, why] of [
  ['PERSPECTIVE / SCENE DIRECTOR', 'Perspective workbench must expose the analytical context model'],
  ['PERSPECTIVE CONTRACT', 'Perspective truth boundary must be visible'],
  ['SCENE DIRECTOR', 'agent lens suggestions must be visible'],
  ['BUILD PRIVATE PERSPECTIVE', 'operators must be able to save bounded private lenses'],
  ["operator.has('graph_manage')", 'Perspective mutation UI must remain management-gated'],
]) requireText('src/screens/InternalPerspectiveLabScreen.tsx', text, why);

for (const [text, why] of [
  ['runInternalGraphPatternQuery', 'bounded structural pattern engine must remain available'],
  ['edgeCount < 1 || edgeCount > 4', 'Pattern Grammar must remain bounded to 1-4 edges'],
  ['suggestInternalGraphPatterns', 'schema-derived proactive pattern suggestions must remain available'],
  ['Pattern matches describe structural evidence chains only', 'pattern semantics must remain non-social'],
]) requireText('src/admin/InternalGraphPatternQueryEngine.ts', text, why);
forbidText('src/admin/InternalGraphPatternQueryEngine.ts', 'supabase', 'Pattern Grammar must remain pure in-memory analysis');
forbidText('src/admin/InternalGraphPatternQueryEngine.ts', 'fetch(', 'Pattern Grammar must not become an enrichment client');
forbidText('src/admin/InternalGraphPatternQueryEngine.ts', 'cypher', 'bounded Pattern Grammar must not execute arbitrary Cypher');

for (const [text, why] of [
  ['BOUNDED GRAPH PATTERN SEARCH', 'Pattern Grammar workbench must remain explicit'],
  ['PROACTIVE PATTERN SUGGESTIONS', 'graph-derived search suggestions must remain visible'],
  ['CUSTOM TWO-HOP BUILDER', 'guided bounded pattern construction must remain available'],
  ['A match is evidence structure', 'pattern UI must preserve non-inference semantics'],
]) requireText('src/screens/InternalPatternQueryLabScreen.tsx', text, why);

for (const [text, why] of [
  ['Beta(2,2)', 'decision calibration must shrink low-sample outcomes'],
  ['supported: 1', 'supported hypothesis score must remain explicit'],
  ['weakened: 0.5', 'weakened hypothesis score must remain fractional'],
  ['invalidated: 0', 'invalidated hypothesis score must remain explicit'],
  ['Decision calibration scores Beacon/operator analytical method classes only', 'calibration must remain method-scoped rather than person-scoped'],
  ['cannot score a person', 'calibration must never become a person score'],
]) requireText('src/admin/InternalDecisionCalibrationEngine.ts', text, why);
forbidText('src/admin/InternalDecisionCalibrationEngine.ts', 'supabase', 'calibration must remain replayable in-memory analysis');

for (const [text, why] of [
  ['METHOD CALIBRATION', 'Decision Calibration workbench must be explicit'],
  ['OVERCONFIDENCE SIGNAL', 'method overconfidence must be surfaced when present'],
  ['BY DECISION CLASS', 'decision-class calibration must be inspectable'],
  ['BY ADMISSION STATE', 'admission-state calibration must be inspectable'],
]) requireText('src/screens/InternalDecisionCalibrationScreen.tsx', text, why);

for (const [text, why] of [
  ['analyzeInternalEvidenceDebt', 'Evidence Debt analysis entrypoint must remain available'],
  ['ambiguous_evidence', 'ambiguous relationship debt must remain explicit'],
  ['stale_evidence', 'stale evidence debt must remain explicit'],
  ['single_observation', 'one-shot evidence debt must remain explicit'],
  ['route_single_point', 'route bottleneck debt must remain explicit'],
  ['critical_bridge_weakness', 'structurally critical weak evidence must be prioritized'],
  ['expectedAuthorityGain', 'evidence obligations must expose analytical-authority gain rather than person scores'],
  ['Evidence Debt ranks graph-level uncertainty obligations', 'Evidence Debt operating semantics must remain graph scoped'],
  ['never a score of a person', 'Evidence Debt must explicitly reject person scoring'],
]) requireText('src/admin/InternalEvidenceDebtEngine.ts', text, why);
forbidText('src/admin/InternalEvidenceDebtEngine.ts', 'supabase', 'Evidence Debt must remain replayable in-memory analysis');
forbidText('src/admin/InternalEvidenceDebtEngine.ts', 'fetch(', 'Evidence Debt must not perform enrichment');

for (const [text, why] of [
  ['buildInternalNextBestAnalysisPlan', 'cognitive router entrypoint must remain available'],
  ['expectedInformationGain', 'next-analysis ranking must use information gain'],
  ['workbench transitions only', 'cognitive router must remain analytical rather than social'],
  ['never recommends social action', 'cognitive router must preserve the no-social-action boundary'],
  ['InternalEvidenceDebt', 'self-healing verification queue must be a first-class analytical destination'],
  ['InternalPatternQueryLab', 'bounded structural exploration must remain a cognitive fallback'],
]) requireText('src/admin/InternalNextBestAnalysisEngine.ts', text, why);
forbidText('src/admin/InternalNextBestAnalysisEngine.ts', 'supabase', 'cognitive router must remain pure in-memory analysis');
forbidText('src/admin/InternalNextBestAnalysisEngine.ts', 'fetch(', 'cognitive router must not perform enrichment');

for (const [text, why] of [
  ['INTERNAL · VERIFICATION QUEUE', 'Evidence Debt workbench must be explicit'],
  ['SELF-HEALING CONTRACT', 'verification semantics must be visible'],
  ['VERIFICATION PRIORITY QUEUE', 'ranked uncertainty obligations must be inspectable'],
  ['RECOVERABLE AUTHORITY', 'graph-level recoverable authority must be visible'],
  ['No people are scored', 'operator UI must preserve non-person-scoring semantics'],
]) requireText('src/screens/InternalEvidenceDebtScreen.tsx', text, why);

for (const [text, why] of [
  ['NEXT BEST ANALYSIS', 'Operator Command must surface the cognitive router before deeper telemetry'],
  ['buildInternalNextBestAnalysisPlan', 'Operator Command must consume next-best-analysis planning'],
  ['analyzeInternalEvidenceDebt', 'Operator Command must consume evidence-debt state'],
  ['Run next analysis', 'operator must be able to deep-link from ranked analysis suggestions'],
  ['workbench transitions, never social actions', 'Command must state the cognitive router action boundary'],
]) requireText('src/screens/InternalAdaptiveCommandScreen.tsx', text, why);

for (const route of ['InternalDecisionJournal', 'InternalDecisionCalibration', 'InternalPerspectiveLab', 'InternalPatternQueryLab', 'InternalEvidenceDebt']) {
  requireText('src/navigation/RootNavigator.tsx', `name="${route}"`, `${route} must remain registered in sealed navigation`);
  requireText('src/screens/InternalOperatorHubScreen.tsx', `route: '${route}'`, `${route} must remain reachable only through operator Ops`);
  forbidText('src/components/NetworkPulseCard.tsx', route, `normal-user Network Pulse must not expose ${route}`);
}
forbidText('src/components/NetworkPulseCard.tsx', 'InternalNextBestAnalysisEngine', 'normal-user Network Pulse must not expose cognitive routing');
forbidText('src/components/NetworkPulseCard.tsx', 'Evidence Debt', 'normal-user Network Pulse must not expose operator verification debt');

if (failures.length) {
  console.error('\nConstellation cognitive workbench validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation Perspective, Pattern Grammar, Decision Journal/Calibration, Evidence Debt, cognitive routing, and public-boundary contract passed.');
