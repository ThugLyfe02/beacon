import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing community supply-demand artifact: ${path}`);
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

const migration = 'supabase/migrations/058_community_supply_demand.sql';
const service = 'src/services/community-supply-demand.service.ts';
const panel = 'src/components/CommunitySupplyDemandPanel.tsx';
const screen = 'src/screens/CommunityExchangeScreen.tsx';
[migration, service, panel, screen].forEach(read);

requireText(migration, 'get_community_pair_supply_demand', 'partner planning needs a purpose-built server projection');
requireText(migration, 'public.is_event_host(p_event_id, auth.uid())', 'event host may access supported planning evidence');
requireText(migration, 'auth.uid() not in (v_owner_a, v_owner_b)', 'only the two community owners may access the pair map besides the host');
requireText(migration, "p.state = 'active'", 'both communities must be active partners before planning evidence is released');
requireText(migration, 'a.exchange_enabled = true', 'only participants who explicitly enabled exchange may contribute to partnership planning');
requireText(migration, 'i.enabled = true', 'only current explicit event focus may contribute to live planning evidence');
requireText(migration, 'd.a_contributors >= 5', 'community A needs per-domain cohort support');
requireText(migration, 'd.b_contributors >= 5', 'community B needs per-domain cohort support');
requireText(migration, 'least(d.a_offering, d.b_seeking)', 'A-to-B support must be bounded by actual supply and need');
requireText(migration, 'least(d.b_offering, d.a_seeking)', 'B-to-A support must be bounded by actual supply and need');
requireText(migration, "then 'two-way'", 'two-way posture must require supported supply in both directions');
requireText(migration, 'grants no participant or exchange authority', 'planning evidence must not imply authorization');

requireText(service, ".rpc('get_community_pair_supply_demand'", 'mobile client must use the cohort-gated RPC');
forbidText(service, ".from('participant_event_community_affiliations')", 'mobile client must not construct partner cohorts directly');
forbidText(service, ".from('participant_event_intents')", 'mobile client must not construct partner demand directly');

requireText(panel, 'at least five exchange-enabled declaring participants from each community', 'operator UI must explain bilateral release threshold');
requireText(panel, 'bounded by explicit B need', 'A-to-B metric must explain its bounded meaning');
requireText(panel, 'bounded by explicit A need', 'B-to-A metric must explain its bounded meaning');
requireText(panel, 'not a predicted number of matches', 'planning surface must reject prediction overclaiming');
requireText(screen, '<CommunitySupplyDemandPanel', 'planning map must be integrated into the community exchange workspace');

for (const path of [migration, service, panel]) {
  forbidText(path, 'targetPremium', 'community supply-demand planning must not use payment status');
  forbidText(path, 'userId:', 'community supply-demand planning must not become person-level targeting');
  forbidText(path, 'Math.random(', 'community supply-demand semantics must remain deterministic');
}

if (failures.length > 0) {
  console.error('Community supply-demand validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Community supply-demand validation passed.');
