import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing epistemic-health file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => {
  if (!read(path).includes(text)) failures.push(`${path}: ${why}`);
};
const forbidText = (path, text, why) => {
  if (read(path).includes(text)) failures.push(`${path}: ${why}`);
};

const files = [
  'supabase/migrations/065_internal_watchtower_baseline_priming.sql',
  'src/admin/InternalGraphEpistemicHealthEngine.ts',
  'src/screens/InternalGraphHealthScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
];
files.forEach(read);

for (const [text, why] of [
  ['prime_internal_graph_watch_rule', 'new Watchtower rules must baseline from retained evidence'],
  ['after insert on public.internal_graph_watch_rules', 'Watchtower baseline priming must happen automatically on creation'],
  ['last_result_digest = v_manifest.result_digest', 'Machine watches must baseline from the newest retained manifest'],
  ['last_value = v_value', 'metric/motif watches must baseline without creating an alert'],
  ['Silently baselines a newly created Watchtower rule', 'baseline semantics must remain explicit'],
]) requireText('supabase/migrations/065_internal_watchtower_baseline_priming.sql', text, why);
forbidText('supabase/migrations/065_internal_watchtower_baseline_priming.sql', 'insert into public.internal_graph_watch_events', 'baseline priming must never emit a Watchtower alert');

for (const [text, why] of [
  ['analyzeInternalGraphEpistemicHealth', 'epistemic graph-health analysis must remain available'],
  ['verifiedEdgeRatio', 'health must inspect directly verified evidence'],
  ['ambiguousEdgeRatio', 'health must expose ambiguity'],
  ['repeatedEvidenceRatio', 'health must expose repeated evidence support'],
  ['freshEdgeRatio', 'health must expose evidence freshness'],
  ['staleEdgeRatio', 'health must expose stale evidence burden'],
  ['weakContextRatio', 'health must expose weak contextual topology'],
  ['canonicalizedAliasCount', 'health must account for canonicalization hygiene'],
  ['It is not a score of any person, community, organization, or event outcome', 'epistemic health must never become a human/entity value score'],
]) requireText('src/admin/InternalGraphEpistemicHealthEngine.ts', text, why);
forbidText('src/admin/InternalGraphEpistemicHealthEngine.ts', 'supabase', 'epistemic health engine must remain pure in-memory analysis');
forbidText('src/admin/InternalGraphEpistemicHealthEngine.ts', 'fetch(', 'epistemic health engine must not perform external enrichment');

for (const [text, why] of [
  ['EPISTEMIC CONTRACT', 'Graph Health UI must expose its interpretation boundary'],
  ['EPISTEMIC HEALTH / 100', 'operator must be able to inspect current graph evidence health'],
  ['VERIFIED', 'operator must see evidence composition'],
  ['WARNINGS', 'operator must see reasons to down-weight conclusions'],
  ['REMEDIATION ROUTES', 'health warnings must lead toward graph-quality work'],
  ["operator.has('graph_read')", 'Evidence Health must remain operator-only but read-capability accessible'],
]) requireText('src/screens/InternalGraphHealthScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalGraphHealth'", 'Evidence Health must remain reachable from sealed Ops');
requireText('src/screens/InternalOperatorHubScreen.tsx', "title: 'Evidence Health'", 'Ops must identify the epistemic-health workbench clearly');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalGraphHealth"', 'Evidence Health route must remain registered');

forbidText('src/components/NetworkPulseCard.tsx', 'InternalGraphHealth', 'normal-user Network Pulse must not expose operator graph-health tooling');
forbidText('src/components/NetworkPulseCard.tsx', 'ambiguousEdgeRatio', 'normal-user Network Pulse must not expose internal epistemic forensics');

if (failures.length > 0) {
  console.error('\nConstellation epistemic-health validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation Watchtower baseline and epistemic graph-health boundary passed.');
