import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing value-of-information file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const engine = 'src/admin/InternalValueOfInformationEngine.ts';
const evidenceDebt = 'src/screens/InternalEvidenceDebtScreen.tsx';
const networkPulse = 'src/components/NetworkPulseCard.tsx';
[engine, evidenceDebt, networkPulse].forEach(read);

for (const [text, why] of [
  ['simulateInternalValueOfInformation', 'value-of-information entrypoint must remain available'],
  ["'confirm' | 'disconfirm'", 'information value must bracket confirmation and disconfirmation explicitly'],
  ['counterfactualScenario', 'scenario graph evidence must be visibly labeled as counterfactual'],
  ['graphVersion = `${input.payload.graphVersion}:voi:${input.kind}:${input.debt.id}`', 'counterfactual topology must receive a distinct non-canonical version'],
  ['does not estimate the probability', 'VOI must not pretend to know which scenario is true'],
  ['must not be presented as expected real-world outcome', 'VOI must remain analytical sensitivity rather than outcome prediction'],
  ['never writes evidence', 'VOI must preserve non-persistence semantics'],
  ['never human worth', 'VOI must reject person/human-value scoring'],
  ['informationValue', 'analytical information-value measure must remain explicit'],
  ['sensitivitySpan', 'confirm-vs-disconfirm sensitivity span must remain explicit'],
]) requireText(engine, text, why);
forbidText(engine, 'supabase', 'VOI must remain pure in-memory counterfactual analysis');
forbidText(engine, 'fetch(', 'VOI must not perform external enrichment');
forbidText(engine, '.insert(', 'VOI must not persist hypothetical evidence');
forbidText(engine, '.update(', 'VOI must not persist hypothetical evidence');

for (const [text, why] of [
  ['COUNTERFACTUAL · VALUE OF INFORMATION', 'Evidence Debt must surface the counterfactual simulation boundary'],
  ['Estimate information value', 'VOI must be operator-initiated per evidence obligation'],
  ['IF FIRST-PARTY EVIDENCE CONFIRMS IT', 'confirmation scenario must be explicit'],
  ['IF THE WEAK EVIDENCE IS DISPROVED / REMOVED', 'disconfirmation scenario must be explicit'],
  ['simulateInternalValueOfInformation', 'Evidence Debt must consume VOI rather than invent duplicate scenario logic'],
  ['SIMULATABLE', 'non-edge obligations must be allowed to fail closed instead of inventing evidence'],
]) requireText(evidenceDebt, text, why);

forbidText(networkPulse, 'InternalValueOfInformationEngine', 'normal-user Network Pulse must not expose operator VOI analysis');
forbidText(networkPulse, 'VALUE OF INFORMATION', 'normal-user Network Pulse must not expose operator VOI analysis');

if (failures.length) {
  console.error('\nConstellation value-of-information validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation counterfactual value-of-information boundary passed.');
