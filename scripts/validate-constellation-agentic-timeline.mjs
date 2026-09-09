import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing timeline file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

for (const file of [
  'src/admin/InternalAgenticTimelineEngine.ts',
  'src/admin/InternalOperatorDecisionAdmission.ts',
  'src/screens/InternalAgenticTimelineScreen.tsx',
  'src/screens/InternalAdaptiveCommandScreen.tsx',
  'src/screens/InternalOperatorHubScreen.tsx',
  'src/navigation/RootNavigator.tsx',
  'src/components/NetworkPulseCard.tsx',
]) read(file);

for (const [text, why] of [
  ['buildInternalAgenticTimeline', 'timeline builder must remain available'],
  ['analyzeInternalRouteTemporalCoherence', 'route temporal-coherence analysis must remain available'],
  ['PROGRESSION_STAGE', 'relationship evidence progression stages must remain explicit'],
  ['chronologyGap', 'observation-order gaps must remain detectable'],
  ['hasSharedObservationWindow', 'route overlap must distinguish shared observation windows'],
  ['Sequence describes Beacon evidence timing only', 'timeline must remain descriptive rather than causal'],
  ['never proves causation', 'temporal engine must explicitly reject causal inference'],
]) requireText('src/admin/InternalAgenticTimelineEngine.ts', text, why);
forbidText('src/admin/InternalAgenticTimelineEngine.ts', 'supabase', 'timeline engine must remain replayable in-memory analysis');
forbidText('src/admin/InternalAgenticTimelineEngine.ts', 'fetch(', 'timeline engine must not enrich externally');

for (const [text, why] of [
  ['analyzeInternalRouteTemporalCoherence', 'decision admission must consume route temporal coherence'],
  ['temporalMultiplier', 'temporal coherence must conservatively scale route authority'],
  ['Review Agentic Timeline', 'temporal incoherence must generate explicit remediation'],
  ['may only reduce authority', 'timeline/calibration modifiers must remain downward-only'],
]) requireText('src/admin/InternalOperatorDecisionAdmission.ts', text, why);

for (const [text, why] of [
  ['AGENTIC EVIDENCE TIMELINE', 'timeline workbench must be explicit'],
  ['TEMPORAL TRUTH CONTRACT', 'timeline causality boundary must be visible'],
  ['EVIDENCE EPISODES', 'evidence episodes must be inspectable'],
  ['RELATIONSHIP PROGRESSION / CHRONOLOGY', 'relationship ladders must be inspectable'],
  ['OBSERVATION-ORDER DEBT', 'chronology gaps must surface as evidence debt rather than causal claims'],
]) requireText('src/screens/InternalAgenticTimelineScreen.tsx', text, why);

for (const [text, why] of [
  ['CALIBRATION + TEMPORAL AUTHORITY', 'Operator Command must surface temporal authority'],
  ['TEMPORAL', 'route cards must surface temporal coherence'],
  ["navigation.navigate('InternalAgenticTimeline'", 'Command must deep-link to Timeline'],
]) requireText('src/screens/InternalAdaptiveCommandScreen.tsx', text, why);

for (const path of ['src/navigation/RootNavigator.tsx', 'src/screens/InternalOperatorHubScreen.tsx']) {
  requireText(path, 'InternalAgenticTimeline', 'Timeline must remain registered only inside operator surfaces');
}
forbidText('src/components/NetworkPulseCard.tsx', 'InternalAgenticTimeline', 'normal-user Network Pulse must not expose agentic timeline');
forbidText('src/components/NetworkPulseCard.tsx', 'chronologyGap', 'normal-user preview must not expose internal chronology debt');

if (failures.length) {
  console.error('\nConstellation agentic timeline validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation agentic timeline, temporal coherence, and non-causal review boundary passed.');
