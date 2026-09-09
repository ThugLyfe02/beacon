import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing assumption-staleness file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

for (const path of [
  'src/admin/InternalAssumptionStalenessEngine.ts',
  'src/screens/InternalAssumptionStalenessScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
]) read(path);

for (const [text, why] of [
  ["'current' | 'review_due' | 'stale'", 'freshness lifecycle must remain explicit'],
  ['currentGraphVersion', 'staleness must compare against canonical graph version'],
  ['graph epistemic health fell', 'evidence-health deterioration must contribute to revalidation'],
  ['chronology gap', 'temporal change must contribute to revalidation'],
  ['route diversity fell', 'route-dependence deterioration must contribute to revalidation'],
  ['new critical Watchtower incident pressure', 'incident changes must contribute to revalidation'],
  ['staleness is not invalidation', 'stale must never be equated with false'],
  ['never marks a hypothesis false automatically', 'engine must preserve falsifiability and human review'],
]) requireText('src/admin/InternalAssumptionStalenessEngine.ts', text, why);
forbidText('src/admin/InternalAssumptionStalenessEngine.ts', 'supabase', 'staleness analysis must remain pure and replayable');
forbidText('src/admin/InternalAssumptionStalenessEngine.ts', 'fetch(', 'staleness analysis must not enrich externally');
forbidText('src/admin/InternalAssumptionStalenessEngine.ts', 'update(', 'staleness engine must not mutate hypotheses or graph truth');

for (const [text, why] of [
  ['ASSUMPTION REVALIDATION', 'operator revalidation workbench must be explicit'],
  ['Stale means revalidate—not false', 'UI must preserve stale-vs-false distinction'],
  ["operator.has('graph_manage')", 'staleness workbench must remain graph-manage gated'],
  ['Open required review', 'staleness must deep-link to evidence review rather than claim an answer'],
]) requireText('src/screens/InternalAssumptionStalenessScreen.tsx', text, why);

requireText('src/screens/InternalOperatorHubScreen.tsx', "route: 'InternalAssumptionStaleness'", 'staleness workbench must remain exposed only through sealed Ops');
requireText('src/navigation/RootNavigator.tsx', 'name="InternalAssumptionStaleness"', 'staleness workbench must remain registered');
forbidText('src/components/NetworkPulseCard.tsx', 'InternalAssumptionStaleness', 'normal-user Network Pulse must not expose internal assumption revalidation');
forbidText('src/components/NetworkPulseCard.tsx', 'Assumption Staleness', 'normal-user Network Pulse must not expose internal stale-hypothesis state');

if (failures.length) {
  console.error('\nConstellation assumption-staleness validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation assumption-staleness, revalidation, and privacy boundary passed.');
