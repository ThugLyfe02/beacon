import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];

function read(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    failures.push(`Missing community exchange artifact: ${path}`);
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

const migration = 'supabase/migrations/056_community_exchange.sql';
const service = 'src/services/community-exchange.service.ts';
const screen = 'src/screens/CommunityExchangeScreen.tsx';
const preview = 'src/components/CommunityExchangePreview.tsx';
const docs = 'docs/COMMUNITY_EXCHANGE.md';
const files = [migration, service, screen, preview, docs];
files.forEach(read);

requireText(migration, 'community_partners', 'partner identity must be durable and operator-owned');
requireText(migration, 'community_event_partnerships', 'community partnership must be event-scoped');
requireText(migration, "state text not null default 'invited'", 'event partnership must require owner acceptance');
requireText(migration, 'participant_event_community_affiliations', 'participant affiliation must be explicit and event-scoped');
requireText(migration, "visibility in ('private','badge')", 'badge disclosure must be a participant-controlled preference');
requireText(migration, 'exchange_enabled boolean not null default false', 'community exchange must default to off for participants');
requireText(migration, 'community_exchange_agreements', 'cross-community exchange requires a durable bilateral contract');
requireText(migration, 'community_a_approved boolean not null default false', 'community A approval must be explicit');
requireText(migration, 'community_b_approved boolean not null default false', 'community B approval must be explicit');
requireText(migration, "state text not null default 'proposed'", 'community exchange must not auto-activate');
requireText(migration, "community_a_id::text < community_b_id::text", 'community pair ordering must be canonical');
requireText(migration, 'revoke all on public.participant_event_community_affiliations from authenticated, anon', 'client must not receive a raw community affiliation directory');
requireText(migration, 'revoke all on public.community_exchange_agreements from authenticated, anon', 'client must consume scoped exchange projections');
requireText(migration, "encode(digest(v_code, 'sha256'), 'hex')", 'partner event codes must be stored as digests rather than plaintext');
requireText(migration, "p_visibility not in ('private','badge')", 'affiliation visibility must be bounded at the server');
requireText(migration, 'approved event participation required', 'only approved event participants can verify affiliation');
requireText(migration, 'if not v_already_affiliated then', 'reusing a code for an existing affiliation must not consume another invite slot');
requireText(migration, "p.state = 'active'", 'member verification and exchange must require an active event partnership');
requireText(migration, "x.state = 'active'", 'live community bridges must require a fully approved bilateral exchange');
requireText(migration, 'a.exchange_enabled = true', 'participant bridge context must require explicit exchange opt-in');
requireText(migration, "a.visibility = 'badge'", 'target community identity must require badge disclosure opt-in');
requireText(migration, "u.last_location_at >= now() - interval '90 seconds'", 'community bridge context must remain tied to fresh live event state');
requireText(migration, 'cardinality(coalesce(p_target_ids', 'live community bridge lookup must have a bounded target surface');
requireText(migration, 'where domain = any(pc.exchange_domains)', 'community bridge must be constrained to approved exchange domains');
requireText(migration, 'cardinality(d.fit_domains) > 0', 'community affiliation alone must never create a peer recommendation');
requireText(migration, 'counts.a_count >= 5 and counts.b_count >= 5', 'operator evidence must require bilateral cohort support');
requireText(migration, 'public.declared_fit_mutual_contexts', 'community outcome evidence should reuse captured explicit declared-fit context');
requireText(migration, 'get_my_community_exchange_portfolio', 'community owners need longitudinal partnership evidence');
requireText(migration, 'v_owner is distinct from auth.uid()', 'community portfolio must remain owner private');
requireText(migration, 'Historical evidence is descriptive', 'historical community evidence must not become future targeting authority');

requireText(service, ".rpc('get_live_community_bridges'", 'client bridge context must use the scoped server RPC');
requireText(service, ".rpc('get_community_exchange_summary'", 'operator evidence must use cohort-gated server projection');
requireText(service, ".rpc('get_my_community_exchange_portfolio'", 'community portfolio must remain owner-scoped');
forbidText(service, ".from('participant_event_community_affiliations')", 'mobile client must never read raw community affiliations');
forbidText(service, ".from('community_exchange_agreements')", 'mobile client must never read raw exchange agreement rows');

requireText(screen, 'A network of communities, without a community-wide people graph.', 'community product framing must preserve the graph-privacy boundary');
requireText(screen, 'Verify a partner affiliation', 'participant must have a functional event affiliation path');
requireText(screen, 'Enable cross-community exchange', 'participant exchange consent must be explicit in the UI');
requireText(screen, 'Show community badge', 'badge disclosure must be independently explicit');
requireText(screen, 'The community owner still has to accept', 'host UI must explain partnership acceptance boundary');
requireText(screen, 'The exchange remains inert until both community owners approve', 'host UI must explain bilateral activation');
requireText(screen, 'Operator evidence stays withheld until at least five participants in each community', 'UI must explain bilateral cohort suppression');
requireText(screen, 'not a public leaderboard or cross-customer ranking', 'community portfolio must not become a public popularity system');
requireText(screen, 'NETWORK-OF-NETWORKS BOUNDARY', 'screen must surface the product boundary directly');

requireText(preview, "navigation.navigate('CommunityExchange'", 'event lobby preview must lead into the functional community surface');
requireText(preview, 'real declared-fit domain crosses an approved community bridge', 'participant preview must explain that affiliation alone is insufficient');

requireText(docs, 'network of networks', 'architecture documentation must state the partnership-level network thesis');
requireText(docs, 'Open Badges 3.0', 'community portability seam should document the interoperable credential pathway without claiming current conformance');
requireText(docs, 'should not claim Open Badges compatibility', 'documentation must avoid standards overclaiming');
requireText(docs, 'no reusable member roster', 'documentation must explicitly reject community roster ingestion as a requirement');

for (const path of [migration, service, screen, preview]) {
  forbidText(path, 'targetPremium', 'community routing must not use premium status');
  forbidText(path, 'graphDegree', 'community routing must not create hidden graph-degree ranking');
  forbidText(path, 'popularityScore', 'community routing must not create popularity scores');
}

if (failures.length > 0) {
  console.error('Community exchange architecture validation failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Community exchange architecture validation passed (${files.length} required artifacts).`);
