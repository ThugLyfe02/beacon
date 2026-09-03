import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing partner-program artifact: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function requireText(path, text, explanation) {
  if (!read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

function forbidText(path, text, explanation) {
  if (read(path).includes(text)) failures.push(`${path}: ${explanation}`);
}

const migration = 'supabase/migrations/057_community_partner_programs.sql';
const service = 'src/services/community-partner-program.service.ts';
const panel = 'src/components/CommunityPartnerProgramsPanel.tsx';
const screen = 'src/screens/CommunityExchangeScreen.tsx';
[migration, service, panel, screen].forEach(read);

requireText(migration, 'community_partner_programs', 'reusable community pair configuration must be durable');
requireText(migration, "state text not null default 'proposed'", 'a reusable program must begin without bilateral authority');
requireText(migration, 'community_a_approved boolean not null default false', 'community A must explicitly approve the reusable program');
requireText(migration, 'community_b_approved boolean not null default false', 'community B must explicitly approve the reusable program');
requireText(migration, "community_a_id::text < community_b_id::text", 'program pair identity must be canonical');
requireText(migration, "p.state = 'active'", 'only active reusable programs may be offered to an event');
requireText(migration, 'both program communities must be active partners of this event', 'program reuse must require both communities in the current event');
requireText(migration, "false,\n    false,\n    'proposed'", 'using a historical program must reset both event-specific approvals');
requireText(migration, 'never carries member disclosure or event-specific exchange authority', 'reusable configuration must not inherit participant or event consent');

requireText(service, ".rpc('use_community_partner_program'", 'host reuse must call the server event-consent reset boundary');
requireText(service, ".rpc('get_event_available_partner_programs'", 'available programs must be server filtered for the current event');
forbidText(service, ".from('community_partner_programs')", 'mobile client must not read the reusable partner-program table directly');

requireText(panel, 'every future event still resets exchange approval and participant opt-in', 'operator UI must explain the non-inheritance rule');
requireText(panel, 'creates a proposed event exchange—not an automatic activation', 'host reuse must remain human and event specific');
requireText(panel, 'both community owners still have to approve this event-specific exchange', 'post-use copy must preserve event-specific bilateral approval');
requireText(panel, 'PAUSE FUTURE USE', 'community owners need a functional kill switch for future reuse');
requireText(panel, 'PROPOSE PARTNER PROGRAM', 'owners need a functional proposal surface');
requireText(screen, '<CommunityPartnerProgramsPanel', 'partner programs must be integrated into the primary community exchange workspace');

for (const path of [migration, service, panel]) {
  forbidText(path, 'targetPremium', 'partner programs must not use payment status');
  forbidText(path, 'userId:', 'partner programs must not become person-level targeting configuration');
  forbidText(path, 'Math.random(', 'partner program policy and ordering must remain deterministic');
}

if (failures.length > 0) {
  console.error('Community partner-program validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Community partner-program validation passed.');
