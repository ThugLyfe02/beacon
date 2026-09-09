import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (path) => {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing calibration-loop file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
};
const requireText = (path, text, why) => { if (!read(path).includes(text)) failures.push(`${path}: ${why}`); };
const forbidText = (path, text, why) => { if (read(path).includes(text)) failures.push(`${path}: ${why}`); };

for (const file of [
  'src/admin/InternalDecisionCalibrationEngine.ts',
  'src/admin/internalDecisionCalibration.service.ts',
  'src/admin/InternalOperatorDecisionAdmission.ts',
  'src/screens/InternalDecisionJournalScreen.tsx',
  'src/screens/InternalAdaptiveCommandScreen.tsx',
  'src/components/NetworkPulseCard.tsx',
]) read(file);

for (const [text, why] of [
  ['getInternalDecisionCalibrationAdjustment', 'calibration must produce a future-authority adjustment'],
  ['maturityWeight', 'calibration penalty must depend on evidence maturity'],
  ['overconfidencePenalty', 'historical overconfidence must be penalizable'],
  ['penalty = Math.min(0.22', 'calibration penalty must remain bounded'],
  ['may only reduce future analytical authority', 'calibration must be downward-only'],
  ['never an automatic authority boost', 'historical underconfidence must not auto-increase authority'],
]) requireText('src/admin/InternalDecisionCalibrationEngine.ts', text, why);
forbidText('src/admin/InternalDecisionCalibrationEngine.ts', 'supabase', 'calibration policy must remain replayable in-memory analysis');

requireText('src/admin/internalDecisionCalibration.service.ts', 'loadInternalDecisionCalibrationReport', 'live calibration report loader must exist');
requireText('src/admin/internalDecisionCalibration.service.ts', 'loadInternalDecisionJournal', 'calibration must derive from falsifiable journal history');

for (const [text, why] of [
  ['decisionCalibration?: InternalDecisionCalibrationReport', 'admission must accept calibration history'],
  ['getInternalDecisionCalibrationAdjustment', 'admission must consume calibration policy'],
  ['analysisCalibration.penalty', 'analysis authority must be calibration-aware'],
  ['routeCalibration.penalty', 'route authority must be calibration-aware'],
  ['interventionCalibration.penalty', 'intervention authority must be calibration-aware'],
  ['Current evidence sets the ceiling', 'current evidence must remain the authority ceiling'],
]) requireText('src/admin/InternalOperatorDecisionAdmission.ts', text, why);

for (const [text, why] of [
  ['analyzeInternalDecisionCalibration(entries)', 'Decision Journal must derive current method calibration'],
  ['decisionCalibration,', 'Decision Journal must pass calibration into admission'],
  ['decision-evidence-v2-calibrated', 'new hypotheses must seal calibrated authority context'],
  ['CALIBRATED ADMISSION SNAPSHOT', 'calibrated admission must be visible to operators'],
]) requireText('src/screens/InternalDecisionJournalScreen.tsx', text, why);

for (const [text, why] of [
  ['loadInternalDecisionCalibrationReport', 'Operator Command must load live calibration history'],
  ['setDecisionCalibration', 'Operator Command must keep live calibration state'],
  ['decisionCalibration,', 'Command admission must consume calibration'],
  ['METHOD VERDICTS', 'Command must expose calibration sample maturity'],
]) requireText('src/screens/InternalAdaptiveCommandScreen.tsx', text, why);

forbidText('src/components/NetworkPulseCard.tsx', 'Decision Calibration', 'normal-user Network Pulse must not expose operator method calibration');
forbidText('src/components/NetworkPulseCard.tsx', 'calibrationGap', 'normal-user preview must not expose calibration internals');

if (failures.length) {
  console.error('\nConstellation decision-calibration loop validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Constellation falsifiable decision calibration and downward-only authority feedback loop passed.');
