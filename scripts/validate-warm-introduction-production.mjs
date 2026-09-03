import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing warm-introduction production artifact: ${path}`);
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

const migration = 'supabase/migrations/055_warm_introduction_capacity.sql';
const requestCard = 'src/components/WarmIntroductionRequestCard.tsx';
const inbox = 'src/screens/IntroductionInboxScreen.tsx';
const operationsDoc = 'docs/WARM_INTRODUCTION_OPERATIONS.md';

for (const path of [migration, requestCard, inbox, operationsDoc]) read(path);

requireText(migration, 'pg_advisory_xact_lock', 'count-based request admission must be serialized in the database');
requireText(migration, 'least(v_requester_lock, v_target_lock)', 'participant admission locks must be acquired in deterministic order');
requireText(migration, 'greatest(v_requester_lock, v_target_lock)', 'the second participant lock must preserve the same deadlock-safe ordering');
requireText(migration, "r.status in ('connector-pending','target-pending','accepted')", 'requester active capacity must include every unresolved or open introduction');
requireText(migration, 'v_requester_active, 0) >= 3', 'requesters must have a bounded unresolved queue');
requireText(migration, 'v_requester_total, 0) >= 6', 'requesters must have a bounded total event request budget');
requireText(migration, 'v_target_unresolved, 0) >= 8', 'one target must not accumulate an unbounded hidden queue');
requireText(migration, 'v_target_pending, 0) >= 4', 'target-visible decisions must have a stricter bounded queue');
requireText(migration, 'for update;', 'connector preference capacity must be protected by a row lock');
requireText(migration, 'v_connector_active, 0) >= v_connector_max', 'concurrent requests must not exceed the connector-owned active limit');
requireText(migration, 'if not v_enabled then', 'a participant must be able to withdraw from new connector work');
requireText(migration, "r.status = 'connector-pending'", 'withdrawal should close only work that has not yet received connector consent');
requireText(migration, 'previously accepted bridges remain subject to target choice', 'disabling new work must not silently revoke a bridge already accepted for target review');
forbidText(migration, "r.status = 'target-pending';\n  end if", 'connector preference withdrawal must not cancel target-owned decisions');

requireText(requestCard, 'const domainKey =', 'equivalent fit evidence should have a canonical primitive identity');
requireText(requestCard, 'new array instance during an otherwise equivalent render', 'the selected-person integration must document the render-stability risk');
requireText(requestCard, '[domainKey]', 'the memoized domain list must depend on canonical content rather than array identity');
requireText(requestCard, 'does not restart the availability', 'the implementation must explicitly prevent an availability-request storm');
forbidText(requestCard, 'setInterval(', 'selected-person availability must not create a second uncontrolled polling loop');

requireText(inbox, "type LoadMode = 'initial' | 'refresh' | 'quiet'", 'the inbox needs distinct visible and background refresh semantics');
requireText(inbox, "load('quiet')", 'periodic and post-mutation reconciliation should not force visible refresh chrome');
requireText(inbox, 'Quiet reconciliation', 'the background refresh behavior must remain intentional and reviewable');
requireText(inbox, "if (mode === 'refresh') setRefreshing(true)", 'only user-visible pull-to-refresh should activate the refresh indicator');
forbidText(inbox, "setInterval(() => load('refresh')", 'background polling must not display a pull-to-refresh spinner every cycle');

requireText(operationsDoc, 'Concurrency-safe admission', 'operational documentation must explain atomic capacity admission');
requireText(operationsDoc, 'Connector withdrawal', 'operational documentation must explain what disabling availability does to active work');
requireText(operationsDoc, 'Render-stable availability', 'operational documentation must cover request-storm prevention in the selected-person surface');
requireText(operationsDoc, 'Quiet inbox reconciliation', 'operational documentation must cover non-disruptive state refresh');

for (const path of [migration, requestCard, inbox]) {
  forbidText(path, 'Math.random(', 'capacity, refresh, and connector work admission must remain deterministic');
  forbidText(path, 'targetPremium', 'payment status must not influence request stability or capacity');
}

if (failures.length > 0) {
  console.error('Warm introduction production validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Warm introduction production validation passed.');
