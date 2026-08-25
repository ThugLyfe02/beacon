import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing required event-programming file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  const content = read(path);
  if (!content.includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  const content = read(path);
  if (content.includes(text)) failures.push(`${path}: ${explanation}`);
}

const engine = 'src/spatial/EventIntentProgramming.ts';
const screen = 'src/screens/EventIntentMixScreen.tsx';
read(engine);
read(screen);

requireText(engine, 'deterministic operational decision support', 'programming decisions must remain deterministic and reviewable');
requireText(engine, 'not person-level targeting', 'aggregate event programming must never become participant targeting');
requireText(engine, 'Mutual-domain evidence is composition of actual mutual outcomes', 'mutual evidence must preserve outcome-composition semantics');
requireText(engine, 'human programming decision', 'programming adjustments must remain human-in-the-loop');
requireText(engine, "posture: 'add-structure'", 'need-heavy cohorts need an explicit structure response');
requireText(engine, "posture: 'activate-supply'", 'offer-heavy cohorts need an explicit supply-activation response');
requireText(engine, "posture: 'protect'", 'healthy high-signal domains need a no-change/protection posture');
requireText(engine, "posture: 'observe'", 'weak evidence must have an explicit observe/no-intervention state');
requireText(engine, '.slice(0, 6)', 'host programming queue must remain bounded');
requireText(screen, 'PROGRAMMING QUEUE', 'the aggregate programming result must be reachable in the host demand surface');
requireText(screen, 'Nothing here identifies a participant or executes automatically', 'host UI must preserve privacy and human control boundaries');
requireText(screen, 'POSSIBLE HOST ACTION', 'programming output must be presented as an optional host action rather than an automatic command');

forbidText(engine, 'Math.random(', 'programming decisions must not use random ranking');
forbidText(engine, 'targetPremium', 'programming decisions must not privilege paid participants');
forbidText(engine, 'userId', 'aggregate programming must not accept participant identity');
forbidText(engine, 'targetId', 'aggregate programming must not accept spatial participant identity');

if (failures.length > 0) {
  console.error('Event intent programming validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Event intent programming validation passed.');
