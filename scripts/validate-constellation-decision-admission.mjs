import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing decision-admission file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

const engine = 'src/admin/InternalOperatorDecisionAdmission.ts';
const command = 'src/screens/InternalAdaptiveCommandScreen.tsx';
const pulse = 'src/components/NetworkPulseCard.tsx';
[engine, command, pulse].forEach(read);

for (const [text, why] of [
  ['evaluateInternalOperatorDecisionAdmission', 'decision admission entrypoint must remain available'],
  ["'analysis_review'", 'analysis-review admission must remain explicit'],
  ["'target_route_review'", 'target-route admission must remain explicit'],
  ["'intervention_review'", 'intervention-review admission must remain explicit'],
  ["'restricted_forensics_review'", 'restricted-forensics admission must remain explicit'],
  ["'portable_export_review'", 'portable-export admission must remain explicit'],
  ["'safety_blocked'", 'missing safety truth must be able to block review escalation'],
  ["'capability_required'", 'missing capability must be represented as a hard admission boundary'],
  ["'evidence_remediation_required'", 'weak evidence must be able to stop review escalation'],
  ['suppressionsEstablished', 'route/intervention admission must depend on authoritative suppression truth'],
  ["health.band === 'degraded'", 'degraded graph health must restrict intervention escalation'],
  ['confidenceFloor', 'route confidence floor must influence admission reasoning'],
  ['routeDiversity', 'route diversity must influence admission authority'],
  ['cannot grant a server', 'admission engine must explicitly reject capability grant authority'],
  ['override a block/suppression boundary', 'admission engine must not override safety boundaries'],
  ['execute an intervention', 'admission engine must not execute interventions'],
  ['Admission means eligible for operator review only', 'admission semantics must remain review-only'],
  ['Current evidence sets the ceiling', 'historical calibration/temporal context must never create authority beyond current evidence'],
]) requireText(engine, text, why);
forbidText(engine, 'supabase', 'decision admission must remain a pure policy evaluation layer');
forbidText(engine, 'fetch(', 'decision admission must not perform network or enrichment operations');

for (const [text, why] of [
  ['evaluateInternalOperatorDecisionAdmission', 'Operator Command must consume decision admission'],
  ['DECISION ADMISSION', 'decision admission must be inspectable by operators'],
  ['decisionAdmission.admissions.map', 'Command must render every admission class rather than hiding blocked states'],
  ["admission.state === 'safety_blocked'", 'Command must visibly distinguish hard safety/remediation boundaries'],
  ['admission.requiredRemediation', 'required remediation must be explicit before escalation'],
  ['admission.operatingRule', 'every admission card must retain review-only semantics'],
]) requireText(command, text, why);

forbidText(pulse, 'InternalOperatorDecisionAdmission', 'normal-user Network Pulse must not expose operator decision admission');
forbidText(pulse, 'DECISION ADMISSION', 'normal-user Network Pulse must not expose internal admission state');

if (failures.length) {
  console.error('\nConstellation decision-admission validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation evidence/capability decision-admission boundary passed.');
