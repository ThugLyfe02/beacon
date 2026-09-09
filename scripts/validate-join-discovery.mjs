import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const path = 'supabase/migrations/044_join_code_lookup_abuse_boundary.sql';
const absolute = join(root, path);
const failures = [];

if (!existsSync(absolute)) {
  failures.push(`Missing join-discovery boundary: ${path}`);
} else {
  const content = readFileSync(absolute, 'utf8');
  for (const [text, explanation] of [
    ['event_join_code_lookup_attempts', 'lookup attempts must have a dedicated abuse-control ledger'],
    ["encode(digest(v_code, 'sha256'), 'hex')", 'attempted codes must be fingerprinted rather than stored plaintext'],
    ["interval '10 minutes'", 'join-code discovery must have a short-window throttle'],
    ["interval '24 hours'", 'join-code discovery must have a daily throttle'],
    ['v_recent >= 30 or v_daily >= 150', 'lookup throttle limits must remain explicit and fail closed'],
    ['case when v_entitled then v_event.host_id else null::uuid end', 'pre-membership lookup must withhold host identity'],
    ['case when v_entitled then v_event.latitude else null::numeric end', 'pre-membership lookup must withhold exact latitude'],
    ['case when v_entitled then v_event.address else null::text end', 'pre-membership lookup must withhold exact address'],
    ['prune_event_join_code_lookup_attempts', 'abuse telemetry needs bounded retention'],
    ['grant execute on function public.prune_event_join_code_lookup_attempts() to service_role', 'lookup-ledger pruning must remain service-only'],
  ]) {
    if (!content.includes(text)) failures.push(`${path}: ${explanation}`);
  }

  for (const [text, explanation] of [
    ['code_fingerprint text not null', 'plaintext join codes must not be persisted in the abuse ledger'],
  ]) {
    if (!content.includes(text)) failures.push(`${path}: ${explanation}`);
  }

  if (/attempted_code\s+text/i.test(content)) {
    failures.push(`${path}: abuse telemetry must not store plaintext attempted join codes`);
  }
}

if (failures.length > 0) {
  console.error('\nJoin discovery security validation failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Join discovery abuse-control and pre-membership privacy contract passed.');
